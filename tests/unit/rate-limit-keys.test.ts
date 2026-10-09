import { describe, expect, it } from "vitest";

import { clientIp, rateLimitEmailKey, rateLimitIpKey } from "@/server/security/rate-limit";

describe("rateLimitIpKey", () => {
  it("keeps IPv4 addresses as they are", () => {
    expect(rateLimitIpKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("maps IPv4-mapped IPv6 to IPv4", () => {
    expect(rateLimitIpKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("reduces IPv6 to its /64, so rotating the interface id buys no new budget", () => {
    const a = rateLimitIpKey("2001:db8:85a3:12::8a2e:370:7334");
    const b = rateLimitIpKey("2001:0db8:85a3:0012:ffff:ffff:ffff:1");
    expect(a).toBe("2001:db8:85a3:12::/64");
    expect(b).toBe(a);
    expect(rateLimitIpKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });

  it("uses the first x-forwarded-for entry", () => {
    const headers = new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" });
    expect(clientIp(headers)).toBe("198.51.100.1");
    expect(clientIp(new Headers())).toBe("local");
  });
});

describe("rateLimitEmailKey", () => {
  it("gives address variants that reach the same inbox one budget", () => {
    expect(rateLimitEmailKey("Ana+promo@Example.com")).toBe("ana@example.com");
    expect(rateLimitEmailKey("a.n.a+1@gmail.com")).toBe("ana@gmail.com");
    expect(rateLimitEmailKey("ana@googlemail.com")).toBe("ana@gmail.com");
  });

  it("keeps dots for providers where they matter", () => {
    expect(rateLimitEmailKey("a.na@example.com")).toBe("a.na@example.com");
  });
});
