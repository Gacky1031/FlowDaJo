import { test, expect } from "@playwright/test";
import { clickDemo, clickToolbarAction } from "./helpers";

test("histograms merge by dragging, preserve either control in expansion, and roundtrip with colors and smoothing", async ({ page }) => {
  const requests: any[] = [], failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("request", (request) => {
    if (request.url().endsWith("/__test_rpc")) requests.push(request.postDataJSON());
  });
  await page.goto("/");
  for (let count = 1; count <= 3; count++) {
    await clickDemo(page);
    await expect(page.locator("button.sample")).toHaveCount(count);
  }
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  const samples = await page.locator("button.sample").evaluateAll((buttons) =>
    buttons.map((button) => (button as HTMLElement).dataset.sample!));
  await page.getByRole("button", { name: "Normal", exact: true }).click();
  await page.locator("[data-binding]").first().selectOption(samples[0]);
  await page.locator('[data-axis-label="x"]').first().click();
  await page.getByRole("dialog").getByRole("combobox").fill("FITC-A");
  await page.getByRole("dialog").getByRole("option").click();
  await page.locator("[data-mode]").first().selectOption("histogram");
  await page.locator("[data-duplicate]").first().click();
  await page.locator("[data-binding]").last().selectOption(samples[1]);
  await expect(page.locator(".status")).not.toHaveClass(/pending/);

  const firstGrip = (await page.locator(".plot-card .grip").first().boundingBox())!;
  const secondGrip = (await page.locator(".plot-card .grip").last().boundingBox())!;
  await page.mouse.move(secondGrip.x + 4, secondGrip.y + 4);
  await page.mouse.down();
  await page.mouse.move(firstGrip.x + 14, firstGrip.y + 14, { steps: 12 });
  await expect(page.locator(".histogram-drop-target")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator(".plot-card")).toHaveCount(1);
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await page.locator("#undo").click();
  await expect(page.locator(".plot-card")).toHaveCount(2);
  await page.locator("#redo").click();
  await expect(page.locator(".plot-card")).toHaveCount(1);

  await page.locator("[data-histogram-comparison]").click();
  let editor = page.getByRole("dialog", { name: "ヒストグラムの重ね合わせ比較" });
  await expect(editor.locator("[data-series]")).toHaveCount(2);
  await editor.locator('[name="control"][value="primary"]').check();
  await editor.locator('[data-series="primary"] [data-series-color="#666666"]').click();
  await editor.locator("[data-series]").last().locator('[data-series-color="#c33c54"]').click();
  await editor.getByRole("button", { name: "比較設定を適用" }).click();

  await page.locator("[data-histogram-axis]").click();
  await page.getByRole("menuitem", { name: "% Max", exact: true }).click();
  await expect(page.locator(".counts-label")).toHaveText("% Max");
  await page.locator("[data-histogram-axis]").click({ button: "right" });
  await page.getByRole("menuitem", { name: "ヒストグラムを平滑化", exact: true }).click();
  await page.locator("[data-plot-options]").click();
  const options = page.getByRole("dialog", { name: "プロット表示設定" });
  await expect(options.locator('[name="histogramSmoothing"]')).toBeChecked();
  await options.locator('[name="histogramNormalize"]').selectOption("mode");
  await options.getByRole("button", { name: "表示設定を適用" }).click();
  await expect(page.locator(".counts-label")).toHaveText("Normalized to Mode");
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  const originalId = await page.locator(".plot-card").getAttribute("data-card");
  const latestPlots = () => requests.findLast((request) => request.action === "save").project.worksheets[0].plots;
  const expandToThird = async () => {
    await page.locator(`[data-card="${originalId}"] [data-select-card]`).check();
    await page.locator(`[data-card="${originalId}"] .grip`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Normal: 選択項目を他サンプルへ展開…" }).click();
    const dialog = page.getByRole("dialog", { name: "Normal sheetの選択項目を他サンプルへ展開" });
    for (const input of await dialog.locator("[data-expansion-target]").all()) {
      if (await input.getAttribute("value") === samples[2]) await input.check();
      else await input.uncheck();
    }
    await dialog.getByRole("button", { name: "選択サンプルへ展開" }).click();
    await expect(page.locator(".plot-card")).toHaveCount(2);
    await expect(page.locator(".status")).not.toHaveClass(/pending/);
    await page.locator("#save").click();
    await expect(page.locator(".status")).toContainText("保存しました");
    return latestPlots().find((plot: any) => plot.id !== originalId);
  };
  let expanded = await expandToThird();
  expect(expanded.sampleId).toBe(samples[0]);
  expect(expanded.histogramControl).toBe("primary");
  expect(expanded.histogramOverlays[0].sampleId).toBe(samples[2]);
  expect(expanded.histogramOverlays[0].color).toBe("#c33c54");
  expect(expanded.histogramSmoothing).toBe(true);

  await page.locator("#undo").click();
  await expect(page.locator(".plot-card")).toHaveCount(1);
  await page.locator("[data-histogram-comparison]").click();
  editor = page.getByRole("dialog", { name: "ヒストグラムの重ね合わせ比較" });
  await editor.locator("[data-series]").last().locator('[name="control"]').check();
  await editor.getByRole("button", { name: "比較設定を適用" }).click();
  expanded = await expandToThird();
  expect(expanded.sampleId).toBe(samples[2]);
  expect(expanded.histogramControl).toBe(expanded.histogramOverlays[0].id);
  expect(expanded.histogramOverlays[0].sampleId).toBe(samples[1]);
  await clickToolbarAction(page, "#load");
  await expect(page.locator(".status")).toContainText("更新完了");
  await expect(page.locator(".plot-card")).toHaveCount(2);
  await expect(page.locator(".plot-error:visible")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/ui-histogram-comparison.png" });
  await page.locator('[data-sheet-mode="global"]').click();
  await expect(page.locator("[data-histogram-comparison]")).toHaveCount(0);
  await page.locator("#save").click();
  await expect(page.locator(".status")).toContainText("保存しました");
  latestPlots().forEach((plot: any) => {
    expect(plot.sampleId).toBe("active");
    expect(plot.histogramOverlays).toBeUndefined();
    expect(plot.histogramControl).toBeUndefined();
  });
  expect(failures).toEqual([]);
});

test("histogram merging is Normal-only, works from the selection menu, and clears a solitary control", async ({ page }) => {
  await page.goto("/");
  await clickDemo(page); await clickDemo(page);
  await expect(page.locator("button.sample")).toHaveCount(2);
  await page.locator("[data-mode]").first().selectOption("histogram");
  await page.locator("[data-duplicate]").first().click();
  const firstGrip = (await page.locator(".plot-card .grip").first().boundingBox())!;
  const secondGrip = (await page.locator(".plot-card .grip").last().boundingBox())!;
  await page.mouse.move(secondGrip.x + 4, secondGrip.y + 4);
  await page.mouse.down();
  await page.mouse.move(firstGrip.x + 14, firstGrip.y + 14, { steps: 8 });
  await expect(page.locator(".histogram-drop-target")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator(".plot-card")).toHaveCount(2);
  await expect(page.locator("[data-histogram-comparison]")).toHaveCount(0);
  await page.locator("#undo").click();
  await page.locator('[data-sheet-mode="normal"]').click();
  const sampleIds = await page.locator("button.sample").evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.sample!));
  await page.locator("[data-binding]").first().selectOption(sampleIds[0]);
  await page.locator("[data-binding]").last().selectOption(sampleIds[1]);
  await page.locator("[data-select-card]").first().check();
  await page.locator("[data-select-card]").last().check();
  await page.locator(".plot-card .grip").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "選択ヒストグラムを重ね合わせる", exact: true }).click();
  await expect(page.locator(".plot-card")).toHaveCount(1);
  await page.locator("[data-histogram-comparison]").click();
  const editor = page.getByRole("dialog", { name: "ヒストグラムの重ね合わせ比較" });
  await expect(editor.locator("[data-series]")).toHaveCount(2);
  await editor.locator('[name="control"][value="primary"]').check();
  await editor.locator("[data-remove-series]").click();
  await expect(editor.locator('[name="control"][value="primary"]')).toBeDisabled();
  await expect(editor.locator('[name="control"][value=""]')).toBeChecked();
  await editor.getByRole("button", { name: "比較設定を適用" }).click();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await expect(page.locator(".plot-error:visible")).toHaveCount(0);
});
