import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

export const E2E_PORT = 3100;

export const E2E_ADMIN = {
  email: "e2e-admin@example.com",
  name: "E2E Admin",
  password: "e2e admin password 123",
};

export const E2E_CRON_SECRET = "e2e-cron-secret";

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("E2E_DATABASE_URL is not set (see .env.example)");
if (!new URL(databaseUrl).pathname.includes("e2e")) {
  throw new Error("Refusing to run E2E tests on a database whose name does not contain 'e2e'");
}
export const E2E_DATABASE_URL = databaseUrl;

/** Environment of the app under test. No email provider or bot check: those are unit-tested. */
export const E2E_ENV: Record<string, string> = {
  DATABASE_URL: databaseUrl,
  APP_URL: `http://localhost:${E2E_PORT}`,
  MANAGE_LINK_SECRET: "e2e-manage-link-secret-at-least-32-characters",
  CRON_SECRET: E2E_CRON_SECRET,
};
