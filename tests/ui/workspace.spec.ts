import { test, expect, type Page } from "@playwright/test";
import { statSync } from "node:fs";
async function changeX(page: Page, name: string) {
  await page.locator('[data-axis-label="x"]').last().click();
  await page.getByRole("combobox", { name: "チャンネルを検索" }).fill(name);
  await page.getByRole("dialog").getByRole("option").click();
}
test("global worksheet: free plots, editing, responsive jobs, axes, comparison and persistence", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("起動完了");
  await page.getByRole("button", { name: "デモ", exact: true }).click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  for (let i = 0; i < 5; i++) await page.locator("#add-plot").click();
  await expect(page.locator(".plot-card")).toHaveCount(6);
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await expect(page.locator(".plot-error:visible")).toHaveCount(0);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const stage = page.locator(".plot-stage").first(),
    box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + 75, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + 175, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".statistics tbody tr")).toHaveCount(2);
  const colorPicker = page.locator("[data-gate-color]").last();
  await expect(colorPicker).toBeVisible();
  await colorPicker.click();
  await page.locator('.gate-color-dialog [data-swatch="#c33c54"]').click();
  await expect(page.locator("[data-gate-color]").last()).toHaveAttribute("style", /#c33c54/);
  const initial = await page
    .locator(".statistics tbody tr")
    .nth(1)
    .locator("td")
    .nth(1)
    .innerText();
  expect(Number(initial.replaceAll(",", ""))).toBeGreaterThan(0);
  await expect(page.locator("#add-plot")).toBeEnabled();
  const handle = stage.locator("circle").nth(1),
    point = (await handle.boundingBox())!;
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    point.x + point.width / 2 + 35,
    point.y + point.height / 2 - 25,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(
    page.locator(".statistics tbody tr").nth(1).locator("td").nth(1),
  ).not.toHaveText(initial);
  await page.locator("#undo").click();
  await expect(
    page.locator(".statistics tbody tr").nth(1).locator("td").nth(1),
  ).toHaveText(initial);
  await page.getByText("◇ P1", { exact: true }).dblclick();
  await expect(page.locator(".plot-card")).toHaveCount(7);
  await page.locator("[data-mode]").last().selectOption("histogram");
  await changeX(page, "FITC-A");
  await page.locator('[data-axis-label="x"]').last().click({ button: "right" });
  await page.getByLabel("データに合わせて自動調整").uncheck();
  await page.locator('[name="min"]').fill("-1");
  await page.locator('[name="max"]').fill("5");
  await page.locator('[name="w"]').fill("0.7");
  await page
    .getByRole("button", { name: "適用して閉じる", exact: true })
    .click();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await expect(page.locator(".plot-error:visible")).toHaveCount(0);
  // Start delayed R transport, then change state twice; UI must accept both edits.
  await page.route("**/__test_rpc", async (route) => {
    await new Promise((r) => setTimeout(r, 350));
    await route.continue();
  });
  await changeX(page, "PE-A");
  await expect(page.locator("#add-plot")).toBeEnabled();
  await changeX(page, "APC-A");
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await expect(page.locator('[data-axis-label="x"]').last()).toContainText(
    "APC-A",
  );
  await page.unroute("**/__test_rpc");
  await expect(page.locator("[data-binding]")).toHaveCount(0);
  await expect(page.locator(".global-plot-sample")).toHaveCount(7);
  await expect(page.locator(".global-plot-sample").first()).toContainText("Demo · 3 populations");
  await page.locator("#demo").click();
  await expect(page.locator(".sample")).toHaveCount(2);
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await expect(page.locator(".global-plot-sample").first()).toContainText("Demo 2");
  // Global gates are shared by every sample, so the same drill-down path remains valid.
  await expect(page.locator(".plot-error:visible")).toHaveCount(0);
  await page.locator(".sample").first().click();
  await expect(page.locator(".global-plot-sample").first()).toContainText("Demo · 3 populations");
  await expect(page.locator("[data-binding]")).toHaveCount(0);
  await expect(page.locator(".plot-error:visible")).toHaveCount(0);
  await page.locator("#save").click();
  await expect(page.locator(".status")).toContainText("保存しました");
  await page.locator("#new-sheet").click();
  await page.locator("#add-plot").click();
  await expect(page.locator(".plot-card")).toHaveCount(1);
  await page.locator("#load").click();
  await expect(page.locator(".plot-card")).toHaveCount(7);
  await expect(page.locator("[data-mode]").last()).toHaveValue("histogram");
  await expect(page.locator('[data-axis-label="x"]').last()).toContainText(
    "APC-A",
  );
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await expect(page.locator(".plot-error:visible")).toHaveCount(0);
  await expect(page.locator(".statistics tbody tr")).toHaveCount(2);
  await page.screenshot({
    path: "artifacts/worksheet-ui-regression.png",
    fullPage: true,
  });
  expect(failures).toEqual([]);
});

