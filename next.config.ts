import type { NextConfig } from "next";

import { secretUrlHeaders, securityHeaders, staffPageHeaders } from "./src/server/security/headers";

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
      { source: "/manage/:path*", headers: secretUrlHeaders },
      { source: "/admin", headers: staffPageHeaders },
      { source: "/admin/:path*", headers: staffPageHeaders },
    ];
  },
};

export default nextConfig;
