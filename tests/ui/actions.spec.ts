import { test, expect, type Page } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
const ready = async (page: Page) => {
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await expect(page.locator(".plot-error:visible")).toHaveCount(0);
};
async function start(page: Page) {
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("起動完了");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  await ready(page);
}
async function rectangle(page: Page) {
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const b = (await page.locator(".plot-stage").first().boundingBox())!;
  await page.mouse.move(b.x + 95, b.y + 70);
  await page.mouse.down();
  await page.mouse.move(b.x + 210, b.y + 165, { steps: 7 });
  await page.mouse.up();
  await ready(page);
  return b;
}
test("gate interior double click drills down; context rename/delete, parent and undo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  const b = await rectangle(page);
  await expect(page.locator(".statistics tbody tr")).toHaveCount(2);
  await page.mouse.dblclick(b.x + 150, b.y + 110);
  await expect(page.locator("[data-population]").first()).toHaveValue("[]");
  await expect(page.locator("[data-population]").last()).toHaveValue('["P1"]');
  await expect(page.locator(".plot-card")).toHaveCount(2);
  await ready(page);
  await page.locator("[data-parent]:not([disabled])").first().click();
  await ready(page);
  await page.mouse.click(b.x + 150, b.y + 110, { button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "集団名を変更…" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("集団名", { exact: true })
    .fill("Lymphocytes");
  await page.getByRole("button", { name: "名前を変更", exact: true }).click();
  await ready(page);
  await expect(page.locator(".statistics")).toContainText("Lymphocytes");
  await page.mouse.click(b.x + 150, b.y + 110, { button: "right" });
  await page
    .getByRole("menuitem", { name: "この分画へ drill down", exact: true })
    .click();
  await expect(page.locator("[data-population]").last()).toHaveValue(
    '["Lymphocytes"]',
  );
  await ready(page);
  await page
    .getByText("◇ Lymphocytes", { exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "ゲートと子分画を削除", exact: true })
    .click();
  await expect(page.locator("[data-population]").first()).toHaveValue("[]");
  await ready(page);
  await expect(page.locator(".statistics tbody tr")).toHaveCount(1);
  await page.locator("#undo").click();
  await ready(page);
  await expect(page.locator(".statistics tbody tr")).toHaveCount(2);
  await expect(page.locator("[data-population]").last()).toHaveValue(
    '["Lymphocytes"]',
  );
  expect(errors).toEqual([]);
});

test("all seven plot modes, plot styling, log axes and vector/CSV UI exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await expect(page.locator("[data-mode] option")).toHaveCount(7);
  for (const mode of [
    "density",
    "contour",
    "pseudocolor",
    "zebra",
    "histogram",
    "cdf",
    "scatter",
  ]) {
    await page.locator("[data-mode]").selectOption(mode);
    await ready(page);
    await expect(page.locator("canvas")).toBeVisible();
    if (mode === "cdf")
      await expect(page.locator(".counts-label")).toHaveText("Cumulative %");
  }
  await page.locator("[data-plot-options]").click();
  await page.getByLabel("点の大きさ (px)", { exact: true }).fill("4");
  await page.getByLabel("不透明度 (0–1)", { exact: true }).fill("0.85");
  await page.getByRole("button", { name: "表示設定を適用" }).click();
  await ready(page);
  await page.locator('[data-axis-label="x"]').click();
  await page.getByRole("dialog").getByRole("combobox").fill("FITC");
  await page.getByRole("dialog").getByRole("option").click();
  await ready(page);
  await page.locator('[data-axis-label="x"]').click({ button: "right" });
  await page.getByLabel("表示スケール", { exact: true }).selectOption("log");
  await page.getByRole("button", { name: "適用して閉じる" }).click();
  await ready(page);
  await page.locator('[data-axis-label="x"]').click({ button: "right" });
  await expect(page.getByLabel("表示スケール", { exact: true })).toHaveValue(
    "log",
  );
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await page.locator("#save").click();
  await expect(page.locator(".status")).toContainText("保存しました");
  const saved = JSON.parse(readFileSync("artifacts/ui-workspace.json", "utf8"));
  const plot = saved.worksheets[0].plots[0];
  expect(plot.dotSize).toBe(4);
  expect(plot.dotOpacity).toBe(0.85);
  expect(plot.x.scale).toBe("log");
  await page.locator("#csv").click();
  await expect(page.locator(".status")).toContainText("統計CSVを保存しました");
  const csv = readFileSync("artifacts/ui-statistics.csv", "utf8");
  expect(csv).toContain("16000");
  expect(csv).toContain("median:FITC-A");
  const stage = page.locator(".plot-stage");
  await stage.click({ position: { x: 240, y: 50 }, button: "right" });
  await page.getByRole("menuitem", { name: "図をSVGで保存…" }).click();
  await expect(page.locator(".status")).toContainText("図を保存しました");
  expect(readFileSync("artifacts/ui-plot.svg", "utf8")).toContain("<svg");
  await stage.click({ position: { x: 240, y: 50 }, button: "right" });
  await page.getByRole("menuitem", { name: "図をPDFで保存…" }).click();
  await expect(page.locator(".status")).toContainText("図を保存しました");
  expect(statSync("artifacts/ui-worksheet.pdf").size).toBeGreaterThan(1000);
  await expect(page.locator(".board")).toHaveCSS("background-image", "none");
  expect(errors).toEqual([]);
});