test("polygon vertices, grouped quadrants, layout drag/resize and batch gates", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("起動完了");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  const stage = page.locator(".plot-stage").first(),
    box = (await stage.boundingBox())!;
  await page.getByRole("button", { name: "多角形", exact: true }).click();
  await page.mouse.click(box.x + 90, box.y + 100);
  await page.mouse.click(box.x + 200, box.y + 100);
  await page.mouse.dblclick(box.x + 135, box.y + 180);
  await expect(page.locator(".statistics tbody tr")).toHaveCount(2);
  const before = await page
    .locator(".statistics tbody tr")
    .nth(1)
    .locator("td")
    .nth(1)
    .innerText();
  const vertex = (await stage.locator("circle").first().boundingBox())!;
  await page.mouse.move(vertex.x + 4, vertex.y + 4);
  await page.mouse.down();
  await page.mouse.move(vertex.x - 25, vertex.y - 35, { steps: 6 });
  await page.mouse.up();
  await expect(
    page.locator(".statistics tbody tr").nth(1).locator("td").nth(1),
  ).not.toHaveText(before);
  await page.getByRole("button", { name: "四分割", exact: true }).click();
  await page.mouse.click(box.x + 170, box.y + 100);
  await expect(page.locator(".statistics tbody tr")).toHaveCount(6);
  const quadrantCounts = async () =>
    Promise.all(
      (await page.locator(".statistics tbody tr").all())
        .slice(2)
        .map(async (row) =>
          Number(
            (await row.locator("td").nth(1).innerText()).replaceAll(",", ""),
          ),
        ),
    );
  const original = await quadrantCounts();
  expect(original.reduce((a, b) => a + b, 0)).toBe(16000);
  const center = (await stage.locator("circle").last().boundingBox())!;
  await page.mouse.move(center.x + 4, center.y + 4);
  await page.mouse.down();
  await page.mouse.move(center.x + 30, center.y + 25, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  const moved = await quadrantCounts();
  expect(moved.reduce((a, b) => a + b, 0)).toBe(16000);
  expect(moved).not.toEqual(original);
  const c = page.locator(".plot-card").first();
  const old = (await c.boundingBox())!;
  const grip = (await c.locator(".grip").boundingBox())!;
  await page.mouse.move(grip.x + 4, grip.y + 5);
  await page.mouse.down();
  await page.mouse.move(grip.x + 70, grip.y + 35, { steps: 5 });
  await page.mouse.up();
  expect((await c.boundingBox())!.x).toBeGreaterThan(old.x + 50);
  const resize = (await c.locator(".resize-grip").boundingBox())!;
  await page.mouse.move(resize.x + 3, resize.y + 3);
  await page.mouse.down();
  await page.mouse.move(resize.x + 43, resize.y + 33, { steps: 6 });
  await page.mouse.up();
  expect((await c.boundingBox())!.width).toBeGreaterThan(old.width + 25);
  await page.locator("#demo").click();
  await expect(page.locator(".sample")).toHaveCount(2);
  await page.locator(".sample").first().click();
  await page.locator("#batch").click();
  await page.locator("dialog input").check();
  await page.locator("#batch-apply").click();
  await page.locator(".sample").last().click();
  await expect(page.locator(".statistics tbody tr")).toHaveCount(6);
  expect((await quadrantCounts()).reduce((a, b) => a + b, 0)).toBe(16000);
  expect(failures).toEqual([]);
});

test("normal worksheet expands one plot from its context menu", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  await page.locator("#demo").click();
  await expect(page.locator(".sample")).toHaveCount(2);
  await page.getByRole("button", { name: "Normal", exact: true }).click();
  await expect(page.locator('[data-sheet-mode="normal"]')).toHaveClass(/active/);
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await page.locator(".plot-stage").first().click({ button: "right", position: { x: 160, y: 140 } });
  await page.getByRole("menuitem", { name: /Normal: 選択項目を他サンプルへ展開/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator("#batch-plots-apply").click();
  await expect(page.locator(".plot-card")).toHaveCount(2);
  await expect(page.locator(".status")).toContainText("プロット 1個、ウィジェット 0個を展開しました");
});

test("normal worksheet expands multiple selected plots to every chosen sample", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  await page.locator("#add-plot").click();
  await page.locator("#demo").click();
  await expect(page.locator(".sample")).toHaveCount(2);
  await page.locator("#demo").click();
  await expect(page.locator(".sample")).toHaveCount(3);
  await page.getByRole("button", { name: "Normal", exact: true }).click();
  await expect(page.locator('[data-sheet-mode="normal"]')).toHaveClass(/active/);
  await page.locator("[data-select-card]").nth(0).check();
  await page.locator("[data-select-card]").nth(1).check();
  await expect(page.locator("#selection-info")).toHaveText("選択: 2");
  await page.locator(".worksheet-actions-menu > summary").click();
  await page.locator("#batch-plots-sheet").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").locator('input[type="checkbox"]')).toHaveCount(2);
  await page.locator("#batch-plots-apply").click();
  await expect(page.locator(".plot-card")).toHaveCount(6);
  await expect(page.locator(".status")).toContainText("プロット 4個、ウィジェット 0個を展開しました");
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await page.locator(".plot-card").first().click();
  await page.locator("#toggle-properties").click();
  const sourceAxis = await page.locator(".axis-summary").innerText();
  await page.locator("#close-properties").click();
  await page.locator(".plot-card").last().click();
  await page.locator("#toggle-properties").click();
  const targetAxis = await page.locator(".axis-summary").innerText();
  expect(targetAxis).toBe(sourceAxis);
  expect(targetAxis).not.toContain("Auto range");
});

