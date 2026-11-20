import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, newNonce } from "@/lib/security-headers";

// Runs before every page. Three jobs:
//   1. Refresh the Supabase session cookies (and verify the token).
//   2. Send signed-out people to /login, and signed-in people away from it.
//   3. A Content Security Policy with a new random nonce for this response
//      (lib/security-headers.ts). Next.js reads the nonce from the request
//      header below and puts it on its own scripts. The other security
//      headers are in next.config.ts, so files the proxy skips get them too.

// Pages that need a logged-in user. /set-password too: the invite or reset
// link (/auth/confirm) signs you in first. /mfa: straight after the password.
// /forgot-password, /privacy and /auth/* are for signed-out people too, so
// they're not on this list.
const PROTECTED_PREFIXES = [
  "/home", "/install", "/start", "/records", "/time", "/purchases", "/more", "/leave", "/training",
  "/settings", "/set-password", "/mfa", "/notices", "/roster", "/payslips",
];

type CookieToSet = { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] };

export async function proxy(request: NextRequest) {
  // Cookies and no-cache headers Supabase asks for when it refreshes a session.
  let cookiesToSet: CookieToSet[] = [];
  let authHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet, headers) {
          // Update the request so pages rendered after this see fresh
          // cookies (this also updates request.headers' Cookie line)...
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          // ...and remember them for the response, so the browser stores them.
          cookiesToSet = toSet;
          // No-cache headers, so a CDN never serves one user's cookies to another.
          authHeaders = headers;
        },
      },
    },
  );

  // Verifies the JWT signature and refreshes it if it has expired.
  // Don't put other code between createServerClient and this call.
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims);

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  let redirectTo: string | null = null;
  if (!isLoggedIn && isProtected) redirectTo = "/login";
  if (isLoggedIn && pathname === "/login") redirectTo = "/home";

  let response: NextResponse;
  if (redirectTo) {
    const url = request.nextUrl.clone();
    url.pathname = redirectTo;
    url.search = "";
    response = NextResponse.redirect(url);
  } else {
    const nonce = newNonce();
    const csp = contentSecurityPolicy({
      nonce,
      dev: process.env.NODE_ENV === "development",
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      sentryDsn: process.env.SENTRY_DSN,
      https: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    });
    // Copied after getClaims, so it carries any refreshed cookies.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
    response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
  }

  cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  Object.entries(authHeaders).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}

export const config = {
  // Run on everything except Next's static files, images and the service
  // worker (it has its own, stricter policy in next.config.ts).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
