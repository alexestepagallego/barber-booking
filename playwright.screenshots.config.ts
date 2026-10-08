import { defineConfig, devices } from "@playwright/test";

import { E2E_ENV, E2E_PORT } from "./e2e/env";

/**
 * Captures the README screenshots and the booking GIF:
 *   npm run screenshots
 * Uses the E2E database, loaded with the demo data (see global setup).
 */
export default defineConfig({
  testDir: "./scripts/screenshots",
  globalSetup: "./scripts/screenshots/setup.ts",
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    reducedMotion: "reduce",
    timezoneId: "Europe/Madrid",
    locale: "en-GB",
    colorScheme: "dark",
  },
  projects: [
    {
      name: "screenshots",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: {
    command: `npm run build && npx next start --port ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: E2E_ENV,
  },
});