test("sidebar population drag drop and custom grid arrangement", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  const root = page.locator('.population[data-pop="root"]');
  await expect(root).toBeVisible();
  await root.dragTo(page.locator(".board"), { targetPosition: { x: 520, y: 420 } });
  await expect(page.locator(".plot-card")).toHaveCount(2);
  const droppedPlot = (await page.locator(".plot-card").last().boundingBox())!;
  const statisticsWidget = (await page.locator(".statistics-widget").boundingBox())!;
  const clearOfStatistics = droppedPlot.x >= statisticsWidget.x + statisticsWidget.width ||
    droppedPlot.x + droppedPlot.width <= statisticsWidget.x ||
    droppedPlot.y >= statisticsWidget.y + statisticsWidget.height ||
    droppedPlot.y + droppedPlot.height <= statisticsWidget.y;
  expect(clearOfStatistics).toBe(true);
  await page.locator("#demo").click();
  await expect(page.locator(".sample")).toHaveCount(2);
  await page.getByRole("button", { name: "Normal", exact: true }).click();
  await page.locator("[data-select-card]").nth(0).check();
  await page.locator("[data-select-card]").nth(1).check();
  await page.locator(".worksheet-actions-menu > summary").click();
  await expect(page.getByRole("button", { name: "Normal 選択項目を展開" })).toHaveCount(1);
  await page.locator(".grid-arrange-menu > summary").click();
  await page.locator('#grid-arrange-form [name="rows"]').fill("1");
  await page.locator('#grid-arrange-form [name="columns"]').fill("2");
  await page.locator('#grid-arrange-form [name="scope"]').selectOption("selected");
  await page.locator('#grid-arrange-form button[type="submit"]').click();
  await expect(page.locator(".plot-card")).toHaveCount(2);
  await expect(page.locator(".plot-card").nth(0)).toHaveCSS("left", "24px");
  await expect(page.locator(".plot-card").nth(1)).toHaveCSS("left", "384px");
});

test("bulk plot settings combine axes and displayed populations", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  await page.locator("#add-plot").click();
  await page.locator("[data-select-card]").nth(0).check();
  await page.locator("[data-select-card]").nth(1).check();
  await page.locator(".plot-stage").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "選択した2プロットの軸・表示分画を変更…" }).click();
  const dialog = page.getByRole("dialog", { name: "選択プロットの一括変更" });
  await expect(dialog.locator("[name=applyX]")).toBeVisible();
  await expect(dialog.locator("[name=applyY]")).toBeVisible();
  await expect(dialog.locator("[name=applyPopulation]")).toBeVisible();
  await expect(dialog.locator("[name=applyGates]")).toBeVisible();
  await expect(dialog.getByText("表示する分画")).toBeVisible();
  await expect(dialog.getByText("ゲート輪郭", { exact: true })).toBeVisible();
  await dialog.locator('[name="xChannel"]').selectOption("FITC-A");
  await expect(dialog.locator('[name="applyX"]')).toBeChecked();
  await dialog.getByRole("button", { name: "キャンセル" }).click();
});

test("selected plots change their actual population across different axes", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics tbody")).toContainText("16,000");
  const stage = page.locator(".plot-stage").first();
  const box = (await stage.boundingBox())!;
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.mouse.move(box.x + 75, box.y + 90);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 185, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".statistics tbody tr")).toHaveCount(2);
  const p1Count = Number((await page.locator(".statistics tbody tr").nth(1).locator("td").nth(1).innerText()).replaceAll(",", ""));
  expect(p1Count).toBeGreaterThan(0);

  await page.locator("#add-plot").click();
  await changeX(page, "FITC-A");
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await page.locator("[data-select-card]").nth(0).check();
  await page.locator("[data-select-card]").nth(1).check();
  const plotIds = await page.locator(".plot-card").evaluateAll((cards) =>
    cards.map((card) => (card as HTMLElement).dataset.card!),
  );
  await page.locator(".plot-stage").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "選択した2プロットの軸・表示分画を変更…" }).click();
  const dialog = page.getByRole("dialog", { name: "選択プロットの一括変更" });
  await dialog.locator('[name="applyPopulation"]').check();
  await expect(dialog.locator('[name="applyGates"]')).not.toBeChecked();
  await dialog.locator('[name="populationPath"]').selectOption(JSON.stringify(["P1"]));
  const worksheetResponse = page.waitForResponse((response) =>
    response.url().endsWith("/__test_rpc") &&
    (response.request().postDataJSON() as { action?: string }).action === "worksheet",
  );
  await dialog.getByRole("button", { name: "選択プロットへ適用" }).click();
  const result = (await (await worksheetResponse).json()).data;
  expect(plotIds.map((id) => result.plots[id].total)).toEqual([p1Count, p1Count]);
  await expect(page.locator('[data-population]').nth(0)).toHaveValue(JSON.stringify(["P1"]));
  await expect(page.locator('[data-population]').nth(1)).toHaveValue(JSON.stringify(["P1"]));
  await expect(page.locator(".plot-card").nth(1).locator('[data-axis-label="x"]')).toContainText("FITC-A");
});

