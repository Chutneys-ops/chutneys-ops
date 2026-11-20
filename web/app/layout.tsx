import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Inter, Space_Grotesk } from "next/font/google";
import { BRAND_GREEN } from "@/lib/brand/app-icon";
import "./globals.css";

// next/font downloads these at build time and serves them from our own
// domain. Each one sets a CSS variable that globals.css maps to font-sans
// and font-display.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Chutneys Ops",
  description: "Food safety records, hours, purchases and leave for every Chutneys site.",
  // Installable app: manifest from app/manifest.ts, icons from
  // app/icons/[file]/route.tsx (one artwork in lib/brand/app-icon.tsx).
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // iPhone "Add to Home Screen": open full screen with this name.
  appleWebApp: { capable: true, title: "Chutneys", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: BRAND_GREEN,
};

// Content Security Policy with a nonce (proxy.ts, lib/security-headers.ts):
// Next.js puts the per-request nonce on its scripts only when it renders the
// HTML for that request. A static shell made at build time has scripts with
// no nonce, and the browser would block them all. So every page renders per
// request: `instant = false` allows the root layout to wait, and
// `connection()` makes it wait for the request. Pages still stream their
// Suspense parts as before. (Cache Components stays on; Next.js 17 makes it
// permanent.)
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
