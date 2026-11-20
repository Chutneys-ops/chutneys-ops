"use client";

// "Request sick leave": dates, whole days or hours, reason, the vomiting or
// diarrhoea question, an optional certificate and a short note.
//
// On save: upload the certificate (if any) into your own folder of the
// private "leave-documents" bucket, then call requestLeave. If that fails,
// remove the file again (the action does too).

import { useRef, useState, type FormEvent } from "react";
import { DocumentPicker, type PickedFile } from "@/components/document-picker";
import {
  DEFAULT_HOURS_PER_DAY,
  LEAVE_REASONS,
  LEAVE_REASON_LABELS,
  NOTE_MAX,
  daysInclusive,
  hoursText,
  parseHours,
} from "@/lib/leave";
import { createClient } from "@/lib/supabase/client";
import { newFileId, uploadExtension } from "@/lib/uploads";
import { requestLeave, type LeaveResult } from "./actions";

type Phase = "idle" | "preparing" | "uploading" | "saving";

const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none";
const choiceClass =
  "flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-line bg-white px-2 text-center text-sm font-medium has-checked:border-primary has-checked:bg-primary-light has-checked:text-primary-dark";

export function LeaveForm({ userId, today }: { userId: string; today: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [certificate, setCertificate] = useState<PickedFile | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<LeaveResult | null>(null);
  // Just enough live state to show "= 16 h" for whole days.
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [amount, setAmount] = useState<"days" | "hours">("days");
  const [perDay, setPerDay] = useState(String(DEFAULT_HOURS_PER_DAY));

  const errors = result?.ok ? {} : (result?.errors ?? {});
  const busy = phase !== "idle";
  const days = daysInclusive(start, end || start);
  const perDayHours = parseHours(perDay);
  const total = days !== null && perDayHours !== null ? days * perDayHours : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setResult(null);
    const supabase = createClient();
    let path: string | null = null;

    if (certificate) {
      const ext = uploadExtension(certificate.blob.type);
      if (!ext) return setResult({ ok: false, message: "Use a photo or a PDF." });
      path = `${userId}/${newFileId()}.${ext}`;
      setPhase("uploading");
      const { error } = await supabase.storage
        .from("leave-documents")
        .upload(path, certificate.blob, { contentType: certificate.blob.type, upsert: false });
      if (error) {
        setPhase("idle");
        return setResult({ ok: false, message: `Could not upload the certificate: ${error.message}` });
      }
      formData.set("certificate_path", path);
    }

    setPhase("saving");
    let saved: LeaveResult;
    try {
      saved = await requestLeave(formData);
    } catch {
      saved = { ok: false, message: "Could not reach the server. Check your connection and try again." };
    }
    if (!saved.ok && path) await supabase.storage.from("leave-documents").remove([path]);

    setPhase("idle");
    setResult(saved);
    if (saved.ok) {
      formRef.current?.reset();
      setCertificate(null);
      setStart(today);
      setEnd(today);
      setAmount("days");
      setPerDay(String(DEFAULT_HOURS_PER_DAY));
    }
  }

  const field = (name: string) => ({
    id: `leave-${name}`,
    name,
    "aria-invalid": Boolean(errors[name]),
    "aria-describedby": errors[name] ? `leave-${name}-error` : undefined,
  });
  const border = (name: string) => (errors[name] ? "border-warning" : "border-line");
  const fieldError = (name: string) =>
    errors[name] ? (
      <p id={`leave-${name}-error`} className="mt-1 text-sm text-warning">
        {errors[name]}
      </p>
    ) : null;

  let buttonText = "Send request";
  if (phase === "preparing") buttonText = "Preparing photo…";
  if (phase === "uploading") buttonText = "Uploading…";
  if (phase === "saving") buttonText = "Sending…";

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="leave-start_date" className="block text-sm font-semibold text-ink">
            First day
          </label>
          <input
            {...field("start_date")}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={`${inputClass} ${border("start_date")}`}
          />
          {fieldError("start_date")}
        </div>
        <div>
          <label htmlFor="leave-end_date" className="block text-sm font-semibold text-ink">
            Last day
          </label>
          <input
            {...field("end_date")}
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
            className={`${inputClass} ${border("end_date")}`}
          />
          {fieldError("end_date")}
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-ink">How much leave?</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <label className={choiceClass}>
            <input
              type="radio"
              name="amount"
              value="days"
              checked={amount === "days"}
              onChange={() => setAmount("days")}
              className="sr-only"
            />
            Whole days
          </label>
          <label className={choiceClass}>
            <input
              type="radio"
              name="amount"
              value="hours"
              checked={amount === "hours"}
              onChange={() => setAmount("hours")}
              className="sr-only"
            />
            Hours
          </label>
        </div>
        {amount === "days" ? (
          <div className="mt-2">
            <label htmlFor="leave-hours_per_day" className="block text-sm text-muted">
              Hours you would have worked each day
            </label>
            <input
              {...field("hours_per_day")}
              type="text"
              inputMode="decimal"
              value={perDay}
              onChange={(e) => setPerDay(e.target.value)}
              className={`${inputClass} ${border("hours_per_day")}`}
            />
            {fieldError("hours_per_day")}
            <p className="mt-1 text-sm text-muted" aria-live="polite">
              {total !== null && days !== null
                ? `${days} ${days === 1 ? "day" : "days"} = ${hoursText(total)}`
                : "Leave is recorded in hours"}
            </p>
          </div>
        ) : (
          <div className="mt-2">
            <label htmlFor="leave-hours" className="block text-sm text-muted">
              Total hours
            </label>
            <input
              {...field("hours")}
              type="text"
              inputMode="decimal"
              placeholder="e.g. 4"
              className={`${inputClass} ${border("hours")}`}
            />
            {fieldError("hours")}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-ink">Reason</legend>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {LEAVE_REASONS.map((reason) => (
            <label key={reason} className={choiceClass}>
              <input type="radio" name="reason" value={reason} defaultChecked={reason === "sick"} className="sr-only" />
              {LEAVE_REASON_LABELS[reason]}
            </label>
          ))}
        </div>
        {fieldError("reason")}
      </fieldset>

      <fieldset aria-describedby="leave-gi-help">
        <legend className="text-sm font-semibold text-ink">Do you have vomiting or diarrhoea?</legend>
        <p id="leave-gi-help" className="text-sm text-muted">
          Food safety: if yes, you can&apos;t work with food until a manager clears you (usually 48 hours after it stops).
        </p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <label className={choiceClass}>
            <input type="radio" name="gi_symptoms" value="yes" className="sr-only" />
            Yes
          </label>
          <label className={choiceClass}>
            <input type="radio" name="gi_symptoms" value="no" className="sr-only" />
            No
          </label>
        </div>
        {fieldError("gi_symptoms")}
      </fieldset>

      <DocumentPicker
        legend="Medical certificate (optional)"
        value={certificate}
        onChange={(file) => {
          setCertificate(file);
          setResult(null);
        }}
        onPreparingChange={(preparing) => setPhase(preparing ? "preparing" : "idle")}
        disabled={phase === "uploading" || phase === "saving"}
      />

      <div>
        <label htmlFor="leave-note" className="block text-sm font-semibold text-ink">
          Note <span className="font-normal text-muted">(optional)</span>
        </label>
        <p className="text-sm text-muted">No medical details needed.</p>
        <textarea
          {...field("note")}
          rows={2}
          maxLength={NOTE_MAX}
          placeholder="e.g. Back on Monday"
          className={`${inputClass} py-2 ${border("note")}`}
        />
        {fieldError("note")}
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
