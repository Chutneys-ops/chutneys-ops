"use server";

// More > Payslips (owner only): publish drafts and withdraw payslips.
// Uploads go through the route next door (/more/payslips/upload), because
// PDFs can be bigger than a server action accepts.
//
// Never trust the arguments. The database is the real guard
// (publish_payslips and withdraw_payslip check is_owner()); the checks here
// only give friendly messages.

import { refresh } from "next/cache";
import { after } from "next/server";
import { notifyPayslipsPublished, type PublishedPayslip } from "@/lib/notify";
import { checkWithdrawReason } from "@/lib/payslips";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";

export type PayslipActionResult = { ok: boolean; message?: string; published?: string[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READABLE_CODES = new Set(["42501", "23514", "22023"]);

function dbMessage(error: { code?: string; message: string }, prefix: string): string {
  return READABLE_CODES.has(error.code ?? "") ? error.message : `${prefix}: ${error.message}`;
}

async function ownerClient() {
  const supabase = await createClient();
  const { me } = await getSession(supabase);
  return me?.role === "owner" ? supabase : null;
}

/** Publish these drafts, then tell each person (after the reply is sent). */
export async function publishPayslips(ids: string[]): Promise<PayslipActionResult> {
  const supabase = await ownerClient();
  if (!supabase) return { ok: false, message: "Only the owner can publish payslips." };
  const clean = Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === "string" && UUID_RE.test(id)))] : [];
  if (clean.length === 0) return { ok: false, message: "There's nothing to publish." };

  const { data, error } = await supabase.rpc("publish_payslips", { payslip_ids: clean });
  if (error) return { ok: false, message: dbMessage(error, "Could not publish") };

  const published = (data ?? []) as PublishedPayslip[];
  if (published.length > 0) after(() => notifyPayslipsPublished(published));
  refresh();
  const n = published.length;
  return {
    ok: true,
    published: published.map((p) => p.id),
    message:
      n === 0
        ? "These were already published."
        : `Published ${n} ${n === 1 ? "payslip" : "payslips"}. People with notifications on are told now.`,
  };
}

/** Hide a payslip from the person, keeping it and saying why. */
export async function withdrawPayslip(id: string, reasonText: string): Promise<PayslipActionResult> {
  const supabase = await ownerClient();
  if (!supabase) return { ok: false, message: "Only the owner can withdraw payslips." };
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, message: "Payslip not found." };
  const reason = checkWithdrawReason(String(reasonText ?? ""));
  if (!reason.ok) return { ok: false, message: reason.error };

  const { error } = await supabase.rpc("withdraw_payslip", { payslip_id: id, reason: reason.reason });
  if (error) return { ok: false, message: dbMessage(error, "Could not withdraw it") };
  refresh();
  return { ok: true, message: "Withdrawn. They can't see it any more; it's kept here." };
}
