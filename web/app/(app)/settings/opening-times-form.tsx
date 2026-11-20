"use client";

// Managers: each site's usual opening time. Opening checks not done 30
// minutes after it send a reminder to the people at that site.

import { useState, useTransition } from "react";
import { saveOpeningTime } from "./notification-actions";

type Site = { id: string; name: string; opens_at: string };

function SiteRow({ site }: { site: Site }) {
  const [value, setValue] = useState(site.opens_at.slice(0, 5));
  const [saved, setSaved] = useState(site.opens_at.slice(0, 5));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setMessage(null);
    start(async () => {
      const result = await saveOpeningTime(site.id, value);
      if (result.ok) setSaved(value);
      setMessage({ ok: result.ok, text: result.message ?? "" });
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2">
      <label htmlFor={`opens-${site.id}`} className="min-w-0 flex-1 text-[15px] font-semibold text-ink">
        {site.name}
      </label>
      <input
        id={`opens-${site.id}`}
        type="time"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-h-12 rounded-xl border border-line bg-white px-3 text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
      />
      <button
        type="button"
        onClick={save}
        disabled={pending || value === saved || !value}
        className="min-h-12 rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`w-full text-sm ${message.ok ? "text-primary-dark" : "text-warning"}`}>
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
