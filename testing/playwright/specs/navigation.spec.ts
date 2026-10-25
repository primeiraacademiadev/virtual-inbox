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
  await expect(page.getByText("Boîtes — E-mail", { exact: false }).first()).toBeVisible();
  await expect(page.locator(".groupToggle").first()).toContainText("Boîtes — E-mail");
  await expect(page.locator(".groupToggle").nth(1)).toContainText("Boîtes — SMS");
  await selector.selectOption("pt-PT");
  await expect(page.getByText("Inboxes", { exact: false }).first()).toBeVisible();
});

test("floating navigation, copy and search close on outside click or Escape", async ({ page }) => {
  await page.goto("/");
  const toggle = page.locator(".appNavigation > button");
  await toggle.click();
  await expect(page.locator("#primary-nav-menu")).toBeVisible();
  await page.locator("header strong").click();
  await expect(page.locator("#primary-nav-menu")).toBeHidden();

  await toggle.click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#primary-nav-menu")).toBeHidden();

  await toggle.click();
  await page.locator("#primary-nav-menu button").nth(3).click();
  const search = page.locator(".docSearch input");
  await search.click();
  await expect(page.locator(".docSearchResults")).toBeVisible();
  await page.locator(".information h2").first().click();
  await expect(page.locator(".docSearchResults")).toBeHidden();
});
