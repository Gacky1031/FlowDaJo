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

export async function confirmStatisticsCsvOptions(page: Page) {
  const dialog = page.getByRole("dialog", { name: "統計CSVの出力項目" });
  await dialog.getByRole("button", { name: "出力項目を確定" }).click();
}
