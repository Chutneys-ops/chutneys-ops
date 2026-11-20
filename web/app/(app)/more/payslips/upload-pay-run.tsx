"use client";

// "Upload pay run" (owner): choose the pay date and period, drop all the
// PDFs at once, check who each one is for, then Publish all.
//
// Each file is sent on its own to /more/payslips/upload, which matches it to
// a person (ingestPayslip) and, if it can, saves it as an unpublished draft.
// Nothing is visible to staff until Publish all.
//   - No match: pick the person, and the same file is sent again for them.
//   - Wrong match: the draft is withdrawn ("Matched to the wrong person";
//     payslips are never deleted) and the file is sent again for the right person.
//   - Leave out: a saved draft is withdrawn; an unmatched file is just dropped.

import { useRef, useState, type DragEvent } from "react";
import { FormMessage } from "@/components/password-field";
import {
  checkPayslipFile,
  checkRun,
  CONFIDENCE_LABELS,
  matchText,
  periodLabel,
  type Confidence,
  type Match,
  type PayRun,
} from "@/lib/payslips";
import type { IngestResult } from "@/lib/payslips-ingest";
import { publishPayslips, withdrawPayslip } from "./actions";

/** Leavers (active false) are included: the owner can upload their final payslip. */
type Person = { id: string; name: string; payroll_code: string | null; active: boolean };

type Status = "uploading" | "saved" | "unmatched" | "error" | "left_out" | "published";

type Item = {
  key: string;
  file: File;
  status: Status;
  payslipId?: string;
  staffId?: string;
  match?: Match;
  message?: string;
  /** The person picked in this row's dropdown. */
  choice: string;
  /** "Change person" is open on a saved row. */
  changing?: boolean;
  busy?: boolean;
};

const CONCURRENT_UPLOADS = 3;

const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border border-muted bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none disabled:bg-cream disabled:text-muted";
const primaryButton =
  "min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60";
const smallButton =
  "min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-muted disabled:cursor-wait disabled:opacity-60";

const confidenceClass: Record<Confidence, string> = {
  high: "bg-primary-light text-primary-dark",
  medium: "bg-warning-light text-warning",
  none: "bg-stone-100 text-stone-700",
};

const statusText: Partial<Record<Status, string>> = {
  uploading: "Uploading…",
  saved: "Ready to publish",
  left_out: "Left out",
  published: "Published",
};

let nextKey = 0;

