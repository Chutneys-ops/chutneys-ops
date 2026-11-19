// /purchases/invoice/<id>: open one purchase's invoice.
//
// Invoices are in a private bucket, so there is no permanent link. This
// route reads the purchase as you (RLS: your own, or any if you're a
// manager or the owner), then redirects to a signed URL that works for 5
// minutes. The list and the CSV export link here, so their links never expire.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: RouteContext<"/purchases/invoice/[id]">) {
  const { id } = await params;
  const notFound = () => new NextResponse("Invoice not found", { status: 404 });
  if (!UUID_RE.test(id)) return notFound();

  const supabase = await createClient();
  const { data: purchase } = await supabase.from("purchases").select("invoice_path").eq("id", id).maybeSingle();
  if (!purchase?.invoice_path) return notFound();

  const { data } = await supabase.storage.from("invoices").createSignedUrl(purchase.invoice_path, 300);
  if (!data?.signedUrl) return notFound();

  const response = NextResponse.redirect(data.signedUrl);
  // The signed URL is personal and short-lived: never cache this redirect.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
