import { test, expect } from "@playwright/test";
test("console loads with session and main navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Virtual Inbox")).toBeVisible();
  await page.locator(".appNavigation button").first().click();
  await expect(page.locator("#primary-nav-menu")).toBeVisible();
});
test("locale switching preserves a usable console", async ({ page }) => {
  await page.goto("/");
  const selector = page.locator(".languageSelector select");
  await selector.selectOption("fr");
  await expect(page.getByText("Boîtes de réception", { exact: false }).first()).toBeVisible();
  await selector.selectOption("pt-PT");
  await expect(page.getByText("Inboxes", { exact: false }).first()).toBeVisible();
});
