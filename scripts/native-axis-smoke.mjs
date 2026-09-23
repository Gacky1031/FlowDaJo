import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const executable = resolve(
  process.argv[2] || "release/FlowDesk-Tauri-0.3.1/FlowDesk-Tauri.exe",
);
mkdirSync("artifacts", { recursive: true });
const app = spawn(executable, [], {
  windowsHide: true,
  env: {
    ...process.env,
    PATH: `${process.env.SystemRoot}/System32;${process.env.SystemRoot}`,
    R_HOME: "C:/invalid-R",
    R_LIBS_USER: "C:/invalid-library",
    R_LIBS_SITE: "C:/invalid-library",
    FLOWDESK_RSCRIPT: "C:/invalid-R/Rscript.exe",
    WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: "C:/invalid-WebView2",
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9238",
    WEBVIEW2_USER_DATA_FOLDER: resolve("artifacts/native-axis-0.3.1-profile"),
  },
});
let browser;
try {
  for (let i = 0; i < 60; i++) {
    if (app.exitCode !== null) throw Error("Native EXE exited " + app.exitCode);
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9238");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  assert.ok(browser, "Native WebView2 available");
  let page;
  for (let i = 0; i < 30; i++) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes("tauri"));
    if (page) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(page, "Tauri page available");
  await page.getByText(/起動完了/).waitFor({ timeout: 30000 });
  const health = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("request", {
      payload: { action: "health" },
    }),
  );
  assert.equal(
    health.rHome.toLowerCase(),
    resolve(executable, "../runtime/R").replaceAll("\\", "/").toLowerCase(),
  );
  const failures = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await page.locator("#demo").click();
  await page
    .getByRole("cell", { name: "16,000", exact: true })
    .waitFor({ timeout: 30000 });
  await page.locator('[data-axis-label="x"]').click();
  await page.getByRole("dialog").getByRole("combobox").fill("FITC");
  await page.getByRole("dialog").getByRole("option").click();
  await page.locator('[data-axis-label="x"]').click({ button: "right" });
  await page.getByRole("dialog").getByLabel("W ·").fill("0.7");
  await page.getByRole("button", { name: "適用して閉じる" }).click();
  await page.waitForFunction(() => !document.querySelector(".status.pending"));
  assert.equal(await page.locator(".plot-error:visible").count(), 0);
  await page.locator("[data-focus]").click();
  assert.equal(await page.locator(".focused").count(), 1);
  await page.locator('[data-axis-label="x"]').click({ button: "right" });
  assert.equal(
    await page.getByRole("dialog").getByLabel("W ·").inputValue(),
    "0.7",
  );
  await page.screenshot({ path: "artifacts/native-axis-0.3.1-dialog.png" });
  await page.getByRole("button", { name: "キャンセル" }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".focused").count(), 0);
  assert.match(
    await page.locator('[data-axis-label="x"]').innerText(),
    /FITC-A/,
  );
  await page.screenshot({ path: "artifacts/native-axis-0.3.1-workspace.png" });
  assert.deepEqual(failures, []);
  const record = {
    version: "0.3.1",
    bundledR: health.rHome,
    events: 16000,
    channel: "FITC-A",
    logicleW: 0.7,
    contextMenu: true,
    focusRestore: true,
    pageErrors: failures,
  };
  writeFileSync(
    "artifacts/native-axis-0.3.1-validation.json",
    JSON.stringify(record, null, 2),
  );
  console.log("PASS native axis UI", record);
} finally {
  if (browser) await browser.close();
  if (app.exitCode === null) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      app.kill();
    }
  }
}
