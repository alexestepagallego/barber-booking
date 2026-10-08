import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

async function headersFor(path: string) {
  const response = await unstable_getResponseFromNextConfig({
    url: `https://barber.example${path}`,
    nextConfig,
  });
  return response.headers;
}

describe("security headers (next.config.ts)", () => {
  it("sends a locked-down CSP and the standard hardening headers on every page", async () => {
    const headers = await headersFor("/book");
    const csp = headers.get("content-security-policy") ?? "";

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("never leaks manage-link tokens through the Referer header", async () => {
    const headers = await headersFor("/manage/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("x-robots-tag")).toBe("noindex, nofollow");
    // The global headers still apply.
    expect(headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("keeps the admin panel out of search engines", async () => {
    expect((await headersFor("/admin")).get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await headersFor("/admin/services")).get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("does not allow eval in production builds", async () => {
    const csp = (await headersFor("/")).get("content-security-policy") ?? "";
    expect(csp).not.toContain("unsafe-eval");
  });
});
