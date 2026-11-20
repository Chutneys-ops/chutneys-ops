import { headers } from "next/headers";

/** "http://127.0.0.1:3000" or "https://ops.example.nz": where this request
 *  came from, for links in invite and reset emails. Server only. */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
