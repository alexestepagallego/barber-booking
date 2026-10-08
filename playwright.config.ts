import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

import { E2E_ENV, E2E_PORT } from "./e2e/env";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * End-to-end tests against a production build (`next build` + `next start`),
 * as the Next.js testing guide recommends: that is the code users get.
 * The app runs on its own port and database (E2E_DATABASE_URL), which the
 * global setup migrates, empties and seeds before every run.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Tests share one database and the clock; running them in series keeps
  // them independent of each other's bookings.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: "retain-on-failure",
    // Skips the intro video, which also exercises the reduced-motion path.
    reducedMotion: "reduce",
    timezoneId: "Europe/Madrid",
    locale: "en-GB",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /booking\.spec/ },
  ],
  webServer: {
    command: `npm run build && npx next start --port ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: E2E_ENV,
  },
});