export function UploadPayRun({ people, initialRun }: { people: Person[]; initialRun: PayRun }) {
  const [run, setRun] = useState<PayRun>(initialRun);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const names = new Map(people.map((p) => [p.id, p.name]));
  const turnedOff = new Set(people.filter((p) => !p.active).map((p) => p.id));
  const runErrors = checkRun(run);
  const runOk = Object.keys(runErrors).length === 0;
  // The dates are fixed once files are added: every file in the batch is for this run.
  const locked = items.length > 0;

  const patch = (key: string, change: Partial<Item>) =>
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)));

  /** Send one file; staffId = "it's for this person". */
  async function send(item: Item, staffId?: string) {
    patch(item.key, { status: "uploading", message: undefined, changing: false, busy: false });
    const form = new FormData();
    form.set("file", item.file);
    form.set("pay_date", run.payDate);
    form.set("period_start", run.periodStart);
    form.set("period_end", run.periodEnd);
    if (staffId) form.set("staff_id", staffId);

    let answer: IngestResult;
    try {
      const response = await fetch("/more/payslips/upload", { method: "POST", body: form });
      answer = (await response.json()) as IngestResult;
    } catch {
      answer = { status: "error", message: "Could not reach the server. Check your connection and try again." };
    }

    if (answer.status === "saved") {
      patch(item.key, {
        status: "saved",
        payslipId: answer.payslipId,
        staffId: answer.staffId,
        match: answer.match,
        choice: answer.staffId,
      });
    } else if (answer.status === "unmatched") {
      patch(item.key, { status: "unmatched", match: answer.match, payslipId: undefined, staffId: undefined });
    } else {
      patch(item.key, {
        status: "error",
        message: answer.message,
        match: answer.match,
        payslipId: undefined,
        staffId: undefined,
        choice: staffId ?? answer.match?.staffId ?? "",
      });
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setResult(null);
    if (!runOk) {
      setResult({ ok: false, message: "Fix the pay run dates first." });
      return;
    }
    const added: Item[] = Array.from(list).map((file) => {
      const problem = checkPayslipFile(file);
      return {
        key: `f${nextKey++}`,
        file,
        status: problem ? "error" : "uploading",
        message: problem ?? undefined,
        choice: "",
      };
    });
    setItems((current) => [...current, ...added]);

    // A few at a time, so a big run doesn't open dozens of uploads at once.
    const queue = added.filter((item) => item.status === "uploading");
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await send(item);
    };
    await Promise.all(Array.from({ length: CONCURRENT_UPLOADS }, worker));
  }

  async function withdrawThen(item: Item, reason: string, then: () => Promise<void> | void) {
    if (!item.payslipId) return then();
    patch(item.key, { busy: true, message: undefined });
    const done = await withdrawPayslip(item.payslipId, reason);
    if (!done.ok) {
      patch(item.key, { busy: false, message: done.message });
      return;
    }
    await then();
  }

  function changePerson(item: Item) {
    if (!item.choice || item.choice === item.staffId) {
      patch(item.key, { changing: false });
      return;
    }
    void withdrawThen(item, "Matched to the wrong person", () => send(item, item.choice));
  }

  function leaveOut(item: Item) {
    void withdrawThen(item, "Left out of the pay run", () =>
      patch(item.key, { status: "left_out", busy: false, payslipId: undefined, changing: false }),
    );
  }

  async function publishAll() {
    const ids = items.filter((i) => i.status === "saved" && i.payslipId).map((i) => i.payslipId!);
    setPublishing(true);
    setResult(null);
    const done = await publishPayslips(ids);
    setPublishing(false);
    setResult(done);
    if (done.ok) {
      const published = new Set(done.published ?? []);
      setItems((list) =>
        list.map((i) => (i.payslipId && published.has(i.payslipId) ? { ...i, status: "published" } : i)),
      );
    }
  }

  function startAgain() {
    setItems([]);
    setResult(null);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  }

  const count = (s: Status) => items.filter((i) => i.status === s).length;
  const ready = count("saved");
  const needPerson = count("unmatched");
  const failed = count("error");
  const uploading = count("uploading");
  const allPublished = items.length > 0 && items.every((i) => i.status === "published" || i.status === "left_out");
  const canPublish = ready > 0 && uploading === 0 && needPerson === 0 && failed === 0 && !publishing;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(
          [
            ["payDate", "Pay date"],
            ["periodStart", "Period from"],
            ["periodEnd", "Period to"],
          ] as const
        ).map(([field, label]) => (
          <div key={field}>
            <label htmlFor={`run-${field}`} className="block text-sm font-semibold text-ink">
              {label}
            </label>
            <input
              id={`run-${field}`}
              type="date"
              value={run[field]}
              disabled={locked}
              onChange={(e) => setRun({ ...run, [field]: e.target.value })}
              aria-invalid={Boolean(runErrors[field])}
              className={inputClass}
            />
            {runErrors[field] && <p className="mt-1 text-sm text-warning">{runErrors[field]}</p>}
          </div>
        ))}
      </div>
      {runOk && (
        <p className="text-sm text-muted">
          Staff will see: &ldquo;Your payslip for {periodLabel(run.periodStart, run.periodEnd)} is ready&rdquo;
        </p>
      )}

      {!allPublished && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-[14px] border-2 border-dashed px-4 py-5 text-center focus-within:ring-2 focus-within:ring-primary/30 ${
            dragging ? "border-primary bg-primary-light" : "border-line bg-cream hover:border-muted"
          } ${runOk ? "" : "pointer-events-none opacity-60"}`}
        >
          <span className="font-semibold text-ink">Drop the payslip PDFs here</span>
          <span className="text-sm text-muted">or tap to choose them. PDF only, up to 2 MB each.</span>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={!runOk}
            className="sr-only"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}

      {items.length > 0 && (
        <section aria-label="Check who each payslip is for">
          <h3 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">
            Check who each one is for ({items.length})
          </h3>
          <ul className="divide-y divide-line rounded-[14px] border border-line bg-white">
            {items.map((item) => (
              <ReviewRow
                key={item.key}
                item={item}
                people={people}
                names={names}
                turnedOff={turnedOff}
                onChoose={(choice) => patch(item.key, { choice })}
                onSendFor={() => void send(item, item.choice)}
                onRetry={() => void send(item, item.choice || undefined)}
                onToggleChange={() => patch(item.key, { changing: !item.changing, choice: item.staffId ?? "" })}
                onChangePerson={() => changePerson(item)}
                onLeaveOut={() => leaveOut(item)}
              />
            ))}
          </ul>
        </section>
      )}

      {items.length > 0 && !allPublished && (
        <div className="space-y-2">
          <p className="text-sm text-muted" aria-live="polite">
            {[
              `${ready} ready`,
              uploading ? `${uploading} uploading` : "",
              needPerson ? `${needPerson} ${needPerson === 1 ? "needs" : "need"} a person` : "",
              failed ? `${failed} with a problem` : "",
            ]
              .filter(Boolean)
              .join(", ")}
            . Nobody sees anything until you publish.
          </p>
          <button type="button" onClick={publishAll} disabled={!canPublish} className={primaryButton}>
            {publishing ? "Publishing…" : `Publish all (${ready})`}
          </button>
          {(needPerson > 0 || failed > 0) && (
            <p className="text-sm text-muted">Choose a person or leave out every file marked in orange to publish.</p>
          )}
        </div>
      )}

      {result && <FormMessage ok={result.ok} message={result.message} />}

      {items.length > 0 && uploading === 0 && (allPublished || ready === 0) && (
        <button type="button" onClick={startAgain} className={`${smallButton} w-full`}>
          Upload another pay run
        </button>
      )}
    </div>
  );
}

function ReviewRow({
  item,
  people,
  names,
  turnedOff,
  onChoose,
  onSendFor,
  onRetry,
  onToggleChange,
  onChangePerson,
  onLeaveOut,
}: {
  item: Item;
  people: Person[];
  names: Map<string, string>;
  turnedOff: Set<string>;
  onChoose: (staffId: string) => void;
  onSendFor: () => void;
  onRetry: () => void;
  onToggleChange: () => void;
  onChangePerson: () => void;
  onLeaveOut: () => void;
}) {
  const confidence: Confidence = item.status === "saved" || item.status === "published" ? (item.match?.confidence ?? "none") : "none";
  const needsPerson = item.status === "unmatched" || (item.status === "error" && !item.payslipId);
  const selectId = `person-${item.key}`;

  const personSelect = (
    <select
      id={selectId}
      value={item.choice}
      onChange={(e) => onChoose(e.target.value)}
      className="min-h-11 min-w-0 flex-1 rounded-xl border border-muted bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
    >
      <option value="">Choose a person…</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
          {p.payroll_code ? ` (${p.payroll_code})` : ""}
          {p.active ? "" : " (turned off)"}
        </option>
      ))}
    </select>
  );

  return (
    <li className={`space-y-2 px-4 py-3 ${needsPerson ? "border-l-4 border-l-warning" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 text-sm font-semibold break-all text-ink">{item.file.name}</span>
        {statusText[item.status] && <span className="text-xs font-semibold text-muted">{statusText[item.status]}</span>}
      </div>

      {(item.status === "saved" || item.status === "published") && item.staffId && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold text-ink">{names.get(item.staffId) ?? "Someone"}</span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${confidenceClass[confidence]}`}>
            {CONFIDENCE_LABELS[confidence]}
          </span>
          {item.match && <span className="text-sm text-muted">{matchText(item.match, names)}</span>}
        </div>
      )}
      {(item.status === "saved" || item.status === "published") && item.staffId && turnedOff.has(item.staffId) && (
        <p className="text-sm text-warning">
          Their account is turned off, so they can&apos;t sign in to see it. After publishing, use Download in the pay
          run list below and send it to them.
        </p>
      )}

      {item.status === "unmatched" && item.match && (
        <p className="text-sm text-warning">{matchText(item.match, names)}. Choose who it&apos;s for.</p>
      )}
      {item.message && <p className="text-sm text-warning">{item.message}</p>}

      {needsPerson && (
        <div className="flex flex-wrap gap-2">
          <label htmlFor={selectId} className="sr-only">
            Who is {item.file.name} for?
          </label>
          {personSelect}
          <button type="button" onClick={item.choice ? onSendFor : onRetry} className={smallButton}>
            {item.choice ? "Save for them" : "Try again"}
          </button>
          <button type="button" onClick={onLeaveOut} className={smallButton}>
            Leave out
          </button>
        </div>
      )}

      {item.status === "saved" && !item.changing && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onToggleChange} disabled={item.busy} className={smallButton}>
            Change person
          </button>
          <button type="button" onClick={onLeaveOut} disabled={item.busy} className={smallButton}>
            {item.busy ? "Working…" : "Leave out"}
          </button>
        </div>
      )}

      {item.status === "saved" && item.changing && (
        <div className="flex flex-wrap gap-2">
          <label htmlFor={selectId} className="sr-only">
            Who is {item.file.name} really for?
          </label>
          {personSelect}
          <button type="button" onClick={onChangePerson} disabled={item.busy || !item.choice} className={smallButton}>
            {item.busy ? "Moving…" : "Move to them"}
          </button>
          <button type="button" onClick={onToggleChange} disabled={item.busy} className={smallButton}>
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}
