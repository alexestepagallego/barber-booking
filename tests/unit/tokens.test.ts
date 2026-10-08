import { describe, expect, it } from "vitest";

import { deriveManageToken, getManageLinkSecret, hashToken } from "@/server/security/tokens";

const SECRET = "a-test-secret-that-is-at-least-32-characters";
const ID = "6f1c3c5e-6a0b-4c2f-9a57-3c4f3c2f1a10";

describe("deriveManageToken", () => {
  it("returns a URL-safe 256-bit token", () => {
    expect(deriveManageToken(ID, SECRET)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is deterministic for the same appointment and secret", () => {
    expect(deriveManageToken(ID, SECRET)).toBe(deriveManageToken(ID, SECRET));
  });

  it("differs per appointment and per secret", () => {
    const other = "0b0e8c1a-3f1d-4a52-8c55-3a2f1b1e0d11";
    expect(deriveManageToken(ID, SECRET)).not.toBe(deriveManageToken(other, SECRET));
    expect(deriveManageToken(ID, SECRET)).not.toBe(deriveManageToken(ID, `${SECRET}-rotated`));
  });

  it("is stored only as a SHA-256 hash", () => {
    const token = deriveManageToken(ID, SECRET);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });
});

describe("getManageLinkSecret", () => {
  it("refuses to run in production without a strong secret", () => {
    const env = { ...process.env };
    try {
      Object.assign(process.env, { NODE_ENV: "production", MANAGE_LINK_SECRET: "short" });
      expect(() => getManageLinkSecret()).toThrow(/MANAGE_LINK_SECRET/);
      process.env.MANAGE_LINK_SECRET = SECRET;
      expect(getManageLinkSecret()).toBe(SECRET);
    } finally {
      process.env = env;
    }
  });
});
