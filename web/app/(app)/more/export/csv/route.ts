// /more/export/csv?from=2026-11-01&to=2026-11-30: the owner's hours and
// leave CSV for payroll. One row per shift (by clock-in day) and per
// approved leave request that overlaps the range.
//
// The role is checked here on the server: anyone else gets 403, whatever
// the page shows or hides.

import { NextResponse } from "next/server";
import {
  checkExportRange,
  exportBounds,
  hoursCsv,
  type LeaveExportRow,
  type ShiftExportRow,
} from "@/lib/hours-export";
import type { LeaveReason } from "@/lib/leave";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// The API returns at most 1000 rows per request (max_rows in config.toml),
// so fetch page by page until a short page comes back.
const PAGE = 1000;

type ShiftRow = {
  clock_in: string;
  clock_out: string | null;
  needs_review: boolean;
  edit_note: string | null;
  site: { name: string } | null;
  person: { name: string } | null;
};
type LeaveRow = {
  start_date: string;
  end_date: string;
  hours: number | string;
  reason: LeaveReason;
  person: { name: string } | null;
};

async function allShifts(supabase: Supabase, start: string, end: string): Promise<ShiftRow[]> {
  const rows: ShiftRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("shifts")
      .select("clock_in, clock_out, needs_review, edit_note, site:sites(name), person:staff!shifts_staff_id_fkey(name)")
      .gte("clock_in", start)
      .lt("clock_in", end)
      .order("clock_in")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as ShiftRow[]));
    if (!data || data.length < PAGE) return rows;
  }
}

async function allLeave(supabase: Supabase, from: string, to: string): Promise<LeaveRow[]> {
  const rows: LeaveRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("leave_requests")
      .select("start_date, end_date, hours, reason, person:staff!leave_requests_staff_id_fkey(name)")
      .eq("status", "approved")
      // Overlaps the range: starts before it ends, ends after it starts.
      .lte("start_date", to)
      .gte("end_date", from)
      .order("start_date")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as LeaveRow[]));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) return new NextResponse("Sign in first", { status: 401 });
  if (me?.role !== "owner") return new NextResponse("Only the owner can export hours and leave", { status: 403 });

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const problem = checkExportRange(from, to);
  if (problem) return new NextResponse(problem, { status: 400 });

  const { start, end } = exportBounds(from, to);
  let shifts: ShiftRow[];
  let leave: LeaveRow[];
  try {
    [shifts, leave] = await Promise.all([allShifts(supabase, start, end), allLeave(supabase, from, to)]);
  } catch (error) {
    return new NextResponse(`Could not export: ${(error as Error).message}`, { status: 500 });
  }

  const csv = hoursCsv(
    shifts.map(
      (s): ShiftExportRow => ({
        name: s.person?.name ?? "Unknown",
        site: s.site?.name ?? "",
        clock_in: s.clock_in,
        clock_out: s.clock_out,
        needs_review: s.needs_review,
        edit_note: s.edit_note,
      }),
    ),
    leave.map(
      (l): LeaveExportRow => ({
        name: l.person?.name ?? "Unknown",
        start_date: l.start_date,
        end_date: l.end_date,
        hours: l.hours,
        reason: l.reason,
      }),
    ),
  );

  // The ﻿ at the start tells Excel the file is UTF-8 (for names with macrons).
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hours-and-leave-${from}-to-${to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
