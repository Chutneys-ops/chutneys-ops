// /icons/<file>.png: every app icon, rendered at build time from the one
// artwork in lib/brand/app-icon.tsx. To change the logo, edit that file.
//
// Lives outside the (app) folder and has a .png name, so the sign-in proxy
// skips it: the home screen and browsers fetch icons without signing in.

import { ImageResponse } from "next/og";
import { AppIconArt, type IconVariant } from "@/lib/brand/app-icon";

const ICONS: Record<string, { size: number; variant: IconVariant }> = {
  "icon-192.png": { size: 192, variant: "any" },
  "icon-512.png": { size: 512, variant: "any" },
  "maskable-192.png": { size: 192, variant: "maskable" },
  "maskable-512.png": { size: 512, variant: "maskable" },
  "apple-touch-icon.png": { size: 180, variant: "apple" },
  "favicon-32.png": { size: 32, variant: "any" },
};

// Build every icon once, at build time.
export function generateStaticParams() {
  return Object.keys(ICONS).map((file) => ({ file }));
}

export async function GET(_request: Request, { params }: RouteContext<"/icons/[file]">) {
  const { file } = await params;
  const icon = ICONS[file];
  if (!icon) return new Response("Not found", { status: 404 });
  return new ImageResponse(<AppIconArt size={icon.size} variant={icon.variant} />, {
    width: icon.size,
    height: icon.size,
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}
