import type { NextConfig } from "next";

import { privatePageHeaders, securityHeaders } from "./src/server/security/headers";

const dev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    // Later entries override earlier ones for the same header key, so the
    // stricter per-path rules come after the global defaults.
    return [
      { source: "/:path*", headers: securityHeaders(dev) },
      { source: "/manage/:path*", headers: privatePageHeaders },
      { source: "/admin", headers: privatePageHeaders },
      { source: "/admin/:path*", headers: privatePageHeaders },
    ];
  },
};

export default nextConfig;
