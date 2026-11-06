import { test, expect } from "@playwright/test";
import { clickDemo } from "./helpers";

test("plot title, axis titles and ticks can be hidden and restored from plot settings", async ({ page }) => {
  await page.goto("/");
  await clickDemo(page);
  await expect(page.locator(".statistics")).toContainText("16,000");
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  const stage = page.locator(".plot-stage").first();
  const pixels = () => stage.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const initial = await pixels();
  await expect(stage.locator(".axis-x")).toBeVisible();
  await expect(stage.locator(".axis-y")).toBeVisible();

  const options = page.getByRole("dialog", { name: "プロット表示設定" });
  const setAll = async (checked: boolean) => {
    await page.locator("[data-plot-options]").first().click();
    for (const name of ["showPlotTitle", "showXTitle", "showYTitle", "showTicks"]) {
      const box = options.locator(`[name="${name}"]`);
      await expect(box).toBeChecked({ checked: !checked });
      await box.setChecked(checked);
    }
    await options.getByRole("button", { name: "表示設定を適用" }).click();
  };

  await setAll(false);
  await expect(stage).toHaveClass(/hide-x-title/);
  await expect(stage).toHaveClass(/hide-y-title/);
  await expect(stage.locator(".axis-x")).toBeHidden();
  await expect(stage.locator(".axis-y")).toBeHidden();
  await expect.poll(pixels).not.toBe(initial);

  await setAll(true);
  await expect(stage.locator(".axis-x")).toBeVisible();
  await expect(stage.locator(".axis-y")).toBeVisible();
  await expect.poll(pixels).toBe(initial);
});
