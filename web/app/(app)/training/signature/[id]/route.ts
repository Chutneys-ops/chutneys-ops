// /training/signature/<id>: open the trainee's drawn signature for a record.
//
// Reads the record as you (RLS: your own, or any if you're a manager or the
// owner), then redirects to a signed URL that works for 5 minutes.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: RouteContext<"/training/signature/[id]">) {
  const { id } = await params;
  const notFound = () => new NextResponse("Signature not found", { status: 404 });
  if (!UUID_RE.test(id)) return notFound();

  const supabase = await createClient();
  const { data: record } = await supabase
    .from("training_records")
    .select("trainee_signature_path")
    .eq("id", id)
    .maybeSingle();
  if (!record?.trainee_signature_path) return notFound();

  const { data } = await supabase.storage.from("signatures").createSignedUrl(record.trainee_signature_path, 300);
  if (!data?.signedUrl) return notFound();

  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
