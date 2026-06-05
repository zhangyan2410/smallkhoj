import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "../e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: process.env.FRONTEND_BASE ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  reporter: "line",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
})
