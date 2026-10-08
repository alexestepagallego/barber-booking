import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyTurnstile } from "@/server/security/turnstile";

const respond = (body: unknown) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));

afterEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
});

describe("verifyTurnstile", () => {
  it("is skipped when no secret is configured (local development)", async () => {
    const fetchImpl = respond({ success: false });
    expect(await verifyTurnstile(undefined, "1.2.3.4", fetchImpl)).toEqual({
      ok: true,
      skipped: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires a token once enabled", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    expect(await verifyTurnstile(undefined, "1.2.3.4", respond({ success: true }))).toEqual({
      ok: false,
      reason: "missing-token",
    });
  });

  it("sends the secret, token and client IP to Cloudflare and trusts only success: true", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    const ok = respond({ success: true });
    expect(await verifyTurnstile("token", "1.2.3.4", ok)).toEqual({ ok: true, skipped: false });

    const body = ok.mock.calls[0]![1]!.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({
      secret: "secret",
      response: "token",
      remoteip: "1.2.3.4",
    });

    expect(await verifyTurnstile("token", "1.2.3.4", respond({ success: false }))).toEqual({
      ok: false,
      reason: "invalid-token",
    });
    expect(await verifyTurnstile("token", "1.2.3.4", respond({}))).toMatchObject({ ok: false });
  });

  it("fails closed when Cloudflare cannot be reached", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    const down = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await verifyTurnstile("token", "1.2.3.4", down)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