test("ellipse and histogram range gates are editable and drillable", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "楕円", exact: true }).click();
  const stage = page.locator(".plot-stage").first(),
    b = (await stage.boundingBox())!;
  await page.mouse.move(b.x + 100, b.y + 75);
  await page.mouse.down();
  await page.mouse.move(b.x + 225, b.y + 170, { steps: 6 });
  await page.mouse.up();
  await ready(page);
  await expect(stage.locator("ellipse")).toHaveCount(1);
  await expect(page.locator(".statistics tbody tr")).toHaveCount(2);
  await page.locator("[data-mode]").first().selectOption("histogram");
  await ready(page);
  await page.getByRole("button", { name: "範囲", exact: true }).click();
  await page.mouse.move(b.x + 130, b.y + 80);
  await page.mouse.down();
  await page.mouse.move(b.x + 220, b.y + 80, { steps: 7 });
  await page.mouse.up();
  await ready(page);
  await expect(page.locator(".statistics tbody tr")).toHaveCount(3);
  await expect(stage.locator("circle")).toHaveCount(2);
  await page.mouse.dblclick(b.x + 175, b.y + 130);
  await ready(page);
  await expect(page.locator("[data-population]").last()).toHaveValue('["P2"]');
  await page.locator("[data-parent]:not([disabled])").first().click();
  await ready(page);
  await page.locator("[data-mode]").first().selectOption("cdf");
  await ready(page);
  await expect(stage.first().locator("path")).toHaveCount(1);
});

test("global gates appear and calculate for a second sample", async ({
  page,
}) => {
  await start(page);
  await page.locator("#demo").click();
  await expect(page.getByRole("button", { name: /Demo 2/ })).toBeVisible();
  await ready(page);
  await page
    .getByRole("button", { name: /Demo · 3 populations/ })
    .first()
    .click();
  await ready(page);
  await page.getByRole("button", { name: "全体適用", exact: true }).click();
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const stage = page.locator(".plot-stage").first();
  const b = (await stage.boundingBox())!;
  await page.mouse.move(b.x + 95, b.y + 70);
  await page.mouse.down();
  await page.mouse.move(b.x + 210, b.y + 165, { steps: 5 });
  await page.mouse.up();
  await ready(page);
  await expect(page.locator(".gate-scope")).toContainText("全体適用");
  await page.getByRole("button", { name: /Demo 2/ }).click();
  await ready(page);
  await expect(
    page.locator(".population").filter({ hasText: "全体" }),
  ).toHaveCount(1);
  await expect(page.locator(".statistics")).toContainText("P1");
});


test("workspace focus, worksheet template and selectable report", async ({ page }) => {
  await start(page);
  await expect(page.locator(".browser")).toBeVisible();
  await page.locator("#toggle-properties").click();
  await expect(page.locator("#properties-dialog")).toBeVisible();
  await page.locator("#close-properties").click();
  await expect(page.locator("#properties-dialog")).toHaveCount(0);

  await page.locator("#template").click();
  await expect(page.locator(".status")).toContainText("ワークシートテンプレートを保存しました");
  const template = JSON.parse(readFileSync("artifacts/ui-template.json", "utf8"));
  expect(template.schema).toBe("flowdesk-worksheet-template/1");
  expect(template.worksheet.plots.length).toBeGreaterThan(0);
  expect(template.samples).toBeUndefined();

  await page.locator("#report").click();
  const report = page.getByRole("dialog", { name: "全サンプルPDFの出力内容" });
  await expect(report).toBeVisible();
  await report.getByLabel("集団統計").uncheck();
  await report.getByLabel("Compensation / spillover 行列").uncheck();
  await report.getByRole("button", { name: "PDFを生成" }).click();
  await expect(page.locator(".status")).toContainText("PDFを保存しました");
});
