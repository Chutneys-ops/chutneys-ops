// /purchases/export?month=2026-11[&site=<id>]: the owner's monthly CSV for
// the accountant (GST return).
//
// The role is checked here on the server: a manager typing this URL gets
// 403, whatever the page shows or hides.

import { NextResponse } from "next/server";
import { currentMonth, isMonth, monthRange, purchasesCsv, type ExportRow } from "@/lib/purchases";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) return new NextResponse("Sign in first", { status: 401 });
  if (me?.role !== "owner") return new NextResponse("Only the owner can export purchases", { status: 403 });

  const url = new URL(request.url);
  const wantedMonth = url.searchParams.get("month") ?? undefined;
  const month = isMonth(wantedMonth) ? wantedMonth : currentMonth();
  const site = url.searchParams.get("site") ?? "";
  const { start, end } = monthRange(month);

  let query = supabase
    .from("purchases")
    .select(
      "id, purchased_at, supplier, description, total_incl_gst, gst_amount, payment_method, invoice_path, " +
        "no_receipt_reason, site:sites(name), buyer:staff!purchases_purchased_by_fkey(name)",
    )
    .gte("purchased_at", start)
    .lt("purchased_at", end)
    .order("purchased_at");
  if (UUID_RE.test(site)) query = query.eq("site_id", site);

  const { data, error } = await query;
  if (error) return new NextResponse(`Could not export: ${error.message}`, { status: 500 });
  const rows = (data ?? []) as unknown as ExportRow[];

  const csv = purchasesCsv(rows, url.origin);

  // The ﻿ at the start tells Excel the file is UTF-8 (for names like "Māngere").
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="purchases-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
