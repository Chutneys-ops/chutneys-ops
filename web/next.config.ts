import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
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
  // There is no home page yet: send everyone to the site picker. /start
  // sends signed-out visitors to /login, and clocked-in staff on to /records.
  // permanent: false gives a 307, so browsers don't cache it and a real
  // home page can replace it later.
  async redirects() {
    return [{ source: "/", destination: "/start", permanent: false }];
  },
};

export default nextConfig;
