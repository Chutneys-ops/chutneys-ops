// /more/export/csv?from=2026-11-01&to=2026-11-30: the owner's hours and
// leave CSV for payroll. One row per timesheet (by work date: at work,
// breaks, paid hours, status) and per approved leave request that overlaps
// the range.
//
// The role is checked here on the server: anyone else gets 403, whatever
// the page shows or hides.

import { NextResponse } from "next/server";
import { checkExportRange, hoursCsv, type LeaveExportRow, type TimesheetExportRow } from "@/lib/hours-export";
import type { LeaveReason } from "@/lib/leave";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// The API returns at most 1000 rows per request (max_rows in config.toml),
// so fetch page by page until a short page comes back.
const PAGE = 1000;

type TimesheetRow = Omit<TimesheetExportRow, "name" | "site"> & {
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

async function allTimesheets(supabase: Supabase, from: string, to: string): Promise<TimesheetRow[]> {
  const rows: TimesheetRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("timesheets")
      .select(
        "work_date, start_time, finish_time, minutes_at_work, rest_breaks, meal_breaks, paid_minutes, status, " +
          // timesheets links to staff four times; name the person's link.
          "edit_note, site:sites(name), person:staff!timesheets_staff_id_fkey(name)",
      )
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as TimesheetRow[]));
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

  let timesheets: TimesheetRow[];
  let leave: LeaveRow[];
  try {
    [timesheets, leave] = await Promise.all([allTimesheets(supabase, from, to), allLeave(supabase, from, to)]);
  } catch (error) {
    return new NextResponse(`Could not export: ${(error as Error).message}`, { status: 500 });
  }

  const csv = hoursCsv(
    timesheets.map(({ site, person, ...t }): TimesheetExportRow => ({
      ...t,
      name: person?.name ?? "Unknown",
      site: site?.name ?? "",
    })),
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
