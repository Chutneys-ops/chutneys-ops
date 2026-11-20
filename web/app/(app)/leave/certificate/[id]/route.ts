// /leave/certificate/<id>: open a sick leave certificate.
//
// Reads the request as you (RLS: your own, or any if you're a manager or the
// owner), then redirects to a signed URL that works for 5 minutes.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: RouteContext<"/leave/certificate/[id]">) {
  const { id } = await params;
  const notFound = () => new NextResponse("Certificate not found", { status: 404 });
  if (!UUID_RE.test(id)) return notFound();

  const supabase = await createClient();
  const { data: request } = await supabase.from("leave_requests").select("certificate_path").eq("id", id).maybeSingle();
  if (!request?.certificate_path) return notFound();

  const { data } = await supabase.storage.from("leave-documents").createSignedUrl(request.certificate_path, 300);
  if (!data?.signedUrl) return notFound();

  const response = NextResponse.redirect(data.signedUrl);
  // The signed URL is personal and short-lived: never cache this redirect.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
