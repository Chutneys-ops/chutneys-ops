"use client";

// Buttons in the owner's pay run list: publish a run's leftover drafts, and
// withdraw one payslip (with a reason; it's kept, never deleted).

import { useState, useTransition } from "react";
import { FormMessage } from "@/components/password-field";
import { WITHDRAW_REASON_MAX } from "@/lib/payslips";
import { publishPayslips, withdrawPayslip, type PayslipActionResult } from "./actions";

const smallButton =
  "min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-muted disabled:cursor-wait disabled:opacity-60";

export function PublishDrafts({ ids }: { ids: string[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PayslipActionResult | null>(null);
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => setResult(await publishPayslips(ids)))}
        className="min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Publishing…" : `Publish ${ids.length} not published`}
      </button>
      {result && <FormMessage ok={result.ok} message={result.message} />}
    </div>
  );
}

export function WithdrawPayslip({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PayslipActionResult | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={smallButton}>
        Withdraw
      </button>
    );
  }
  return (
    <form
      className="mt-2 w-full space-y-2 rounded-xl border border-warning/30 bg-warning-light p-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const done = await withdrawPayslip(id, reason);
          setResult(done);
          if (done.ok) setOpen(false);
        });
      }}
    >
      <label htmlFor={`withdraw-${id}`} className="block text-sm font-semibold text-ink">
        Why withdraw {name}&apos;s payslip?
      </label>
      <input
        id={`withdraw-${id}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={WITHDRAW_REASON_MAX}
        required
        placeholder="For example: wrong hours, corrected one to follow"
        className="min-h-11 w-full rounded-xl border border-muted bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
      />
      <p className="text-sm text-ink">
        They won&apos;t see it any more. It&apos;s kept here with your reason. Upload a corrected one with Upload pay run,
        using the same dates.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(false)} className={smallButton}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-xl border border-warning/40 bg-white px-3 text-sm font-semibold text-warning hover:border-warning disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Withdrawing…" : "Withdraw"}
        </button>
      </div>
      {result && !result.ok && <FormMessage ok={false} message={result.message} />}
    </form>
  );
}
