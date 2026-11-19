"use server";

// A manager or owner sets the real clock-out time of a forgotten shift.
// fix_clock_out (security definer) checks the role, the note and the time;
// this action turns the Auckland time from the picker into UTC first.

import { refresh } from "next/cache";
import { aucklandLocalToUtc } from "@/lib/hours";
import { createClient } from "@/lib/supabase/server";

export type FixState = { seq: number; ok?: boolean; message?: string };

// Messages from fix_clock_out read well as they are.
const READABLE_CODES = new Set(["23514", "42501", "22023"]);

export async function fixClockOut(shiftId: string, prev: FixState, formData: FormData): Promise<FixState> {
  const seq = prev.seq + 1;
  const local = String(formData.get("clock_out") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  // "2026-11-20T17:30" typed in Auckland -> the UTC instant the database stores.
  const clockOut = aucklandLocalToUtc(local);
  if (!clockOut) return { seq, message: "Pick the clock-out date and time." };
  if (!note) return { seq, message: "Add a note saying why (e.g. what time they actually left)." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("fix_clock_out", {
    shift_id: shiftId,
    new_clock_out: clockOut.toISOString(),
    note,
  });
  if (error) {
    const readable = error.code !== undefined && READABLE_CODES.has(error.code);
    return { seq, message: readable ? error.message : `Could not fix the shift: ${error.message}` };
  }

  refresh();
  return { seq, ok: true, message: "Fixed" };
}
