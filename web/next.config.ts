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
  // "/" is Home. The proxy sends signed-out visitors on to /login.
  // permanent: false gives a 307, so browsers don't cache it.
  async redirects() {
    return [{ source: "/", destination: "/home", permanent: false }];
  },
};

export default nextConfig;
