// Pure rules for phone notifications: who gets which reminder and when,
// the keys that stop a reminder going twice, people's on/off switches, and
// the wording of every notification. No Supabase, no web-push, so they run
// under `node --test`. The cron route (app/api/cron/reminders) and
// lib/notify.ts fetch the data and hand it to these.

import { aucklandDate } from "./dates.ts";
import { STALE_HOURS } from "./hours.ts";
import { dateRangeText, shortYmd } from "./leave.ts";
import { addDays, clockText, shiftTimesText } from "./roster.ts";
import { isTradingDay } from "./trading-days.ts";

// ---- Switches ------------------------------------------------------------------------

/** The switches in Settings > Notifications (columns of notification_prefs). */
export const CATEGORIES = ["notices", "roster", "reminders", "approvals", "payslips"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Prefs = Record<Category, boolean>;

export const CATEGORY_LABELS: Record<Category, { label: string; hint: string }> = {
  notices: { label: "Notices", hint: "A new notice for you" },
  roster: { label: "Roster", hint: "Your shifts are up or changed, and the evening before a shift" },
  reminders: { label: "Reminders", hint: "Fridge temperatures and opening checks not done yet" },
  approvals: { label: "Approvals", hint: "Your leave is decided. Managers: hours and leave waiting" },
  payslips: { label: "Payslips", hint: "Your payslip is ready" },
};

/** No row in notification_prefs means everything on. */
export const DEFAULT_PREFS: Prefs = { notices: true, roster: true, reminders: true, approvals: true, payslips: true };

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/** A notification_prefs row (or nothing) -> every switch. */
export function prefsFrom(row: Partial<Record<Category, boolean | null>> | null | undefined): Prefs {
  const prefs = { ...DEFAULT_PREFS };
  for (const c of CATEGORIES) {
    const v = row?.[c];
    if (typeof v === "boolean") prefs[c] = v;
  }
  return prefs;
}

// ---- Auckland clock ------------------------------------------------------------------

const clockFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "Pacific/Auckland",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes since midnight in Auckland (0 to 1439). Daylight saving is
 *  handled by Intl: 10:00 is 10:00 on the wall clock all year. */
export function aucklandMinutes(now: Date = new Date()): number {
  const parts = clockFormat.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return (hour % 24) * 60 + minute;
}

/** "09:00" or "09:00:00" (a Postgres time) -> 540. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** 540 -> "09:00" (for <input type="time"> and the database). */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---- Reminder types and their windows ------------------------------------------------

export type ReminderKind = "fridge_staff" | "fridge_manager" | "opening_checks" | "approvals_digest" | "shift_tomorrow";

/** Which switch turns each reminder off. */
export const KIND_CATEGORY: Record<ReminderKind, Category> = {
  fridge_staff: "reminders",
  fridge_manager: "reminders",
  opening_checks: "reminders",
  approvals_digest: "approvals",
  shift_tomorrow: "roster",
};

/** When each reminder may be sent, in Auckland minutes since midnight
 *  [from, until). The job runs every 5 minutes; a reminder goes on the first
 *  run inside its window. The end stops a stale one going out much later
 *  (say, a run that was down all morning, or someone who turns notifications
 *  on at 3 pm). */
export const WINDOWS = {
  fridgeStaff: [10 * 60, 14 * 60],
  fridgeManager: [11 * 60, 14 * 60],
  /** Minutes after the site's opening time. */
  openingAfter: [30, 3 * 60],
  approvalsDigest: [17 * 60, 20 * 60],
  shiftTomorrow: [19 * 60, 22 * 60],
} as const;

/** The default opening time (sites.opens_at). */
export const DEFAULT_OPENS_AT = "09:00";

function inWindow(minutes: number, [from, until]: readonly [number, number]): boolean {
  return minutes >= from && minutes < until;
}

/** One key per person, type and Auckland day: sent_notifications.dedupe_key. */
export function reminderKey(kind: ReminderKind, staffId: string, ymd: string): string {
  return `${kind}:${ymd}:${staffId}`;
}

// ---- Working out the reminders -----------------------------------------------------------

export type SiteLite = {
  id: string;
  name: string;
  kind: string;
  opens_at: string;
  /** ISO weekdays it trades (sites.trading_days); null or missing = every day. */
  trading_days?: number[] | null;
};
export type TemplateForReminders = { code: string; site_kinds: string[] };
export type PersonLite = { id: string; name: string; role: "staff" | "manager" | "owner"; active: boolean };
/** An open site choice (shifts row with clock_out null). */
export type ChoiceLite = { staff_id: string; site_id: string; clock_in: string };
export type TomorrowShift = { staff_id: string; site_id: string; start_time: string; finish_time: string };

export type ReminderData = {
  /** Active sites. */
  sites: SiteLite[];
  /** Active record templates (only fridge_daily and opening_checks_* matter). */
  templates: TemplateForReminders[];
  /** Today's sheets that have at least one entry: done for today. */
  doneToday: { site_id: string; template_code: string }[];
  choices: ChoiceLite[];
  people: PersonLite[];
  /** staff id -> switches; missing means all on. */
  prefs: Record<string, Prefs>;
  /** People with at least one push subscription. Nobody else is claimed. */
  subscribed: string[];
  /** Waiting for a manager: one row per submitted timesheet / pending leave request. */
  timesheetsWaiting: { staff_id: string }[];
  leaveWaiting: { staff_id: string }[];
  /** Shifts in published roster weeks for tomorrow (Auckland). */
  tomorrowShifts: TomorrowShift[];
};

export type Reminder = {
  kind: ReminderKind;
  staffId: string;
  /** The Auckland date it's for (sent_notifications.for_date). */
  forDate: string;
  key: string;
  title: string;
  body: string;
  url: string;
};

export const FRIDGE_CODE = "fridge_daily";
const OPENING_PREFIX = "opening_checks";

const isManagerRole = (p: PersonLite) => p.role === "manager" || p.role === "owner";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "A", "A and B", "A, B and C". */
export function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** People who chose the site today (Auckland date) and are still there.
 *  A choice older than STALE_HOURS doesn't count (same as on_shift_at). */
export function peopleAtSiteToday(choices: ChoiceLite[], siteId: string, now: Date): string[] {
  const today = aucklandDate(now);
  const staleBefore = now.getTime() - STALE_HOURS * 60 * 60 * 1000;
  const ids = choices
    .filter(
      (c) =>
        c.site_id === siteId &&
        aucklandDate(new Date(c.clock_in)) === today &&
        new Date(c.clock_in).getTime() > staleBefore,
    )
    .map((c) => c.staff_id);
  return [...new Set(ids)];
}

/** The opening checks template for a kind of site (opening_checks_truck...). */
export function openingTemplateFor(kind: string, templates: TemplateForReminders[]): string | null {
  return templates.find((t) => t.code.startsWith(OPENING_PREFIX) && t.site_kinds.includes(kind))?.code ?? null;
}

/** "3 timesheets and 1 leave request waiting". Managers don't count their
 *  own (they can't approve them); the owner counts everything. */
export function waitingCounts(
  me: Pick<PersonLite, "id" | "role">,
  data: Pick<ReminderData, "timesheetsWaiting" | "leaveWaiting">,
): { timesheets: number; leave: number } {
  const mine = (r: { staff_id: string }) => me.role === "owner" || r.staff_id !== me.id;
  return {
    timesheets: data.timesheetsWaiting.filter(mine).length,
    leave: data.leaveWaiting.filter(mine).length,
  };
}

export function digestText(counts: { timesheets: number; leave: number }): string {
  return `${plural(counts.timesheets, "timesheet", "timesheets")} and ${plural(counts.leave, "leave request", "leave requests")} waiting`;
}

/** Everything due right now, before the "already sent" check (the route
 *  claims each key in sent_notifications and only sends the new ones).
 *  Turned-off accounts, people who switched the type off and people with
 *  no subscription are left out here. */
export function dueReminders(now: Date, data: ReminderData): Reminder[] {
  const today = aucklandDate(now);
  const minutes = aucklandMinutes(now);
  const people = new Map(data.people.filter((p) => p.active).map((p) => [p.id, p]));
  const subscribed = new Set(data.subscribed);
  const done = new Set(data.doneToday.map((d) => `${d.site_id}|${d.template_code}`));
  const isDone = (siteId: string, code: string) => done.has(`${siteId}|${code}`);
  const fridgeTemplate = data.templates.find((t) => t.code === FRIDGE_CODE);
  const out: Reminder[] = [];
  const seen = new Set<string>();

  const add = (kind: ReminderKind, staffId: string, title: string, body: string, url: string) => {
    if (!people.has(staffId) || !subscribed.has(staffId)) return;
    const prefs = data.prefs[staffId] ?? DEFAULT_PREFS;
    if (!prefs[KIND_CATEGORY[kind]]) return;
    const key = reminderKey(kind, staffId, today);
    if (seen.has(key)) return; // one per person, type and day
    seen.add(key);
    out.push({ kind, staffId, forDate: today, key, title, body, url });
  };

  // Fridge and opening-check reminders only go out for sites trading today
  // (sites.trading_days): nothing is expected on the days a site is closed.
  const trading = data.sites.filter((s) => isTradingDay(s.trading_days, today));

  // Fridge temperatures: from 10:00, to people at a site where they're not done.
  const fridgeMissing = fridgeTemplate
    ? trading.filter((s) => fridgeTemplate.site_kinds.includes(s.kind) && !isDone(s.id, FRIDGE_CODE))
    : [];
  if (inWindow(minutes, WINDOWS.fridgeStaff)) {
    for (const site of fridgeMissing) {
      for (const staffId of peopleAtSiteToday(data.choices, site.id, now)) {
        add(
          "fridge_staff",
          staffId,
          "Fridge temperatures",
          `Fridge temperatures not done yet at ${site.name}`,
          `/records/${FRIDGE_CODE}`,
        );
      }
    }
  }

  // Still missing at 11:00: managers hear about every site open today
  // (someone chose it) without them. Closed trucks don't count.
  if (inWindow(minutes, WINDOWS.fridgeManager)) {
    const open = fridgeMissing.filter((s) => peopleAtSiteToday(data.choices, s.id, now).length > 0);
    if (open.length > 0) {
      const names = listText(open.map((s) => s.name));
      for (const p of people.values()) {
        if (!isManagerRole(p)) continue;
        add("fridge_manager", p.id, "Fridge temperatures missing", `Fridge temperatures not done yet at ${names}`, "/records");
      }
    }
  }

  // Opening checks: 30 minutes after the site's opening time.
  for (const site of trading) {
    const code = openingTemplateFor(site.kind, data.templates);
    if (!code || isDone(site.id, code)) continue;
    const opens = timeToMinutes(site.opens_at || DEFAULT_OPENS_AT);
    const [after, until] = WINDOWS.openingAfter;
    if (!inWindow(minutes, [opens + after, opens + until])) continue;
    for (const staffId of peopleAtSiteToday(data.choices, site.id, now)) {
      add(
        "opening_checks",
        staffId,
        "Opening checks",
        `Opening checks not done yet at ${site.name} (opened ${clockText(site.opens_at || DEFAULT_OPENS_AT)})`,
        `/records/${code}`,
      );
    }
  }

  // 17:00: managers hear what's waiting for them.
  if (inWindow(minutes, WINDOWS.approvalsDigest)) {
    for (const p of people.values()) {
      if (!isManagerRole(p)) continue;
      const counts = waitingCounts(p, data);
      if (counts.timesheets + counts.leave === 0) continue;
      add(
        "approvals_digest",
        p.id,
        "Waiting for you",
        digestText(counts),
        counts.timesheets > 0 ? "/time" : "/leave/requests",
      );
    }
  }

  // The evening before a rostered shift.
  if (inWindow(minutes, WINDOWS.shiftTomorrow)) {
    const siteNames = new Map(data.sites.map((s) => [s.id, s.name]));
    const byPerson = new Map<string, TomorrowShift[]>();
    for (const s of data.tomorrowShifts) byPerson.set(s.staff_id, [...(byPerson.get(s.staff_id) ?? []), s]);
    for (const [staffId, shifts] of byPerson) {
      add("shift_tomorrow", staffId, "Shift tomorrow", shiftTomorrowText(shifts, siteNames), "/time");
    }
  }

  return out;
}

/** "You're on tomorrow 9:00 am to 5:00 pm at Cafe", several shifts joined with "and". */
export function shiftTomorrowText(shifts: TomorrowShift[], siteNames: Map<string, string>): string {
  const sorted = [...shifts].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const parts = sorted.map((s) => `${shiftTimesText(s)} at ${siteNames.get(s.site_id) ?? "a site"}`);
  return `You're on tomorrow ${listText(parts)}`;
}

/** Tomorrow's Auckland date, for the roster query. */
export function tomorrowYmd(now: Date = new Date()): string {
  return addDays(aucklandDate(now), 1);
}

// ---- Event notifications (sent straight away, not scheduled) -------------------------------

export type PushMessage = { title: string; body: string; url: string; tag?: string };

export function noticeMessage(notice: { id: string; title: string; needsAck: boolean }): PushMessage {
  return {
    title: notice.needsAck ? "New notice: please read and confirm" : "New notice",
    body: notice.title,
    url: `/notices/${notice.id}`,
    tag: `notice-${notice.id}`,
  };
}

export function rosterMessage(alert: { weekStart: string; siteName: string; republished: boolean }): PushMessage {
  const week = shortYmd(alert.weekStart);
  return alert.republished
    ? {
        title: "Your shifts changed",
        body: `The ${alert.siteName} roster for the week of ${week} changed. Check your shifts.`,
        url: "/time",
        tag: `roster-${alert.weekStart}`,
      }
    : {
        title: "Roster is up",
        body: `Your shifts at ${alert.siteName} for the week of ${week} are up.`,
        url: "/time",
        tag: `roster-${alert.weekStart}`,
      };
}

export function leaveDecidedMessage(leave: {
  id: string;
  status: "approved" | "declined";
  start_date: string;
  end_date: string;
}): PushMessage {
  const when = dateRangeText(leave.start_date, leave.end_date);
  return {
    title: leave.status === "approved" ? "Leave approved" : "Leave declined",
    body: `Your sick leave for ${when} was ${leave.status}.`,
    url: "/leave",
    tag: `leave-${leave.id}`,
  };
}

export const TEST_MESSAGE: PushMessage = {
  title: "Chutneys Ops",
  body: "Notifications work on this device.",
  url: "/settings",
  tag: "test",
};

// ---- Push service replies -------------------------------------------------------------------------

/** 404 or 410 from the push service: the subscription is gone for good
 *  (notifications turned off, app removed). Delete it. */
export function isGoneStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

/** Only our own pages: a notification can't open another site. */
export function safeUrl(url: string): string {
  return url.startsWith("/") && !url.startsWith("//") ? url : "/home";
}
