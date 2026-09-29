import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { clickDemo } from "./helpers";

test("copied gate branch can be pasted under another parent", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("起動完了");
  await clickDemo(page);
  await expect(page.locator(".statistics")).toContainText("16,000");

  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const stage = page.locator(".plot-stage").first();
  const bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + 95, bounds.y + 70);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 210, bounds.y + 165, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".statistics tbody tr")).toHaveCount(2);
  await expect(page.locator(".status")).not.toHaveClass(/pending/);

  const source = page.locator('#tree .population[data-pop]:has-text("P1")').first();
  await source.click({ button: "right" });
  await page.getByRole("menuitem", { name: "ゲート階層をコピー" }).click();

  const root = page.locator('#tree .population[data-pop="root"]').first();
  await root.click({ button: "right" });
  const paste = page.getByRole("menuitem", { name: "クリップボードのゲートをAll eventsへ貼り付け" });
  await expect(paste).toBeEnabled();
  await paste.click();

  await expect(page.locator('#tree .population').filter({ hasText: "P1 コピー" })).toBeVisible();
  await expect(page.locator(".statistics tbody tr")).toHaveCount(3);
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
});

test("global gate can be pasted under another global gate", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("起動完了");
  await clickDemo(page);
  await expect(page.locator(".statistics")).toContainText("16,000");
  await expect(page.locator(".status")).not.toHaveClass(/pending/);

  const stage = page.locator(".plot-stage").first();
  const drawRectangle = async (x: number, y: number) => {
    const bounds = (await stage.boundingBox())!;
    await page.mouse.move(bounds.x + x, bounds.y + y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + x + 100, bounds.y + y + 85, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator(".status")).not.toHaveClass(/pending/);
  };
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await drawRectangle(80, 60);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await drawRectangle(220, 150);

  const source = page.locator('#tree .population[data-pop][data-sample]').filter({ hasText: "◇ P1" }).first();
  await source.click({ button: "right" });
  await page.getByRole("menuitem", { name: "ゲート階層をコピー" }).click();
  const target = page.locator('#tree .population[data-pop][data-sample]').filter({ hasText: "◇ P2" }).first();
  await target.click({ button: "right" });
  const paste = page.getByRole("menuitem", { name: "クリップボードのゲートを「P2」の下へ貼り付け" });
  await expect(paste).toBeEnabled();
  await paste.click();
  await expect(page.locator('#tree .population[data-pop][data-sample]').filter({ hasText: "◇ P1 コピー" })).toBeVisible();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
});

