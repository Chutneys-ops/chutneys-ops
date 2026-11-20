// POST /more/payslips/upload: one payslip PDF from the owner's "Upload pay
// run" (multipart: file, pay_date, period_start, period_end, staff_id?).
//
// Owner only (checked here, and again by the Storage policy and RLS, since
// ingestPayslip runs with the owner's own session). Answers JSON: the
// IngestResult (saved draft, unmatched, or an error message).
//
// A route rather than a server action: server actions refuse bodies over
// 1 MB by default, and payslips can be up to 2 MB.

import { NextResponse } from "next/server";
import { ingestPayslip, type IngestResult } from "@/lib/payslips-ingest";
import { PAYSLIP_MAX_BYTES } from "@/lib/payslips";
import { limitPerson } from "@/lib/supabase/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(result: IngestResult, status = 200) {
  return NextResponse.json(result, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) return reply({ status: "error", message: "You are signed out. Sign in again." }, 401);
  if (me?.role !== "owner") return reply({ status: "error", message: "Only the owner can upload payslips." }, 403);

  const limit = await limitPerson(supabase, userId, "payslipUpload");
  if (!limit.allowed) return reply({ status: "error", message: limit.message }, 429);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reply({ status: "error", message: "The upload didn't arrive in one piece. Try again." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return reply({ status: "error", message: "Choose a PDF." }, 400);
  if (file.size > PAYSLIP_MAX_BYTES) return reply({ status: "error", message: "That PDF is over 2 MB." }, 413);

  const hint = String(form.get("staff_id") ?? "");
  if (hint && !UUID_RE.test(hint)) return reply({ status: "error", message: "Choose who it's for." }, 400);

  const result = await ingestPayslip(
    supabase,
    "upload",
    { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    hint || null,
    {
      payDate: String(form.get("pay_date") ?? ""),
      periodStart: String(form.get("period_start") ?? ""),
      periodEnd: String(form.get("period_end") ?? ""),
    },
  );
  return reply(result);
}
