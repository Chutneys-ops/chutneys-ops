import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  // The verifier pack PDF reads its font files at run time, which the build
  // can't see from the code, so tell it to ship them with these two routes.
  outputFileTracingIncludes: {
    "/more/verifier-pack/pdf": ["./assets/fonts/**"],
    "/api/cron/verifier-pack": ["./assets/fonts/**"],
  },
  partialPrefetching: true,
  turbopack: {
    // The repo root has its own package-lock.json (for the Supabase CLI),
    // so tell Turbopack this web/ folder is the app root.
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // "/" is Home. The proxy sends signed-out visitors on to /login.
  // permanent: false gives a 307, so browsers don't cache it.
  async redirects() {
    return [{ source: "/", destination: "/home", permanent: false }];
  },
  // The service worker (public/sw.js) must never be cached, so a new
  // version reaches phones on their next visit. It may only load scripts
  // from this site.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
