import { expect, test } from "@playwright/test";

import { E2E_CRON_SECRET } from "./env";

test.describe("HTTP behaviour of the production build", () => {
  test("pages carry the security headers and no framework banner", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("manage pages never send their URL as a referrer", async ({ request }) => {
    const response = await request.get(`/manage/${"x".repeat(43)}`);
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  });

  test("the API rejects malformed input with field errors", async ({ request }) => {
    const response = await request.post("/api/appointments", { data: { serviceId: "nope" } });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.fields.serviceId).toBeTruthy();
  });

  test("the honeypot field stops naive bots", async ({ request }) => {
    const response = await request.post("/api/appointments", { data: { website: "spam.example" } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error.code).toBe("bot_check_failed");
  });

  test("cron endpoints require the cron secret", async ({ request }) => {
    expect((await request.get("/api/cron/reminders")).status()).toBe(401);
    const authorized = await request.get("/api/cron/reminders", {
      headers: { Authorization: `Bearer ${E2E_CRON_SECRET}` },
    });
    expect(authorized.status()).toBe(200);
    expect(await authorized.json()).toMatchObject({ failed: 0 });
  });

  test("manage APIs answer 404 for unknown tokens, whatever their shape", async ({ request }) => {
    for (const token of ["", "short", "x".repeat(43)]) {
      const response = await request.post("/api/manage/cancel", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status()).toBe(404);
    }
  });
});
