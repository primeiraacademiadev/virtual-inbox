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