test("gate outlines can be assigned across plots with different axes", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  const stage = page.locator(".plot-stage").first();
  const box = (await stage.boundingBox())!;
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.mouse.move(box.x + 75, box.y + 90);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 185, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".statistics tbody tr")).toHaveCount(2);
  await page.locator("#add-plot").click();
  await changeX(page, "FITC-A");
  await page.locator("[data-select-card]").nth(0).check();
  await page.locator("[data-select-card]").nth(1).check();
  await page.locator(".plot-stage").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "選択した2プロットのゲート輪郭を選択…" }).click();
  const dialog = page.getByRole("dialog", { name: "選択プロットの一括変更" });
  await dialog.locator('[name="applyGates"]').check();
  const gate = dialog.locator("[data-batch-gate-choice]");
  await expect(gate).toHaveCount(1);
  await expect(gate.locator("xpath=..")).toContainText("1/2で輪郭表示");
  await gate.check();
  await dialog.getByRole("button", { name: "選択プロットへ適用" }).click();
  await expect(page.locator(".status")).toContainText("ゲート輪郭 2/2プロット");
  await changeX(page, "FSC-A");
  await expect(page.locator(".plot-stage").nth(1).locator("svg [data-shape]").first()).toBeVisible();
});

test("gate outlines can be changed from a gate right-click menu", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics tbody")).toContainText("16,000");
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  const stage = page.locator(".plot-stage").first();
  const box = (await stage.boundingBox())!;
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.mouse.move(box.x + 75, box.y + 90);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 185, { steps: 6 });
  await page.mouse.up();
  await expect(stage.locator("svg g.gate-shape")).toHaveCount(1);

  // Gate boundaries are the most likely right-click target while editing a
  // worksheet, so the plot-level display controls must remain available there.
  const gateShape = stage.locator("svg g.gate-shape").first();
  const gateBox = (await gateShape.boundingBox())!;
  await gateShape.dispatchEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: gateBox.x + 2,
    clientY: gateBox.y + 2,
  });
  const menu = page.getByRole("menu");
  const displayAction = menu.getByRole("menuitem", { name: "ゲート輪郭を選択…", exact: true });
  await expect(displayAction).toBeEnabled();
  await displayAction.click();
  const dialog = page.getByRole("dialog", { name: "選択プロットの一括変更" });
  const gate = dialog.locator("[data-batch-gate-choice]");
  await expect(gate).toHaveCount(1);
  await expect(gate).toBeChecked();
  await gate.uncheck();
  await dialog.getByRole("button", { name: "選択プロットへ適用" }).click();
  await expect(stage.locator("svg g.gate-shape")).toHaveCount(0);

  await stage.click({ button: "right", position: { x: 280, y: 220 } });
  await page.getByRole("menuitem", { name: "ゲート輪郭を選択…", exact: true }).click();
  const restore = page.getByRole("dialog", { name: "選択プロットの一括変更" });
  await restore.locator("[data-batch-gate-choice]").check();
  await restore.getByRole("button", { name: "選択プロットへ適用" }).click();
  await expect(stage.locator("svg g.gate-shape")).toHaveCount(1);
});

test("gate outline switch works on a plot showing the gated population", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics tbody")).toContainText("16,000");
  const stage = page.locator(".plot-stage").first();
  const box = (await stage.boundingBox())!;
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.mouse.move(box.x + 75, box.y + 90);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 185, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".statistics tbody tr")).toHaveCount(2);
  await page.getByText("◇ P1", { exact: true }).dblclick();
  const child = page.locator(".plot-card").last();
  await expect(child.locator("[data-population]")).toHaveValue(JSON.stringify(["P1"]));
  await expect(child.locator("svg g.gate-shape")).toHaveCount(0);
  await child.getByRole("button", { name: "表示するゲートを選択" }).click();
  let dialog = page.getByRole("dialog", { name: "選択プロットの一括変更" });
  await expect(dialog.locator('[name="applyGates"]')).toBeChecked();
  await dialog.locator("[data-batch-gate-choice]").check();
  await dialog.getByRole("button", { name: "選択プロットへ適用" }).click();
  await expect(child.locator("svg g.gate-shape")).toHaveCount(1);
  await expect(child.locator("[data-population]")).toHaveValue(JSON.stringify(["P1"]));
  await child.getByRole("button", { name: "表示するゲートを選択" }).click();
  dialog = page.getByRole("dialog", { name: "選択プロットの一括変更" });
  await dialog.locator("[data-batch-gate-choice]").uncheck();
  await dialog.getByRole("button", { name: "選択プロットへ適用" }).click();
  await expect(child.locator("svg g.gate-shape")).toHaveCount(0);
});

