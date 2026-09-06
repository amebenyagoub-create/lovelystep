import { defineConfig } from "playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3108";

export default defineConfig({
  testDir: "./tests",
  use: { baseURL },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3108",
    url: "http://127.0.0.1:3108/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
