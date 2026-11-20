// /more/verifier-pack/monthly?file=2026/2026-10.pdf: open a stored monthly copy.
//
// Owner only (checked here, and the Storage policy only lets the owner read
// the "verifier-packs" bucket). Redirects to a signed URL that works for 5
// minutes, so the list's links never expire and the file is never public.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { monthFromPackPath, PACK_BUCKET } from "@/lib/verifier-pack";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) return new NextResponse("Sign in first", { status: 401 });
  if (me?.role !== "owner") return new NextResponse("Only the owner can open the monthly copies", { status: 403 });

  const file = new URL(request.url).searchParams.get("file") ?? "";
  const month = monthFromPackPath(file);
  if (!month) return new NextResponse("Monthly copy not found", { status: 404 });

  const { data } = await supabase.storage
    .from(PACK_BUCKET)
    .createSignedUrl(file, 300, { download: `chutneys-verifier-pack-${month}.pdf` });
  if (!data?.signedUrl) return new NextResponse("Monthly copy not found", { status: 404 });

  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
