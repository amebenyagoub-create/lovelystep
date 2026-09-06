import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: { baseURL: "http://127.0.0.1:3108" },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3108",
    url: "http://127.0.0.1:3108/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
