import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

export default defineConfig({
  testDir: "./tests/generated",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ["html", { outputFolder: "../reports/html" }],
    ["json", { outputFile: "../reports/results.json" }],
    ["list"],
  ],
  use: {
    baseURL: process.env.BASE_URL || "https://example.com",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  outputDir: "../reports/test-results",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