test("statistics widget defaults to all populations and allows a hidden population", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics tbody tr")).toHaveCount(1);
  const stage = page.locator(".plot-stage").first();
  const box = (await stage.boundingBox())!;
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.mouse.move(box.x + 75, box.y + 90);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 185, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".statistics tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "統計ウィジェットの表示項目を設定" }).click();
  let dialog = page.locator("dialog.statistics-settings-dialog");
  const p1 = dialog.locator('[name="visiblePopulationPath"]').nth(1);
  await expect(dialog.locator('[name="visiblePopulationPath"]')).toHaveCount(2);
  await expect(p1).toBeChecked();
  await p1.uncheck();
  await dialog.getByRole("button", { name: "適用" }).click();
  await expect(page.locator(".statistics tbody tr")).toHaveCount(1);
  await expect(page.locator(".statistics tbody")).not.toContainText("P1");
  await page.getByRole("button", { name: "統計ウィジェットの表示項目を設定" }).click();
  dialog = page.locator("dialog.statistics-settings-dialog");
  await dialog.getByRole("button", { name: "すべて表示" }).click();
  await dialog.getByRole("button", { name: "適用" }).click();
  await expect(page.locator(".statistics tbody tr")).toHaveCount(2);
});

test("sample order supports name, import and drag ordering plus arrow navigation", async ({ page }) => {
  const names = ["Zeta", "Alpha", "Beta"];
  let imported = 0;
  await page.route("**/__test_rpc", async (route) => {
    const request = route.request().postDataJSON() as { action?: string };
    if (request.action !== "demo") { await route.continue(); return; }
    const response = await route.fetch();
    const body = await response.json();
    body.data.samples[0].id = `order-${imported + 1}`;
    body.data.samples[0].name = names[imported++];
    await route.fulfill({ response, json: body });
  });
  await page.goto("/");
  for (let i = 0; i < 3; i++) {
    await page.locator("#demo").click();
    await expect(page.locator("button.sample")).toHaveCount(i + 1);
  }
  await expect(page.locator("button.sample")).toHaveCount(3);
  const order = () => page.locator("button.sample").evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.sample));
  expect(await order()).toEqual(["order-1", "order-2", "order-3"]);
  await page.getByRole("combobox", { name: "サンプルの並び順" }).selectOption("name");
  expect(await order()).toEqual(["order-2", "order-3", "order-1"]);
  await page.getByRole("combobox", { name: "サンプルの並び順" }).selectOption("import");
  expect(await order()).toEqual(["order-1", "order-2", "order-3"]);
  await page.locator('button.sample[data-sample="order-3"]').dragTo(page.locator('button.sample[data-sample="order-1"]'), { targetPosition: { x: 20, y: 3 } });
  expect(await order()).toEqual(["order-3", "order-1", "order-2"]);
  await expect(page.getByRole("combobox", { name: "サンプルの並び順" })).toHaveValue("manual");
  await page.locator('button.sample[data-sample="order-3"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("button.sample.selected")).toHaveAttribute("data-sample", "order-1");
  await expect(page.locator('button.sample[data-sample="order-1"]')).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("button.sample.selected")).toHaveAttribute("data-sample", "order-3");
  await page.locator("#save").click();
  await expect(page.locator(".status")).toContainText("保存しました");
  await page.getByRole("combobox", { name: "サンプルの並び順" }).selectOption("name");
  await page.locator("#load").click();
  await expect.poll(order).toEqual(["order-3", "order-1", "order-2"]);
  await expect(page.getByRole("combobox", { name: "サンプルの並び順" })).toHaveValue("manual");
});

test("A4 worksheet frames can move, rotate and produce multiple PDF pages", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics tbody")).toContainText("16,000", { timeout: 45_000 });
  const first = page.locator(".print-page").first();
  await expect(first).toHaveCSS("width", "1123px");
  const handle = (await first.locator("[data-print-move]").boundingBox())!;
  await page.mouse.move(handle.x + 35, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle.x + 43, handle.y + 18, { steps: 4 });
  await page.mouse.up();
  await expect(first).toHaveCSS("left", "8px");
  await expect(first).toHaveCSS("top", "8px");
  await page.locator("#add-print-page").click();
  await expect(page.locator(".print-page")).toHaveCount(2);
  await page.locator("[data-print-orientation]").last().click();
  await expect(page.locator(".print-page").last()).toHaveCSS("width", "794px");
  await expect(page.locator(".print-page").last()).toHaveCSS("height", "1123px");
  const corner = first.locator("[data-print-turn]");
  await corner.scrollIntoViewIfNeeded();
  const cornerBox = (await corner.boundingBox())!;
  await page.mouse.move(cornerBox.x + cornerBox.width / 2, cornerBox.y + cornerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cornerBox.x - 390, cornerBox.y + cornerBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(first).toHaveCSS("width", "794px");
  await page.locator("[data-print-orientation]").last().click();
  await expect(page.locator(".print-page").last()).toHaveCSS("width", "1123px");
  await page.locator("#save").click();
  await expect(page.locator(".status")).toContainText("保存しました");
  await page.locator("#load").click();
  await expect(page.locator(".print-page")).toHaveCount(2);
  await expect(page.locator(".print-page").first()).toHaveCSS("left", "8px");
  await expect(page.locator(".print-page").first()).toHaveCSS("width", "794px");
  await expect(page.locator(".print-page").last()).toHaveCSS("width", "1123px");
  await expect(page.locator(".status")).toContainText("更新完了", { timeout: 30_000 });
  await page.locator("#pdf").click();
  await expect(page.locator(".status")).toContainText("PDFを保存しました");
  expect(statSync("artifacts/ui-worksheet.pdf").size).toBeGreaterThan(1000);
});

