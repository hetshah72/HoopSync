import { defineConfig, devices } from "@playwright/test";

// This dev environment has a slow filesystem that makes Turbopack's
// first-visit-per-route compile take well over the Playwright defaults
// (observed up to ~3min for the heaviest routes) - every timeout below is
// generously bumped for that reason, not because the app itself is slow.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 8 * 60 * 1000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: process.env.APP_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    actionTimeout: 30_000,
    navigationTimeout: 5 * 60 * 1000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The in-app session recorder (BRD 7.5) needs a camera. These give
        // Chromium a synthetic one and auto-grant permission, so the
        // recording path can be exercised in CI on a machine with no webcam.
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
          ],
        },
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: process.env.APP_BASE_URL || "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 5 * 60 * 1000,
  },
});
