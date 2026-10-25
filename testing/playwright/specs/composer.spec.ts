import { test, expect } from "@playwright/test";
import { ApiClient } from "../../framework/api-client";
test("SMTP message captured by API appears in the React console", async ({ page }) => {
  const api = new ApiClient();
  try {
    const inbox = await api.create("email");
    const subject = "Browser-" + crypto.randomUUID();
    await page.goto("/");
    await expect(page.getByText("Virtual Inbox")).toBeVisible();
    const receipt = await fetch(new URL("/demo/mailboxes/" + inbox.id + "/demo-send", page.url()), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, body: "browser cross-layer test" }),
    });
    expect(receipt.ok).toBeTruthy();
    const received = await api.waitFor(inbox, subject);
    expect(received).not.toBeNull();
    // Browser ownership is by observer session, so the created inbox must be added
    // using the UI rather than expecting it to be visible automatically.
    await page.locator(".sidebar .inboxGroup button").filter({ hasText: "+" }).first().click();
    await page.locator(".modal input").first().fill(inbox.address);
    await page.locator(".modal .actions button").last().click();
    await expect(page.getByText(subject)).toBeVisible();
  } finally {
    await api.dispose();
  }
});

test("new demo messages have distinct offline titles and bodies", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("virtual-inbox-observer"))).toBeTruthy();
  await page.locator(".sidebar .inboxGroup").first().locator(".groupHead button").last().click();
  await page.locator(".modal .actions button").last().click();
  await expect(page.locator(".panelTitle")).toContainText("@");
  await page.locator(".fab").click();
  const subject = page.locator(".composeOverlay input").nth(1);
  const body = page.locator(".composeOverlay textarea");
  const previousSubject = await subject.inputValue();
  const previousBody = await body.inputValue();
  await page.locator(".composeHeading button").click();
  expect(await subject.inputValue()).not.toBe(previousSubject);
  expect(await body.inputValue()).not.toBe(previousBody);
});
test("sidebar removal preserves unread badge and respects cancellation", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("virtual-inbox-observer"))).toBeTruthy();
  await page.locator(".sidebar .inboxGroup").first().locator(".groupHead button").last().click();
  await page.locator(".modal .actions button").last().click();
  const address = await page.locator(".panelTitle").innerText();
  const row = page.locator(".sidebarInboxRow").filter({ hasText: address });
  await expect(row).toBeVisible();
  await expect(row.locator(".sidebarRemoveInbox")).toHaveAttribute("aria-label", /.+/);
  await page.locator(".fab").click();
  await page.locator(".composeOverlay .actions button").last().click();
  await expect(row.locator(".badge")).toHaveText("1");
  await row.hover();
  await expect(row.locator(".sidebarRemoveInbox")).toBeVisible();
  page.once("dialog", dialog => void dialog.dismiss());
  await row.locator(".sidebarRemoveInbox").click();
  await expect(row).toBeVisible();
  await expect(row.locator(".badge")).toHaveText("1");
  page.once("dialog", dialog => void dialog.accept());
  await row.locator(".sidebarRemoveInbox").click();
  await expect(row).toHaveCount(0);
});