test("plot context menu changes one plot or the selected group directly", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  await page.locator("#add-plot").click();
  await page.locator("#add-plot").click();
  await page.locator("[data-select-card]").nth(0).check();
  await page.locator("[data-select-card]").nth(1).check();

  await page.locator(".plot-stage").nth(0).click({ button: "right" });
  await page.getByRole("menuitem", { name: "選択した2プロットの軸・表示分画を変更…" }).click();
  let dialog = page.getByRole("dialog", { name: "選択プロットの一括変更" });
  await expect(dialog.getByText("2個の選択プロットが対象です。", { exact: false })).toBeVisible();
  await dialog.locator('[name="applyX"]').check();
  await expect(dialog.locator('[name="applyY"]')).not.toBeChecked();
  await dialog.locator('[name="xChannel"]').selectOption({ label: "FITC-A" });
  await dialog.getByRole("button", { name: "選択プロットへ適用" }).click();
  await expect(page.locator(".plot-card").nth(0).locator('[data-axis-label="x"]')).toContainText("FITC-A");
  await expect(page.locator(".plot-card").nth(1).locator('[data-axis-label="x"]')).toContainText("FITC-A");

  await page.locator(".plot-stage").nth(2).click({ button: "right" });
  await page.getByRole("menuitem", { name: "軸・表示分画を変更…", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "選択プロットの一括変更" });
  await expect(dialog.getByText("1個の選択プロットが対象です。", { exact: false })).toBeVisible();
  await dialog.locator('[name="applyX"]').check();
  await dialog.locator('[name="xChannel"]').selectOption({ label: "PE-A" });
  await dialog.getByRole("button", { name: "選択プロットへ適用" }).click();
  await expect(page.locator(".plot-card").nth(2).locator('[data-axis-label="x"]')).toContainText("PE-A");
  await expect(page.locator(".plot-card").nth(0).locator('[data-axis-label="x"]')).toContainText("FITC-A");

  await page.locator(".plot-stage").nth(2).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "軸・表示分画を変更…", exact: true })).toBeEnabled();
  await expect(page.getByRole("menuitem", { name: "X軸チャンネルを選択…", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "ゲート輪郭を選択…", exact: true })).toBeDisabled();
});

test("worksheet tab context menu deletes the last sheet and creates a blank one", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".plot-card")).toHaveCount(1);
  await page.locator("[data-sheet]").click({ button: "right" });
  await page.getByRole("menuitem", { name: "このワークシートを削除…" }).click();
  await expect(page.locator(".sheet-tabs [data-sheet]")).toHaveCount(1);
  await expect(page.locator(".plot-card")).toHaveCount(0);
  await expect(page.locator(".print-page")).toHaveCount(1);
  await expect(page.locator("#sheet-name")).toHaveValue("Global worksheet");
});

test("compensation worksheet widget applies its edited matrix only to checked samples", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await page.locator("#demo").click();
  await expect(page.locator(".sample")).toHaveCount(2);
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await page.locator(".widget-add-menu > summary").click();
  await expect(page.locator(".widget-add-menu")).toHaveAttribute("open", "");
  await page.locator("#compensation-widget-add").click();
  const widget = page.locator(".compensation-widget");
  await expect(widget).toBeVisible();
  await expect(widget.locator("[data-comp-target]")).toHaveCount(2);
  await expect(widget.locator("[data-comp-target]:checked")).toHaveCount(1);
  const activeSample = await page.locator(".sample.selected").getAttribute("data-sample");
  // The active source is checked by default; add the other sample explicitly.
  await widget.locator("[data-comp-target]:not(:checked)").first().check();
  await expect(widget.locator("[data-comp-target]:checked")).toHaveCount(2);
  await expect(page.locator(".sample.selected")).toHaveAttribute("data-sample", activeSample!);
  await widget.locator("[data-comp-enabled]").check();
  await widget.locator("[data-comp-matrix]:not(:disabled)").first().fill("3.5");
  await widget.locator("[data-apply-comp-widget]").click();
  expect(await page.locator(".status").innerText()).toContain("Demo · 3 populations、Demo 2");
  await expect(page.locator(".sample").filter({ hasText: "Comp ON" })).toHaveCount(2);
  await expect(page.locator(".plot-error:visible")).toHaveCount(0);
});

