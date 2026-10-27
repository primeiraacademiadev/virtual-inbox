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
  await page.locator("#primary-nav-menu button").nth(2).click();
  const search = page.locator(".docSearch input");
  await expect(search).toBeVisible();
  await search.click();
  await expect(page.locator(".docSearchResults")).toBeVisible();
  await page.locator(".information h2").first().click();
  await expect(page.locator(".docSearchResults")).toBeHidden();
});

test("context menu uses icons when collapsed and system exposes footprint", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".groupToggle").nth(1).locator("svg")).toBeVisible();
  await page.locator(".appNavigation > button").click();
  await page.locator("#primary-nav-menu button").nth(1).click();
  const nav = page.locator(".contextSidebar");
  await expect(nav.locator('nav button[title]')).toHaveCount(0);
  await expect(nav.locator("nav button").first().locator("svg")).toBeVisible();
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(nav.locator('nav button[title="SMTP"] svg')).toBeVisible();
  await expect(nav.locator('nav button[title="POP3"] svg')).toBeVisible();
  await nav.locator('nav button[title="POP3"]').click();
  await expect(page.getByText("POP3 test identities")).toBeVisible();
  await page.locator(".appNavigation > button").click();
  await page.locator("#primary-nav-menu button").nth(3).click();
  await expect(page.locator(".contextSidebar")).toHaveAttribute("aria-label", "System navigation");
  await page.locator(".contextSidebar nav button").nth(1).click();
  await expect(page.getByRole("heading", { name: "Application Footprint" })).toBeVisible();
  await expect(page.getByLabel("Administrator token")).toBeVisible();
});
