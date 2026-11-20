"use client";

// Managers: each site's usual opening time and the days it trades.
//   - Opening checks not done 30 minutes after opening send a reminder to
//     the people at that site.
//   - On days a site doesn't trade there are no fridge or opening-check
//     reminders, and the verifier pack shows "Closed" instead of "No record".

import { useState, useTransition } from "react";
import { choiceOptionClass } from "@/components/choice-option";
import { ALL_DAYS, DAY_LONG, DAY_SHORT, tradingDaysText } from "@/lib/trading-days";
import { saveOpeningTime, saveTradingDays } from "./notification-actions";

type Site = { id: string; name: string; opens_at: string; trading_days: number[] | null };

const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d, i) => d === b[i]);

function SiteRow({ site }: { site: Site }) {
  const startDays = [...(site.trading_days?.length ? site.trading_days : ALL_DAYS)].sort((a, b) => a - b);
  const [time, setTime] = useState(site.opens_at.slice(0, 5));
  const [savedTime, setSavedTime] = useState(site.opens_at.slice(0, 5));
  const [days, setDays] = useState<number[]>(startDays);
  const [savedDays, setSavedDays] = useState<number[]>(startDays);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const timeChanged = time !== savedTime;
  const daysChanged = !sameDays(days, savedDays);

  function toggle(day: number) {
    setMessage(null);
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b)));
  }

  function save() {
    setMessage(null);
    start(async () => {
      // Only what changed. Two small calls rather than one combined function,
      // so each keeps its own clear error.
      if (timeChanged) {
        const result = await saveOpeningTime(site.id, time);
        if (!result.ok) return setMessage({ ok: false, text: result.message ?? "" });
        setSavedTime(time);
      }
      if (daysChanged) {
        const result = await saveTradingDays(site.id, days);
        if (!result.ok) return setMessage({ ok: false, text: result.message ?? "" });
        setSavedDays(days);
      }
      setMessage({ ok: true, text: "Saved" });
    });
  }

  return (
    <li className="px-3 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={`opens-${site.id}`} className="min-w-0 flex-1 text-[15px] font-semibold text-ink">
          {site.name}
        </label>
        <input
          id={`opens-${site.id}`}
          type="time"
          value={time}
          onChange={(e) => {
            setMessage(null);
            setTime(e.target.value);
          }}
          className="min-h-12 rounded-xl border border-line bg-white px-3 text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
        />
      </div>
      <fieldset className="mt-2">
        <legend className="text-sm text-muted">Trades: {tradingDaysText(days.length ? days : savedDays)}</legend>
        <div className="mt-1.5 grid grid-cols-7 gap-1">
          {ALL_DAYS.map((d) => (
            <label key={d} className={`${choiceOptionClass} px-0 text-sm`}>
              <input
                type="checkbox"
                className="sr-only"
                checked={days.includes(d)}
                onChange={() => toggle(d)}
                aria-label={DAY_LONG[d]}
              />
              {DAY_SHORT[d].slice(0, 2)}
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        onClick={save}
        disabled={pending || (!timeChanged && !daysChanged) || !time || days.length === 0}
        className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {days.length === 0 && (
        <p role="alert" className="mt-1 text-sm text-warning">
          Choose at least one trading day.
        </p>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`mt-1 text-sm ${message.ok ? "text-primary-dark" : "text-warning"}`}>
          {message.text}
        </p>
      )}
    </li>
  );
}

export function OpeningTimesForm({ sites }: { sites: Site[] }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {sites.map((s) => (
        <SiteRow key={s.id} site={s} />
      ))}
    </ul>
  );
}