test("compensation widget lets users toggle the displayed matrix channels", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  await page.locator(".widget-add-menu > summary").click();
  await page.locator("#compensation-widget-add").click();
  const widget = page.locator(".compensation-widget");
  const channelToggles = widget.locator("[data-comp-visible-channel]");
  const channelCount = await channelToggles.count();
  expect(channelCount).toBeGreaterThan(1);
  await expect(widget.locator(".comp-widget-matrix thead th")).toHaveCount(channelCount + 1);
  await widget.locator(".comp-channel-visibility > summary").click();
  await channelToggles.first().uncheck();
  await expect(widget.locator("[data-comp-visible-channel]:checked")).toHaveCount(channelCount - 1);
  await expect(widget.locator(".comp-widget-matrix thead th")).toHaveCount(channelCount);
  await widget.locator("[data-comp-visible-channel]").first().check();
  await expect(widget.locator(".comp-widget-matrix thead th")).toHaveCount(channelCount + 1);
});

test("compensation preset adds a widget showing only the selected Y-axis channels", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  await page.locator(".worksheet-actions-menu > summary").click();
  await page.locator("#compensation-expansion").click();
  const dialog = page.getByRole("dialog", { name: "Compensation解析の蛍光Y軸を選択" });
  const choices = dialog.locator('input[name="channel"]');
  await expect(choices).toHaveCount(3);
  const selectedChannel = await choices.first().inputValue();
  await choices.nth(1).uncheck();
  await choices.nth(2).uncheck();
  await dialog.getByRole("button", { name: "選択したY軸を追加" }).click();
  const widget = page.locator(".compensation-widget");
  await expect(widget).toBeVisible();
  await expect(widget.locator("[data-comp-visible-channel]")).toHaveCount(3);
  await expect(widget.locator("[data-comp-visible-channel]:checked")).toHaveCount(1);
  await expect(widget.locator(`[data-comp-visible-channel][value="${selectedChannel}"]`)).toBeChecked();
  await expect(widget.locator(".comp-widget-matrix thead th")).toHaveCount(2);
});

test("normal to global asks before changing sample bindings", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await page.getByRole("button", { name: "Normal", exact: true }).click();
  await page.evaluate(() => { (window as Window & { __FLOWDESK_TEST_CONFIRM__?: boolean }).__FLOWDESK_TEST_CONFIRM__ = false; });
  await page.locator('[data-sheet-mode="global"]').click();
  await expect(page.locator('[data-sheet-mode="normal"]')).toHaveClass(/active/);
  await page.evaluate(() => { (window as Window & { __FLOWDESK_TEST_CONFIRM__?: boolean }).__FLOWDESK_TEST_CONFIRM__ = true; });
  await page.locator('[data-sheet-mode="global"]').click();
  await expect(page.locator('[data-sheet-mode="global"]')).toHaveClass(/active/);
});

test("normal statistics widget switches samples and expands to other samples", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics tbody tr")).not.toHaveCount(0);
  await page.locator("#demo").click();
  await expect(page.locator(".sample")).toHaveCount(2);
  await page.getByRole("button", { name: "Normal", exact: true }).click();
  const widget = page.locator(".statistics-widget");
  const samplePicker = widget.locator("[data-statistics-sample]");
  await expect(samplePicker).toHaveCount(1);
  const initialSample = await samplePicker.inputValue();
  const otherSample = await samplePicker.locator("option").evaluateAll((options, current) =>
    (options as HTMLOptionElement[]).find((option) => option.value !== current)?.value ?? "",
    initialSample,
  );
  expect(otherSample).not.toBe("");
  await samplePicker.selectOption(otherSample);
  await expect(samplePicker).toHaveValue(otherSample);
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await expect(widget.locator("tbody tr")).not.toHaveCount(0);

  await widget.click({ button: "right", position: { x: 280, y: 12 } });
  await page.getByRole("menuitem", { name: "Normal: 選択項目を他サンプルへ展開…" }).click();
  const dialog = page.getByRole("dialog", { name: "Normal sheetの選択項目を他サンプルへ展開" });
  await expect(dialog.locator("[data-expansion-target]")).toHaveCount(1);
  await dialog.getByRole("button", { name: "選択サンプルへ展開" }).click();
  await expect(page.locator(".statistics-widget")).toHaveCount(2);
  await expect(page.locator("[data-statistics-sample]")).toHaveCount(2);
  const assignedSamples = await page.locator("[data-statistics-sample]").evaluateAll((selects) =>
    (selects as HTMLSelectElement[]).map((select) => select.value).sort(),
  );
  expect(new Set(assignedSamples).size).toBe(2);
  await expect(page.locator(".statistics-widget tbody tr").first()).not.toHaveCount(0);
});

