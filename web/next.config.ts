import path from "node:path";
import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./lib/security-headers";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  // Error monitoring in the browser (instrumentation-client.ts) needs the
  // Sentry DSN at build time. One setting, SENTRY_DSN, for server and
  // browser; a DSN is designed to be public (it can only send events).
  // Empty means Sentry stays off.
  env: {
    NEXT_PUBLIC_SENTRY_DSN: process.env.SENTRY_DSN ?? "",
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT ?? "",
  },
  // The verifier pack PDF reads its font files at run time, which the build
  // can't see from the code, so tell it to ship them with these two routes.
  outputFileTracingIncludes: {
    "/more/verifier-pack/pdf": ["./assets/fonts/**"],
    "/api/cron/verifier-pack": ["./assets/fonts/**"],
  },
  // unpdf (reading text inside payslip PDFs) loads pdf.js files of its own
  // at run time. Load it with Node's own require, as in the tests, instead
  // of bundling it.
  serverExternalPackages: ["unpdf"],
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
      // HSTS, nosniff, Referrer-Policy, framing, Permissions-Policy on every
      // response. The Content Security Policy is per request (a new nonce
      // each time), so it's set in proxy.ts instead.
      { source: "/:path*", headers: STATIC_SECURITY_HEADERS },
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
