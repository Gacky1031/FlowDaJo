import { test, expect, type Page } from "@playwright/test";
import { clickDemo } from "./helpers";

async function drawGate(page: Page) {
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const box = (await page.locator(".plot-stage").first().boundingBox())!;
  await page.mouse.move(box.x + 85, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 185, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".statistics tbody tr")).toHaveCount(2);
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
}

test("gate outlines and labels can be forced to black without changing the gate color", async ({ page }) => {
  await page.goto("/");
  await clickDemo(page);
  await expect(page.locator(".statistics")).toContainText("16,000");
  await drawGate(page);
  const stage = page.locator(".plot-stage").first();
  const outline = stage.locator("g.gate-shape").first();
  const label = stage.locator("[data-gate-label]").first();
  const gateColor = await outline.getAttribute("stroke");
  expect(gateColor).not.toBe("#000");
  expect(await label.getAttribute("fill")).toBe(gateColor);

  await page.locator("[data-plot-options]").first().click();
  const options = page.getByRole("dialog", { name: "プロット表示設定" });
  await options.locator('[name="blackGateOutlines"]').check();
  await options.getByRole("button", { name: "表示設定を適用" }).click();
  await expect(outline).toHaveAttribute("stroke", "#000");
  expect(await label.getAttribute("fill")).toBe(gateColor);

  await page.locator("[data-plot-options]").first().click();
  await options.locator('[name="blackGateLabels"]').check();
  await options.getByRole("button", { name: "表示設定を適用" }).click();
  await expect(label).toHaveAttribute("fill", "#000");

  await page.locator("[data-plot-options]").first().click();
  await options.locator('[name="blackGateOutlines"]').uncheck();
  await options.locator('[name="blackGateLabels"]').uncheck();
  await options.getByRole("button", { name: "表示設定を適用" }).click();
  await expect(outline).toHaveAttribute("stroke", gateColor!);
  await expect(label).toHaveAttribute("fill", gateColor!);
});

test("plot context menu copies only that plot to the clipboard as a PNG", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await clickDemo(page);
  await expect(page.locator(".statistics")).toContainText("16,000");
  await drawGate(page);
  const stage = page.locator(".plot-stage").first();
  const box = (await stage.boundingBox())!;
  await page.mouse.click(box.x + box.width - 50, box.y + 60, { button: "right" });
  await page.getByRole("menuitem", { name: "このプロットをクリップボードにコピー" }).click();
  await expect(page.locator(".status, .toast, [role=status]").filter({ hasText: "クリップボードにコピーしました" }).first()).toBeVisible();
  const image = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const blob = await item.getType("image/png");
    const bitmap = await createImageBitmap(blob);
    return { types: item.types, width: bitmap.width, height: bitmap.height };
  });
  expect(image.types).toEqual(["image/png"]);
  expect(image.width).toBeGreaterThanOrEqual(box.width);
  expect(image.height).toBeGreaterThanOrEqual(box.height);
  expect(image.height).toBeLessThan(box.height * 2.5);
});
