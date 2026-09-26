import type { Page } from "@playwright/test";

export async function clickToolbarAction(page: Page, selector: string) {
  const button = page.locator(selector);
  const menu = button.locator("xpath=../..");
  await menu.locator("summary").click();
  await button.click();
}

export async function clickDemo(page: Page) {
  await clickToolbarAction(page, "#demo");
}
