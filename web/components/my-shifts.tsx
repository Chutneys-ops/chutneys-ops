import { hoursText } from "@/lib/breaks";
import { shortYmd } from "@/lib/leave";
import { clockText, shiftTimesText } from "@/lib/roster";
import type { MyShift } from "@/lib/supabase/roster";

/** "Who's on with me": the others at the same site that day, folded away. */
function Coworkers({ shift }: { shift: MyShift }) {
  if (shift.coworkers.length === 0) {
    return <p className="mt-1 text-sm text-muted">Nobody else is rostered at this site that day.</p>;
  }
  return (
    <details className="mt-1">
      <summary className="inline-flex min-h-12 cursor-pointer list-none items-center text-sm font-semibold text-primary hover:text-primary-dark">
        Who&apos;s on with me ({shift.coworkers.length})
      </summary>
      <ul className="mb-1 space-y-0.5 text-sm text-ink">
        {shift.coworkers.map((c, i) => (
          <li key={`${c.name}-${i}`}>
            <span className="font-semibold">{c.name}</span>{" "}
            <span className="text-muted">
              {clockText(c.start_time)} to {clockText(c.finish_time)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** One of your rostered shifts: day, times, site, position, note and who
 *  else is on. `label` marks the next shift ("Next shift", up top). */
export function MyShiftItem({ shift, label }: { shift: MyShift; label?: string }) {
  return (
    <div>
      {label && <p className="text-[13px] font-semibold tracking-wide text-primary-dark uppercase">{label}</p>}
      <p className="text-[15px] font-semibold text-ink">
        {shortYmd(shift.work_date)} · {shiftTimesText(shift)}
      </p>
      <p className="text-sm text-muted">
        {shift.site?.name ?? "A closed site"}
        {shift.position ? ` · ${shift.position}` : ""} · {hoursText(shift.paid_minutes)} paid
      </p>
      {shift.note && <p className="mt-0.5 text-sm text-ink">Note: {shift.note}</p>}
      <Coworkers shift={shift} />
    </div>
  );
}