test("a channel mismatch in one descendant does not disable a compatible global paste", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("起動完了");
  await clickDemo(page);
  await expect(page.locator(".status")).not.toHaveClass(/pending/, { timeout: 60000 });
  await expect(page.locator(".statistics")).toContainText("16,000");
  await clickDemo(page);
  await expect(page.locator("#tree button.sample[data-sample]")).toHaveCount(2);
  await expect(page.locator(".status")).not.toHaveClass(/pending/, { timeout: 60000 });

  const samples = page.locator("#tree button.sample[data-sample]");
  const sourceSampleId = await samples.nth(0).getAttribute("data-sample");
  const targetSampleId = await samples.nth(1).getAttribute("data-sample");
  await samples.nth(0).click();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const rootStage = page.locator(".plot-stage").first();
  let bounds = (await rootStage.boundingBox())!;
  await page.mouse.move(bounds.x + 80, bounds.y + 60);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 180, bounds.y + 145, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);

  const sourceParent = page.locator(`#tree .population[data-sample="${sourceSampleId}"]`).filter({ hasText: "◇ P1" }).first();
  await sourceParent.dblclick();
  await expect(page.locator(".plot-card")).toHaveCount(2);
  await page.locator('[data-axis-label="x"]').last().click();
  await page.getByRole("combobox", { name: "チャンネルを検索" }).fill("FITC-A");
  await page.getByRole("dialog").getByRole("option").click();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const childStage = page.locator(".plot-stage").last();
  bounds = (await childStage.boundingBox())!;
  await page.mouse.move(bounds.x + 85, bounds.y + 65);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 195, bounds.y + 150, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);

  await page.getByText("ファイル ▾", { exact: true }).click();
  await page.locator("#save").click();
  await expect(page.locator(".status")).toContainText("保存しました");
  const workspace = JSON.parse(readFileSync("artifacts/ui-workspace.json", "utf8"));
  const targetSample = workspace.samples.find((item: { id: string }) => item.id === targetSampleId);
  targetSample.channels = targetSample.channels.filter((channel: { id: string }) => channel.id !== "FITC-A");
  writeFileSync("artifacts/ui-workspace.json", JSON.stringify(workspace));
  const load = page.locator("#load");
  if (!(await load.isVisible())) await page.getByText("ファイル ▾", { exact: true }).click();
  await load.click();
  await expect(page.locator(".statistics-widget")).not.toHaveClass(/stale/, { timeout: 60000 });
  await expect(page.locator(".status")).not.toHaveClass(/pending/);

  const source = page.locator(`#tree .population[data-sample="${sourceSampleId}"]`).filter({ hasText: "◇ P1" }).first();
  await source.click({ button: "right" });
  await page.getByRole("menuitem", { name: "ゲート階層をコピー" }).click({ force: true });
  await page.locator(`#tree button.sample[data-sample="${targetSampleId}"]`).click();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  const target = page.locator(`#tree .population[data-sample="${targetSampleId}"]`).filter({ hasText: "◇ P1" }).first();
  await target.click({ button: "right" });
  const paste = page.getByRole("menuitem", { name: "クリップボードのゲートを「P1」の下へ貼り付け" });
  await expect(paste).toBeEnabled();
  await paste.click({ force: true });
  await expect(page.locator(`#tree .population[data-sample="${targetSampleId}"]`).filter({ hasText: "◇ P1 コピー" })).toBeVisible();
  await expect(page.locator(".status")).toContainText("チャンネル不一致の1ゲート");
});

for (const operation of ["copy", "cut"] as const) test(`${operation} global gate branch can be pasted under an individual parent`, async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("起動完了");
  await clickDemo(page);
  await expect(page.locator(".statistics")).toContainText("16,000");
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await clickDemo(page);
  await expect(page.locator("#tree button.sample[data-sample]")).toHaveCount(2);
  await expect(page.locator(".status")).not.toHaveClass(/pending/);

  const samples = page.locator("#tree button.sample[data-sample]");
  const sourceSampleId = await samples.nth(0).getAttribute("data-sample");
  const targetSampleId = await samples.nth(1).getAttribute("data-sample");
  await samples.nth(0).click();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  let stage = page.locator(".plot-stage").first();
  let bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + 95, bounds.y + 70);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 210, bounds.y + 165, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);

  const source = page.locator(`#tree .population[data-sample="${sourceSampleId}"]`).filter({ hasText: "◇ P1" }).first();
  await source.click({ button: "right" });
  await page.getByRole("menuitem", { name: `ゲート階層を${operation === "copy" ? "コピー" : "切り取り"}` }).click();

  await samples.nth(1).click();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await page.getByRole("button", { name: "個別適用", exact: true }).click();
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  stage = page.locator(".plot-stage").first();
  bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + 120, bounds.y + 90);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 230, bounds.y + 180, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);

  const parentName = operation === "copy" ? "P2" : "P1";
  const target = page.locator(`#tree .population[data-sample="${targetSampleId}"]`).filter({ hasText: `◇ ${parentName}` }).first();
  await target.click({ button: "right" });
  const paste = page.getByRole("menuitem", { name: `クリップボードのゲートを「${parentName}」の下へ貼り付け` });
  await expect(paste).toBeEnabled();
  await paste.click();

  const pasted = page.locator(`#tree .population[data-sample="${targetSampleId}"]`).filter({ hasText: "◇ P1 コピー" });
  await expect(pasted).toBeVisible();
  await expect(pasted).toContainText("個別");
  await expect(pasted).toHaveAttribute("title", new RegExp(`${parentName} \/ P1 コピー`));
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
});
