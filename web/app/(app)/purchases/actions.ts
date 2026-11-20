"use server";

// Server actions for purchases: save one, mark one as paid back.
//
// Never trust the arguments: anyone can call a server action with anything.
// The real guards are in the database (column grants, RLS with on_shift_at,
// invoice_belongs, check constraints, mark_reimbursed). The checks here
// only give friendly messages first.

import { refresh } from "next/cache";
import { isInvoicePathFor, validatePurchase } from "@/lib/purchases";
import { createClient } from "@/lib/supabase/server";
import { getCurrentShift } from "@/lib/supabase/session";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type PurchaseResult = {
  ok: boolean;
  message?: string;
  /** Field name -> message. */
  errors?: Record<string, string>;
};

export type PaidBackState = { seq: number; ok?: boolean; message?: string };

// Errors raised by our own functions and policies already read well.
const READABLE_CODES = new Set(["23514", "42501", "22023"]);

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** The file was uploaded for a purchase that didn't save: remove it. The
 *  storage policy only allows this for your own file that no purchase uses. */
async function removeUpload(supabase: Supabase, path: string | null) {
  if (path) await supabase.storage.from("invoices").remove([path]);
}

/**
 * Save a purchase. The browser has already uploaded the invoice (if any) and
 * sends its path in `invoice_path`. The site comes from your open shift,
 * never from the form.
 */
export async function addPurchase(formData: FormData): Promise<PurchaseResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { ok: false, message: "You are signed out. Sign in again." };

  const invoicePath = text(formData, "invoice_path").trim() || null;
  const shift = await getCurrentShift(supabase, userId);
  if (!shift) {
    await removeUpload(supabase, invoicePath);
    return { ok: false, message: "Choose a site first (Choose site, at the top)." };
  }
  if (invoicePath && !isInvoicePathFor(invoicePath, shift.site.id)) {
    // Not a path this form makes: don't touch it, just refuse.
    return { ok: false, message: "That invoice upload doesn't match your site. Pick the file again." };
  }

  const { values, errors } = validatePurchase(
    {
      supplier: text(formData, "supplier"),
      description: text(formData, "description"),
      total: text(formData, "total"),
      gst_included: text(formData, "gst_included"),
      payment_method: text(formData, "payment_method"),
      no_receipt_reason: text(formData, "no_receipt_reason"),
      comments: text(formData, "comments"),
    },
    Boolean(invoicePath),
  );
  if (!values) {
    await removeUpload(supabase, invoicePath);
    return { ok: false, message: "Check the highlighted fields.", errors };
  }

  const { error } = await supabase.from("purchases").insert({
    site_id: shift.site.id,
    invoice_path: invoicePath,
    ...values,
  });
  if (error) {
    await removeUpload(supabase, invoicePath);
    const readable = error.code !== undefined && READABLE_CODES.has(error.code);
    return { ok: false, message: readable ? error.message : `Could not save: ${error.message}` };
  }

  refresh();
  return { ok: true, message: "Purchase saved" };
}

/** A manager or the owner marks an own-money purchase as paid back.
 *  mark_reimbursed checks the role and the "not your own" rule. */
export async function markPaidBack(purchaseId: string, prev: PaidBackState): Promise<PaidBackState> {
  const seq = prev.seq + 1;
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_reimbursed", { purchase_id: purchaseId });
  if (error) {
    const readable = error.code !== undefined && READABLE_CODES.has(error.code);
    return { seq, message: readable ? error.message : `Could not mark it: ${error.message}` };
  }
  refresh();
  return { seq, ok: true, message: "Marked as paid back" };
}
