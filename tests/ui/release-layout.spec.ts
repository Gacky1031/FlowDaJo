import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { clickToolbarAction } from "./helpers";

for (const fallback of [false, true]) {
  test(`toolbar menus keep fixed dimensions and usable items (${fallback ? "older WebKit fallback" : "popover"})`, async ({ page, browserName }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (fallback) await page.addInitScript(() => {
      Object.defineProperty(HTMLElement.prototype, "showPopover", { value: undefined, configurable: true });
      Object.defineProperty(HTMLElement.prototype, "hidePopover", { value: undefined, configurable: true });
    });
    await page.setViewportSize({ width: 1080, height: 720 });
    await page.goto("/");
    await expect(page.locator(".status")).toContainText("起動完了");
    for (const action of ["#apply-template", "#report"]) {
      const menu = page.locator(`.toolbar-menu:has(${action})`);
      const panel = menu.locator(":scope > div");
      await expect(panel).toBeHidden();
      await menu.locator("summary").click();
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute("data-menu-surface", fallback ? "fallback" : "popover");
      expect((await panel.boundingBox())!.width).toBe(260);
      await expect(panel).toHaveCSS("font-size", "12px");
      await expect(panel.locator("button").first()).toHaveCSS("line-height", "18px");
      expect(await panel.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
      expect(await page.locator(action).evaluate((button) => {
        const box = button.getBoundingClientRect();
        return box.bottom <= innerHeight && button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
      await page.screenshot({ path: `artifacts/toolbar-${browserName}-${fallback ? "fallback" : "popover"}-${action.slice(1)}.png` });
      await menu.locator("summary").click();
      await expect(panel).toBeHidden();
    }
    await clickToolbarAction(page, "#demo");
    await expect(page.locator(".statistics")).toContainText("16,000");
    await clickToolbarAction(page, "#csv");
    await expect(page.locator(".status")).toContainText("統計CSVを保存しました");
    expect(errors).toEqual([]);
  });
}

test("dropping a population creates FSC-A / SSC-A and retains imported channel scales", async ({ page }) => {
  const saved: any[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/__test_rpc") && request.postDataJSON()?.action === "save") saved.push(request.postDataJSON().project);
  });
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("起動完了");
  await page.evaluate(async (path) => {
    const call = (payload: any) => (window as any).__TAURI_INTERNALS__.invoke("request", { payload });
    const s = (await call({ action: "demo" })).samples[0];
    const fsc = s.channels.find((channel: any) => channel.id === "FSC-A");
    s.channels = [fsc, { id: "Time", label: "Time" }, ...s.channels.filter((channel: any) => channel !== fsc)];
    const defaults = [
      { channel: "FSC-A", scale: "linear", min: 0, max: 200000, autoRange: false },
      { channel: "SSC-A", scale: "linear", min: 0, max: 100000, autoRange: false },
    ];
    await call({ action: "save", path, project: { schema: "flowdesk-r/1", name: "Reordered channels", samples: [s], gates: [], divaAxisDefaults: defaults, activeWorksheet: "sheet", worksheets: [{ id: "sheet", name: "Normal", mode: "normal", plots: [], widgets: [] }] } });
  }, resolve("artifacts/ui-workspace.json"));
  await clickToolbarAction(page, "#load");
  await expect(page.locator(".population[data-pop=root]")).toBeVisible();
  await expect(page.locator(".plot-card")).toHaveCount(0);
  await page.evaluate(() => {
    const population = document.querySelector(".population[data-pop=root]")!;
    const board = document.querySelector(".board")!;
    const bounds = board.getBoundingClientRect();
    const dataTransfer = new DataTransfer();
    population.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    board.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientX: bounds.left + 60, clientY: bounds.top + 70 }));
  });
  await expect(page.locator(".plot-card")).toHaveCount(1);
  await expect(page.locator('[data-axis-label="x"]')).toContainText("FSC-A");
  await expect(page.locator('[data-axis-label="y"]')).toContainText("SSC-A");
  await expect(page.locator(".status")).not.toHaveClass(/pending/);
  await page.locator("#save").click();
  await expect(page.locator(".status")).toContainText("保存しました");
  const plot = saved.at(-1).worksheets[0].plots[0];
  expect(plot.x).toMatchObject({ channel: "FSC-A", min: 0, max: 200000 });
  expect(plot.y).toMatchObject({ channel: "SSC-A", min: 0, max: 100000 });
  expect(plot.left).toBe(60);
  expect(plot.top).toBe(70);
  expect(plot.importedAxes.x.channel).toBe("FSC-A");
});
