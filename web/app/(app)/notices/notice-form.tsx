"use client";

// "New notice" and "Edit notice" (managers and owner): title, text, who
// it's for, pin, needs acknowledgement, optional "show until" date, and a
// live preview of how staff will see it.
//
// The inputs are controlled (useState) only so the preview can follow them;
// the form still submits as ordinary form data to the server action.

import { useActionState, useState } from "react";
import { ChoiceOption } from "@/components/choice-option";
import { BODY_MAX, TITLE_MAX, type NoticeForm as NoticeFormValues } from "@/lib/notices";
import type { NoticeFormState } from "./actions";
import { NoticeTags } from "./notice-tags";

const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none";

const EMPTY: NoticeFormValues = {
  title: "",
  body: "",
  audience: "everyone",
  site_ids: [],
  pinned: false,
  needs_ack: false,
  expires_on: "",
};

export function NoticeForm({
  action,
  sites,
  today,
  noticeId,
  initial,
  wordingLocked = false,
}: {
  action: (prev: NoticeFormState, formData: FormData) => Promise<NoticeFormState>;
  sites: { id: string; name: string }[];
  today: string;
  /** Set when editing. */
  noticeId?: string;
  initial?: NoticeFormValues;
  /** Someone has acknowledged it: the title and body can't change (the
   *  database refuses). They're shown read-only; they still submit, unchanged. */
  wordingLocked?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { seq: 0 });
  // A failed save keeps what was typed (the form is never remounted, since a
  // successful save leaves the page).
  const [form, setForm] = useState<NoticeFormValues>(initial ?? EMPTY);
  const errors = state.errors ?? {};
  const set = <K extends keyof NoticeFormValues>(key: K, value: NoticeFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const errorFor = (name: string) =>
    errors[name] ? (
      <p id={`notice-${name}-error`} className="mt-1 text-sm text-warning">
        {errors[name]}
      </p>
    ) : null;
  const aria = (name: string) => ({
    "aria-invalid": Boolean(errors[name]),
    "aria-describedby": errors[name] ? `notice-${name}-error` : undefined,
  });
  const border = (name: string) => (errors[name] ? "border-warning" : "border-line");

  const siteNames = sites.filter((s) => form.site_ids.includes(s.id)).map((s) => s.name);
  const previewAudience = form.audience === "sites" ? siteNames.join(", ") || "No sites chosen yet" : "Everyone";

  return (
    <form action={formAction} className="space-y-4">
      {noticeId && <input type="hidden" name="notice_id" value={noticeId} />}

      {wordingLocked && (
        <p className="rounded-xl bg-warning-light p-3 text-sm font-medium text-warning">
          People have already confirmed this notice, so its title and text can&apos;t change. To change the wording,
          archive it and post a new one. You can still change the other settings.
        </p>
      )}

      <div>
        <label htmlFor="notice-title" className="block text-sm font-semibold text-ink">
          Title
        </label>
        <input
          id="notice-title"
          name="title"
          type="text"
          maxLength={TITLE_MAX}
          autoComplete="off"
          value={form.title}
          readOnly={wordingLocked}
          onChange={(e) => set("title", e.target.value)}
          className={`${inputClass} ${border("title")} read-only:bg-cream read-only:text-muted`}
          {...aria("title")}
        />
        {errorFor("title")}
      </div>

      <div>
        <label htmlFor="notice-body" className="block text-sm font-semibold text-ink">
          Notice
        </label>
        <textarea
          id="notice-body"
          name="body"
          rows={6}
          maxLength={BODY_MAX}
          value={form.body}
          readOnly={wordingLocked}
          onChange={(e) => set("body", e.target.value)}
          className={`${inputClass} py-2 ${border("body")} read-only:bg-cream read-only:text-muted`}
          {...aria("body")}
        />
        <p className="mt-1 text-right text-xs text-muted">
          {form.body.length} / {BODY_MAX}
        </p>
        {errorFor("body")}
      </div>

      <fieldset>
        <legend className="block text-sm font-semibold text-ink">Who is it for?</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <ChoiceOption name="audience" value="everyone" checked={form.audience === "everyone"} onChange={() => set("audience", "everyone")}>
            Everyone
          </ChoiceOption>
          <ChoiceOption name="audience" value="sites" checked={form.audience === "sites"} onChange={() => set("audience", "sites")}>
            Choose sites
          </ChoiceOption>
        </div>
        {errorFor("audience")}
        {form.audience === "sites" && (
          <div className="mt-2 rounded-xl border border-line bg-white p-2" {...aria("site_ids")}>
            {sites.map((site) => (
              <label key={site.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-cream">
                <input
                  type="checkbox"
                  name="site_ids"
                  value={site.id}
                  checked={form.site_ids.includes(site.id)}
                  onChange={(e) =>
                    set(
                      "site_ids",
                      e.target.checked ? [...form.site_ids, site.id] : form.site_ids.filter((id) => id !== site.id),
                    )
                  }
                  className="h-5 w-5 shrink-0 accent-primary"
                />
                <span className="text-[15px] text-ink">{site.name}</span>
              </label>
            ))}
            <p className="px-2 pt-1 pb-1 text-xs text-muted">
              Staff see it if they chose one of these sites in the last 30 days.
            </p>
          </div>
        )}
        {errorFor("site_ids")}
      </fieldset>

      <div className="space-y-1 rounded-xl border border-line bg-white p-2">
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-cream">
          <input
            type="checkbox"
            name="pinned"
            checked={form.pinned}
            onChange={(e) => set("pinned", e.target.checked)}
            className="h-5 w-5 shrink-0 accent-primary"
          />
          <span className="text-[15px] text-ink">
            Pin to the top
          </span>
        </label>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-cream">
          <input
            type="checkbox"
            name="needs_ack"
            checked={form.needs_ack}
            onChange={(e) => set("needs_ack", e.target.checked)}
            className="h-5 w-5 shrink-0 accent-primary"
          />
          <span className="text-[15px] text-ink">
            Needs acknowledgement
            <span className="block text-sm text-muted">Staff tap &ldquo;I&apos;ve read and understood this&rdquo;</span>
          </span>
        </label>
      </div>

      <div>
        <label htmlFor="notice-expires_on" className="block text-sm font-semibold text-ink">
          Show until <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="notice-expires_on"
          name="expires_on"
          type="date"
          min={today}
          value={form.expires_on}
          onChange={(e) => set("expires_on", e.target.value)}
          className={`${inputClass} ${border("expires_on")}`}
          {...aria("expires_on")}
        />
        <p className="mt-1 text-sm text-muted">It disappears for staff after the end of this day.</p>
        {errorFor("expires_on")}
      </div>

      {/* Preview: the same look as the notice page */}
      <section aria-label="Preview" className="rounded-[14px] border border-dashed border-muted bg-cream p-4">
        <p className="text-[13px] font-semibold tracking-wide text-muted uppercase">Preview</p>
        <div className="mt-2 rounded-[14px] border border-line bg-white p-4">
          <NoticeTags pinned={form.pinned} needsAck={form.needs_ack} />
          <h2 className="mt-1 text-xl font-bold break-words text-ink">{form.title.trim() || "Your title"}</h2>
          <p className="mt-1 text-sm text-muted">For: {previewAudience}</p>
          <p className="mt-3 text-[15px] break-words whitespace-pre-wrap text-ink">
            {form.body.trim() || "Your notice text. Line breaks show as you type them."}
          </p>
          {form.needs_ack && (
            <p className="mt-4 flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 font-semibold text-white opacity-80">
              I&apos;ve read and understood this
            </p>
          )}
        </div>
      </section>

      {state.message && (
        <p role="alert" className="rounded-xl bg-warning-light p-3 text-sm font-medium text-warning">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="min-h-[50px] w-full rounded-xl bg-primary px-4 text-base font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Saving…" : noticeId ? "Save changes" : "Post notice"}
      </button>
    </form>
  );
}
