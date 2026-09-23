import { test, expect } from "@playwright/test";

test("axis labels: search, keyboard, context details, validation, undo, sheet scope and focus", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("起動完了");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  const x = page.locator('[data-axis-label="x"]').first();
  const y = page.locator('[data-axis-label="y"]').first();
  await x.click();
  const picker = page.getByRole("dialog", { name: "X軸のチャンネル選択" });
  await expect(picker).toBeVisible();
  await picker.getByRole("combobox").fill("no-such-channel");
  await expect(picker).toContainText("一致するチャンネルがありません");
  await picker.getByRole("combobox").fill("fitc");
  await expect(picker.getByRole("option")).toHaveCount(1);
  await picker.getByRole("combobox").press("Enter");
  await expect(x).toContainText("FITC-A");
  await expect(x).toBeFocused();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await x.click({ button: "right" });
  const details = page.getByRole("dialog", { name: "X軸のスケール詳細" });
  await expect(details.getByLabel("表示スケール")).toHaveValue("logicle");
  await details.getByLabel("W ·").fill("10");
  await details.getByRole("button", { name: "適用して閉じる" }).click();
  await expect(details.getByRole("alert")).toContainText("0 ≤ 2W ≤ M");
  await details.getByLabel("W ·").fill("0.7");
  await details.getByLabel("データに合わせて自動調整").uncheck();
  await details.getByLabel("最小値").fill("5");
  await details.getByLabel("最大値").fill("-1");
  await details.getByRole("button", { name: "適用して閉じる" }).click();
  await expect(details.getByRole("alert")).toContainText("最小値 < 最大値");
  await details.getByLabel("最小値").fill("-1");
  await details.getByLabel("最大値").fill("5");
  await details.getByRole("button", { name: "キャンセル" }).click();
  await x.press("Shift+F10");
  await expect(details.getByLabel("W ·")).toHaveValue("0.5");
  await expect(details.getByLabel("データに合わせて自動調整")).toBeChecked();
  await details.getByRole("button", { name: "キャンセル" }).click();
  // Duplicate a plot and put the same channel on the other axis too.
  await page.locator("[data-duplicate]").first().click();
  await y.click();
  await page.getByRole("dialog").getByRole("combobox").fill("FITC");
  await page.getByRole("dialog").getByRole("option").click();
  await x.click({ button: "right" });
  await expect(details.getByLabel("適用先")).toContainText("3 軸");
  await details.getByLabel("W ·").fill("0.7");
  await details.getByLabel("適用先").selectOption("sheet");
  await details.getByRole("button", { name: "適用して閉じる" }).click();
  await y.click({ button: "right" });
  await expect(page.getByRole("dialog").getByLabel("W ·")).toHaveValue("0.7");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "キャンセル" })
    .click();
  await page.locator('[data-axis-label="x"]').last().click({ button: "right" });
  await expect(details.getByLabel("W ·")).toHaveValue("0.7");
  await details.press("Escape");
  await page.locator("#undo").click();
  await x.click({ button: "right" });
  await expect(details.getByLabel("W ·")).toHaveValue("0.5");
  await details.press("Escape");
  await y.click();
  await page.getByRole("dialog").getByRole("combobox").fill("PE-A");
  await page.getByRole("dialog").getByRole("option").click();
  await page.locator("[data-swap]").first().click();
  await expect(x).toContainText("PE-A");
  await expect(y).toContainText("FITC-A");
  // Focus mode changes only the visual size, not the saved worksheet geometry.
  const original = await page.locator(".plot-card").first().boundingBox();
  await page.locator("[data-focus]").first().click();
  await expect(page.locator(".plot-card:visible")).toHaveCount(1);
  expect(
    (await page.locator(".plot-card").first().boundingBox())!.width,
  ).toBeGreaterThan(original!.width * 2);
  await page.locator('[data-axis-details="x"]').first().click();
  await details.press("Escape");
  await expect(page.locator(".plot-card.focused")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".plot-card:visible")).toHaveCount(2);
  expect((await page.locator(".plot-card").first().boundingBox())!.width).toBe(
    original!.width,
  );
  await page.locator("[data-mode]").first().selectOption("histogram");
  await expect(
    page.locator(".plot-card").first().locator(".counts-label"),
  ).toHaveText("Count");
  await expect(
    page.locator(".plot-card").first().locator('[data-axis-label="y"]'),
  ).toHaveCount(0);
  await expect(page.locator("[data-swap]").first()).toBeDisabled();
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await expect(page.locator(".plot-error:visible")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/axis-ui-0.3.1.png" });
  expect(failures).toEqual([]);
});

test("axis controls remain usable without the inspector at 1100px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("起動完了");
  await page.locator("#demo").click();
  await expect(page.locator(".statistics")).toContainText("16,000");
  await expect(page.locator(".properties")).not.toBeVisible();
  await page.locator('[data-axis-label="y"]').click();
  await page.getByRole("dialog").getByRole("combobox").fill("APC");
  await page.getByRole("dialog").getByRole("option").click();
  await page.locator('[data-axis-label="y"]').click({ button: "right" });
  const d = page.getByRole("dialog");
  await d.getByLabel("W ·").fill("0.8");
  await d.getByRole("button", { name: "適用して閉じる" }).click();
  await page.locator("#save").click();
  await expect(page.locator(".status")).toContainText("保存しました");
  await page.locator("#load").click();
  await page.locator('[data-axis-label="y"]').click({ button: "right" });
  await expect(d.getByLabel("W ·")).toHaveValue("0.8");
  await d.getByRole("button", { name: "キャンセル" }).click();
  await page.locator("[data-focus]").click();
  await page.locator('[data-axis-label="y"]').click({ button: "right" });
  await page.screenshot({ path: "artifacts/axis-dialog-0.3.1-narrow.png" });
  const box = (await d.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(760);
  await d.press("Escape");
});