test("normal sheet expands selected plots and both widget types in either direction", async ({ page }) => {
  await page.goto("/");
  for (let count = 1; count <= 3; count++) {
    await page.locator("#demo").click();
    await expect(page.locator("button.sample")).toHaveCount(count);
  }
  const sampleIds = await page.locator("button.sample").evaluateAll((buttons) =>
    buttons.map((button) => (button as HTMLElement).dataset.sample!));
  await page.getByRole("button", { name: "Normal", exact: true }).click();
  await page.locator(".widget-add-menu > summary").click();
  await page.locator("#compensation-widget-add").click();
  await expect(page.locator(".compensation-widget")).toHaveCount(1);
  const position = async (selector: string, index: number) => page.locator(selector).nth(index).evaluate((node) => ({
    left: Number.parseFloat((node as HTMLElement).style.left),
    top: Number.parseFloat((node as HTMLElement).style.top),
  }));
  const originals = await Promise.all([
    position(".plot-card", 0), position(".statistics-widget", 0), position(".compensation-widget", 0),
  ]);
  await page.locator("[data-select-card]").first().check();
  await page.locator(".statistics-widget [data-select-widget]").check();
  await page.locator(".compensation-widget [data-select-widget]").check();
  await expect(page.locator("#selection-info")).toHaveText("選択: 3");
  await page.locator(".worksheet-actions-menu > summary").click();
  await page.locator("#batch-plots-sheet").click();
  let dialog = page.getByRole("dialog", { name: "Normal sheetの選択項目を他サンプルへ展開" });
  await dialog.getByRole("radio", { name: "縦方向" }).check();
  await dialog.locator(`[data-expansion-target][value="${sampleIds[1]}"]`).uncheck();
  await dialog.getByRole("button", { name: "選択サンプルへ展開" }).click();
  await expect(page.locator(".plot-card")).toHaveCount(2);
  await expect(page.locator(".statistics-widget")).toHaveCount(2);
  await expect(page.locator(".compensation-widget")).toHaveCount(2);
  await expect(page.locator(".plot-card").last().locator("[data-binding]")).toHaveValue(sampleIds[0]);
  await expect(page.locator(".statistics-widget").last().locator("[data-statistics-sample]")).toHaveValue(sampleIds[0]);
  await expect(page.locator(".compensation-widget").last().locator("[data-comp-source]")).toHaveValue(sampleIds[0]);
  await expect(page.locator(".compensation-widget").last().locator("[data-comp-target]:checked")).toHaveAttribute("data-sample", sampleIds[0]);
  const copies = await Promise.all([
    position(".plot-card", 1), position(".statistics-widget", 1), position(".compensation-widget", 1),
  ]);
  const verticalOffset = copies[0].top - originals[0].top;
  expect(verticalOffset).toBeGreaterThan(0);
  copies.forEach((copy, index) => {
    expect(copy.left).toBe(originals[index].left);
    expect(copy.top - originals[index].top).toBe(verticalOffset);
  });

  await page.locator(".compensation-widget").first().locator(".statistics-widget-head").click({ button: "right", position: { x: 120, y: 12 } });
  await page.getByRole("menuitem", { name: "Normal: 選択項目を他サンプルへ展開…" }).click();
  dialog = page.getByRole("dialog", { name: "Normal sheetの選択項目を他サンプルへ展開" });
  await dialog.locator(`[data-expansion-target][value="${sampleIds[0]}"]`).uncheck();
  await dialog.getByRole("button", { name: "選択サンプルへ展開" }).click();
  await expect(page.locator(".compensation-widget")).toHaveCount(3);
  await expect(page.locator(".compensation-widget").last().locator("[data-comp-source]")).toHaveValue(sampleIds[1]);
  const horizontal = await position(".compensation-widget", 2);
  expect(horizontal.left).toBeGreaterThan(originals[2].left);
  expect(horizontal.top).toBe(originals[2].top);
});

test("worksheet statistics widget, plot visibility settings and axis preview", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".board > .statistics-widget")).toBeVisible();
  await expect(page.locator(".statistics th")).toHaveCount(4);
  await page.locator('[data-plot-options]').first().click();
  const options = page.getByRole("dialog", { name: "プロット表示設定" });
  await options.locator('[name="showGateNames"]').uncheck();
  await options.locator('[name="showGatePercentages"]').uncheck();
  await options.locator('[name="showXAxis"]').uncheck();
  await options.getByRole("button", { name: "表示設定を適用" }).click();
  await expect(page.locator(".plot-stage").first()).toHaveClass(/hide-x-axis/);
  await page.locator('[data-axis-label="y"]').first().click({ button: "right" });
  await expect(page.locator("[data-axis-preview] svg")).toBeVisible();
  await page.getByRole("button", { name: "キャンセル" }).click();
  await page.locator("#toggle-properties").click();
  await expect(page.locator("#properties-dialog")).toBeVisible();
  await page.locator("#close-properties").click();
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const bounds = (await page.locator(".plot-stage").first().boundingBox())!;
  await page.mouse.move(bounds.x + 75, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 170, bounds.y + 175, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator("[data-rename-pop]")).toHaveCount(1);
  await page.locator("[data-rename-pop]").click();
  await page.getByRole("dialog", { name: "集団名を変更" }).locator('[name="name"]').fill("T cells");
  await page.getByRole("dialog", { name: "集団名を変更" }).getByRole("button", { name: "名前を変更", exact: true }).click();
  await expect(page.locator(".statistics .population-cell").last()).toContainText("T cells");
});
