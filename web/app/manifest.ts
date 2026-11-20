import type { MetadataRoute } from "next";
import { BRAND_CREAM, BRAND_GREEN } from "@/lib/brand/app-icon";

// The web app manifest (/manifest.webmanifest): what "Add to Home Screen" /
// "Install app" uses. Icons come from app/icons/[file]/route.tsx.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chutneys Ops",
    short_name: "Chutneys",
    description: "Food safety records, hours, purchases and leave for every Chutneys site.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: BRAND_GREEN,
    background_color: BRAND_CREAM,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
