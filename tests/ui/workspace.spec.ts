import { test, expect, type Page } from "@playwright/test";
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
  await page
    .locator("[data-binding]")
    .first()
    .selectOption({ label: "📌 Demo · 3 populations" });
  await page.locator("#demo").click();
  await expect(page.locator(".sample")).toHaveCount(2);
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  // Global gates are shared by every sample, so the same drill-down path remains valid.
  await expect(page.locator(".plot-error:visible")).toHaveCount(0);
  await page.locator(".sample").first().click();
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
  await page.getByRole("menuitem", { name: /Normal: このプロットを他サンプルへ展開/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator("#batch-plots-apply").click();
  await expect(page.locator(".plot-card")).toHaveCount(2);
  await expect(page.locator(".status")).toContainText("1個の分画プロットを追加しました");
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
  await page.locator("#batch-plots-sheet").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").locator('input[type="checkbox"]')).toHaveCount(2);
  await page.locator("#batch-plots-apply").click();
  await expect(page.locator(".plot-card")).toHaveCount(6);
  await expect(page.locator(".status")).toContainText("4個の分画プロットを追加しました");
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await page.locator(".plot-card").first().click();
  const sourceAxis = await page.locator(".axis-summary").innerText();
  await page.locator(".plot-card").last().click();
  const targetAxis = await page.locator(".axis-summary").innerText();
  expect(targetAxis).toBe(sourceAxis);
  expect(targetAxis).not.toContain("Auto range");
});

test("sidebar population drag drop and combined expand arrange", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  const root = page.locator('.population[data-pop="root"]');
  await expect(root).toBeVisible();
  await root.dragTo(page.locator(".board"), { targetPosition: { x: 520, y: 420 } });
  await expect(page.locator(".plot-card")).toHaveCount(2);
  await expect(page.locator(".plot-card").last()).toHaveCSS("left", /5\d\dpx/);
  await page.locator("#demo").click();
  await expect(page.locator(".sample")).toHaveCount(2);
  await page.getByRole("button", { name: "Normal", exact: true }).click();
  await page.locator("[data-select-card]").nth(0).check();
  await page.locator("[data-select-card]").nth(1).check();
  await page.locator("#batch-arrange").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").locator('[name="rows"]').fill("1");
  await page.getByRole("dialog").locator('[name="columns"]').fill("2");
  await page.getByRole("dialog").locator("[data-expand-arrange]").click();
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-label", "Normal sheetの分画プロットをバッチ展開");
  await page.locator("#batch-plots-apply").click();
  await expect(page.locator(".plot-card")).toHaveCount(4);
  await expect(page.locator(".plot-card").nth(0)).toHaveCSS("left", "24px");
  await expect(page.locator(".plot-card").nth(1)).toHaveCSS("left", "384px");
  await expect(page.locator(".plot-card").nth(2)).toHaveCSS("left", "24px");
  await expect(page.locator(".plot-card").nth(3)).toHaveCSS("left", "384px");
});
