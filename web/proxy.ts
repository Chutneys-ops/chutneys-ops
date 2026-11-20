import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Pages that need a logged-in user. /set-password too: the invite or reset
// link (/auth/confirm) signs you in first. /forgot-password and /auth/* are
// for signed-out people, so they're not on this list.
const PROTECTED_PREFIXES = ["/home", "/install", "/start", "/records", "/time", "/purchases", "/more", "/leave", "/training", "/settings", "/set-password"];

export async function proxy(request: NextRequest) {
  // Start with a "carry on as normal" response; Supabase may add cookies to it.
  let response = NextResponse.next({ request });
  // No-cache headers Supabase asks for whenever it sets auth cookies.
  let authHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Update the request so pages rendered after this see fresh cookies...
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          // ...and the response so the browser stores them.
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          // No-cache headers, so a CDN never serves one user's cookies to another.
          authHeaders = headers;
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
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

  if (redirectTo) {
    const url = request.nextUrl.clone();
    url.pathname = redirectTo;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // A redirect is a new response, so copy any refreshed auth cookies onto it.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    Object.entries(authHeaders).forEach(([key, value]) =>
      redirect.headers.set(key, value),
    );
    return redirect;
  }

  return response;
}

export const config = {
  // Run on everything except Next's static files and images.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
