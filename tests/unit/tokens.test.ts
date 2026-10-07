import { describe, expect, it } from "vitest";

import { generateManageToken, hashToken } from "@/server/security/tokens";

describe("generateManageToken", () => {
  it("returns a URL-safe 256-bit token and its SHA-256 hash", () => {
    const { token, hash } = generateManageToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateManageToken().token));
    expect(tokens.size).toBe(1000);
  });
});
