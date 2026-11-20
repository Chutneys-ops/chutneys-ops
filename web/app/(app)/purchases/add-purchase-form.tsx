"use client";

// "Add purchase": supplier, what was bought, total, GST, how paid, comments
// and an invoice (photo or PDF), or a reason there's no receipt.
//
// On save:
//   1. The photo was already shrunk when it was picked (DocumentPicker).
//   2. Upload it to the private "invoices" bucket from the browser. Storage
//      policies only allow your shift site's folder.
//   3. Call the addPurchase server action with the file's path.
//   4. If that fails, delete the uploaded file (the action does too).

import { useRef, useState, type FormEvent } from "react";
import { DocumentPicker, type PickedFile } from "@/components/document-picker";
import {
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  formatMoney,
  gstCents,
  invoiceExtension,
  invoicePath,
  newFileId,
  parseMoney,
} from "@/lib/purchases";
import { createClient } from "@/lib/supabase/client";
import { addPurchase, type PurchaseResult } from "./actions";

type Phase = "idle" | "preparing" | "uploading" | "saving";

const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none";
const choiceClass =
  "flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-line bg-white px-2 text-center text-sm font-medium has-checked:border-primary has-checked:bg-primary-light has-checked:text-primary-dark";
export function AddPurchaseForm({ siteId, siteName }: { siteId: string; siteName: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [invoice, setInvoice] = useState<PickedFile | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [total, setTotal] = useState("");
  const [gstIncluded, setGstIncluded] = useState(true);

  const errors = result?.ok ? {} : (result?.errors ?? {});
  const busy = phase !== "idle";
  const cents = parseMoney(total);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setResult(null);

    const supabase = createClient();
    let path: string | null = null;

    if (invoice) {
      const ext = invoiceExtension(invoice.blob.type);
      if (!ext) return setResult({ ok: false, message: "Use a photo or a PDF." });
      path = invoicePath(siteId, new Date(), newFileId(), ext);
      setPhase("uploading");
      const { error } = await supabase.storage
        .from("invoices")
        .upload(path, invoice.blob, { contentType: invoice.blob.type, upsert: false });
      if (error) {
        setPhase("idle");
        return setResult({ ok: false, message: `Could not upload the invoice: ${error.message}` });
      }
      formData.set("invoice_path", path);
    }

    setPhase("saving");
    let saved: PurchaseResult;
    try {
      saved = await addPurchase(formData);
    } catch {
      saved = { ok: false, message: "Could not reach the server. Check your connection and try again." };
    }
    // The action removes the file when it fails, but if the call never
    // arrived, nobody did. Removing twice is harmless.
    if (!saved.ok && path) await supabase.storage.from("invoices").remove([path]);

    setPhase("idle");
    setResult(saved);
    if (saved.ok) {
      formRef.current?.reset();
      setInvoice(null);
      setTotal("");
      setGstIncluded(true);
    }
  }

  let buttonText = "Save purchase";
  if (phase === "preparing") buttonText = "Preparing photo…";
  if (phase === "uploading") buttonText = "Uploading…";
  if (phase === "saving") buttonText = "Saving…";

  const field = (name: string) => ({
    id: `purchase-${name}`,
    name,
    "aria-invalid": Boolean(errors[name]),
    "aria-describedby": errors[name] ? `purchase-${name}-error` : undefined,
  });
  const border = (name: string) => (errors[name] ? "border-warning" : "border-line");
  const fieldError = (name: string) =>
    errors[name] ? (
      <p id={`purchase-${name}-error`} className="mt-1 text-sm text-warning">
        {errors[name]}
      </p>
    ) : null;

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-muted">
        For <span className="font-semibold text-ink">{siteName}</span>
      </p>

      <div>
        <label htmlFor="purchase-supplier" className="block text-sm font-semibold text-ink">
          Supplier
        </label>
        <input
          {...field("supplier")}
          type="text"
          maxLength={200}
          autoComplete="off"
          placeholder="e.g. Pak'nSave Mt Albert"
          className={`${inputClass} ${border("supplier")}`}
        />
        {fieldError("supplier")}
      </div>

      <div>
        <label htmlFor="purchase-description" className="block text-sm font-semibold text-ink">
          What was bought
        </label>
        <input
          {...field("description")}
          type="text"
          maxLength={500}
          autoComplete="off"
          placeholder="e.g. Onions 10 kg, coriander"
          className={`${inputClass} ${border("description")}`}
        />
        {fieldError("description")}
      </div>

      <div>
        <label htmlFor="purchase-total" className="block text-sm font-semibold text-ink">
          Total paid (incl GST)
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 mt-[3px] -translate-y-1/2 text-muted">$</span>
          <input
            {...field("total")}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className={`${inputClass} pl-7 ${border("total")}`}
          />
        </div>
        {fieldError("total")}
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-ink">GST included?</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <label className={choiceClass}>
            <input
              type="radio"
              name="gst_included"
              value="yes"
              checked={gstIncluded}
              onChange={() => setGstIncluded(true)}
              className="sr-only"
            />
            Yes
          </label>
          <label className={choiceClass}>
            <input
              type="radio"
              name="gst_included"
              value="no"
              checked={!gstIncluded}
              onChange={() => setGstIncluded(false)}
              className="sr-only"
            />
            No (supplier not GST registered)
          </label>
        </div>
        <p className="mt-1 text-sm text-muted" aria-live="polite">
          {cents !== null ? `GST: ${formatMoney(gstCents(cents, gstIncluded))}` : "GST is worked out for you"}
        </p>
      </fieldset>

      <fieldset aria-describedby={errors.payment_method ? "purchase-payment_method-error" : undefined}>
        <legend className="text-sm font-semibold text-ink">How was it paid?</legend>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {PAYMENT_METHODS.map((method) => (
            <label key={method} className={choiceClass}>
              <input type="radio" name="payment_method" value={method} className="sr-only" />
              {PAYMENT_LABELS[method]}
            </label>
          ))}
        </div>
        {fieldError("payment_method")}
      </fieldset>

      <DocumentPicker
        legend="Invoice or receipt"
        value={invoice}
        onChange={(file) => {
          setInvoice(file);
          setResult(null);
        }}
        onPreparingChange={(preparing) => setPhase(preparing ? "preparing" : "idle")}
        disabled={phase === "uploading" || phase === "saving"}
      />

      {!invoice && (
        <div>
          <label htmlFor="purchase-no_receipt_reason" className="block text-sm font-semibold text-ink">
            No receipt? Say why
          </label>
          <p className="text-sm text-muted">Needed when there&apos;s no invoice photo, for GST.</p>
          <textarea
            {...field("no_receipt_reason")}
            rows={2}
            maxLength={500}
            placeholder="e.g. Market stall, no receipts given"
            className={`${inputClass} py-2 ${border("no_receipt_reason")}`}
          />
          {fieldError("no_receipt_reason")}
        </div>
      )}

      <div>
        <label htmlFor="purchase-comments" className="block text-sm font-semibold text-ink">
          Comments <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          {...field("comments")}
          rows={2}
          maxLength={500}
          className={`${inputClass} py-2 ${border("comments")}`}
        />
        {fieldError("comments")}
      </div>

      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`rounded-xl p-3 text-sm font-medium ${
            result.ok ? "bg-primary-light text-primary-dark" : "bg-warning-light text-warning"
          }`}
        >
          {result.message}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="min-h-[50px] w-full rounded-xl bg-primary px-4 text-base font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
      >
        {buttonText}
      </button>
    </form>
  );
}
