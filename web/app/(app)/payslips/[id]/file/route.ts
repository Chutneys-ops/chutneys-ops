// /payslips/<id>/file: open a payslip PDF.
//
// Reads the payslip with your own session, so RLS decides: your own once
// published (and not withdrawn), or any if you're the owner. The first time
// you open your own, it's marked viewed (mark_payslip_viewed only ever
// stamps your own, so the owner opening someone's doesn't count).
// Redirects to a signed URL that works for 5 minutes; the file is never public.
// Add ?download=1 to save it instead of opening it.

import { NextResponse } from "next/server";
import { downloadName, PAYSLIP_BUCKET } from "@/lib/payslips";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: RouteContext<"/payslips/[id]/file">) {
  const { id } = await params;
  const notFound = () => new NextResponse("Payslip not found", { status: 404 });
  if (!UUID_RE.test(id)) return notFound();

  const supabase = await createClient();
  const { userId } = await getSession(supabase);
  if (!userId) return new NextResponse("Sign in first", { status: 401 });

  const { data: payslip } = await supabase
    .from("payslips")
    .select("id, staff_id, pay_date, file_path, viewed_at")
    .eq("id", id)
    .maybeSingle();
  if (!payslip) return notFound();

  // ?download=1 saves the file instead of showing it: the owner uses it to
  // send a leaver their final payslip another way. Someone else's file gets
  // their name in the file name.
  const download = new URL(request.url).searchParams.get("download") === "1";
  let name: string | undefined;
  if (download && payslip.staff_id !== userId) {
    const { data: person } = await supabase.from("staff").select("name").eq("id", payslip.staff_id).maybeSingle();
    name = (person?.name as string | undefined) ?? undefined;
  }
  const { data } = await supabase.storage
    .from(PAYSLIP_BUCKET)
    .createSignedUrl(
      payslip.file_path as string,
      300,
      download ? { download: downloadName(payslip.pay_date as string, name) } : undefined,
    );
  if (!data?.signedUrl) return notFound();

  if (payslip.staff_id === userId && !payslip.viewed_at) {
    const { error } = await supabase.rpc("mark_payslip_viewed", { payslip_id: id });
    if (error) console.error("Could not mark the payslip viewed:", error.message);
  }

  const response = NextResponse.redirect(data.signedUrl);
  // The signed URL is personal and short-lived: never cache this redirect.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
