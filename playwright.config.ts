import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1480, height: 960 },
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  },
  webServer: {
    command: "node scripts/test-ui.mjs",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
  },
});
