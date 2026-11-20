// Pure helpers for the notice board: who a notice is for, what's unread,
// read counts for managers, form checks and the expiry date. No React, no
// Supabase, so they run under `node --test`. Pages fetch the rows (under
// RLS) and hand them to these.

import { aucklandDate } from "./dates.ts";

/** Same 30 days as my_recent_site_ids() in the notices migration (the test
 *  reads the SQL to check). A site notice reaches people who chose that
 *  site in this many days. */
export const RECENT_SITE_DAYS = 30;
export const TITLE_MAX = 120;
export const BODY_MAX = 2000;

export type Notice = {
  id: string;
  title: string;
  body: string;
  /** null = everyone */
  site_ids: string[] | null;
  pinned: boolean;
  needs_ack: boolean;
  posted_by: string;
  posted_at: string;
  expires_at: string | null;
  edited_at: string | null;
  archived_at: string | null;
};

export type NoticeRead = { notice_id: string; staff_id: string; read_at: string; acknowledged_at: string | null };
export type Person = { id: string; name: string; active: boolean };
/** One "Choose site" (a shifts row): who, where, when. */
export type SiteChoice = { staff_id: string; site_id: string; clock_in: string };

// ---- Who a notice is for ------------------------------------------------------------

/** Not archived and not expired. */
export function isLive(notice: Pick<Notice, "archived_at" | "expires_at">, now: Date = new Date()): boolean {
  if (notice.archived_at) return false;
  return !notice.expires_at || new Date(notice.expires_at).getTime() > now.getTime();
}

/** For everyone, or for one of these sites. */
export function isForSites(notice: Pick<Notice, "site_ids">, siteIds: Iterable<string>): boolean {
  if (notice.site_ids === null) return true;
  const mine = new Set(siteIds);
  return notice.site_ids.some((id) => mine.has(id));
}

/** Pinned first, then newest. Returns a new array. */
export function sortNotices<T extends Pick<Notice, "pinned" | "posted_at">>(notices: T[]): T[] {
  return [...notices].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.posted_at.localeCompare(a.posted_at);
  });
}

/** Your notices: live, for everyone or a site you chose recently, and not
 *  posted by you. For staff RLS already did this; managers see every notice,
 *  so the same rule keeps their badge to what's meant for them. */
export function inbox(
  notices: Notice[],
  me: { id: string; recentSiteIds: string[] },
  now: Date = new Date(),
): Notice[] {
  return sortNotices(
    notices.filter((n) => n.posted_by !== me.id && isLive(n, now) && isForSites(n, me.recentSiteIds)),
  );
}

export type InboxItem = Notice & { read: boolean; acknowledged: boolean };

/** Your inbox with your own read and acknowledged state. */
export function withMyReads(notices: Notice[], myReads: NoticeRead[]): InboxItem[] {
  const byNotice = new Map(myReads.map((r) => [r.notice_id, r]));
  return notices.map((n) => {
    const read = byNotice.get(n.id);
    return { ...n, read: Boolean(read), acknowledged: Boolean(read?.acknowledged_at) };
  });
}

/** Still waiting on you: unread, or needs your acknowledgement. */
export function needsYou(item: InboxItem): boolean {
  return !item.read || (item.needs_ack && !item.acknowledged);
}

/** The numbers for Home and the More badge. */
export function inboxCounts(items: InboxItem[]): { unread: number; toAcknowledge: number; waiting: number } {
  return {
    unread: items.filter((i) => !i.read).length,
    toAcknowledge: items.filter((i) => i.needs_ack && !i.acknowledged).length,
    waiting: items.filter(needsYou).length,
  };
}

// ---- Read counts (managers and owner) -------------------------------------------------

/** The people a notice is for: active people except the one who posted it.
 *  A site notice: only those who chose one of its sites in the
 *  RECENT_SITE_DAYS before now (the same rule staff are shown it by). */
export function audienceFor(
  notice: Pick<Notice, "site_ids" | "posted_by">,
  people: Person[],
  choices: SiteChoice[],
  now: Date = new Date(),
): Person[] {
  const active = people.filter((p) => p.active && p.id !== notice.posted_by);
  if (notice.site_ids === null) return active;
  const sites = new Set(notice.site_ids);
  const since = now.getTime() - RECENT_SITE_DAYS * 24 * 60 * 60 * 1000;
  const recent = new Set(
    choices.filter((c) => sites.has(c.site_id) && new Date(c.clock_in).getTime() > since).map((c) => c.staff_id),
  );
  return active.filter((p) => recent.has(p.id));
}

export type ReadStats = {
  total: number;
  read: number;
  acknowledged: number;
  notRead: Person[];
  /** Read but not acknowledged (only for needs_ack notices). */
  notAcknowledged: Person[];
};

/** Who in the audience has read (and acknowledged) it. Reads by people
 *  outside the audience (a manager having a look) don't count. */
export function readStats(notice: Pick<Notice, "id" | "needs_ack">, audience: Person[], reads: NoticeRead[]): ReadStats {
  const mine = new Map(reads.filter((r) => r.notice_id === notice.id).map((r) => [r.staff_id, r]));
  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
  const notRead = audience.filter((p) => !mine.has(p.id)).sort(byName);
  const notAcknowledged = notice.needs_ack
    ? audience.filter((p) => mine.has(p.id) && !mine.get(p.id)!.acknowledged_at).sort(byName)
    : [];
  return {
    total: audience.length,
    read: audience.length - notRead.length,
    acknowledged: notice.needs_ack ? audience.filter((p) => mine.get(p.id)?.acknowledged_at).length : 0,
    notRead,
    notAcknowledged,
  };
}

/** "Read by 12 of 18, acknowledged by 9" */
export function readStatsText(stats: ReadStats, needsAck: boolean): string {
  const read = `Read by ${stats.read} of ${stats.total}`;
  return needsAck ? `${read}, acknowledged by ${stats.acknowledged}` : read;
}

// ---- Labels --------------------------------------------------------------------------

/** "Everyone", or the site names in the order given. */
export function audienceLabel(siteIds: string[] | null, siteNames: Record<string, string>): string {
  if (siteIds === null) return "Everyone";
  return siteIds.map((id) => siteNames[id] ?? "a closed site").join(", ");
}

// ---- Expiry ---------------------------------------------------------------------------

function nextDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "Show until 2026-11-25" means through the end of that Auckland day, so it
 *  expires at midnight starting the 26th. Postgres reads the zone name, so
 *  daylight saving is handled there. */
export function expiryFromDate(ymd: string): string {
  return `${nextDate(ymd)} 00:00:00 Pacific/Auckland`;
}

/** Back from the stored time to the "show until" date, for the edit form. */
export function expiryDate(expiresAt: string): string {
  return aucklandDate(new Date(new Date(expiresAt).getTime() - 1000));
}

// ---- Form checks ------------------------------------------------------------------------

export type NoticeForm = {
  title: string;
  body: string;
  /** "everyone" or "sites" */
  audience: string;
  site_ids: string[];
  pinned: boolean;
  needs_ack: boolean;
  /** "YYYY-MM-DD" or "" for no expiry */
  expires_on: string;
};

export type NoticeValues = {
  title: string;
  body: string;
  site_ids: string[] | null;
  pinned: boolean;
  needs_ack: boolean;
  expires_at: string | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Line breaks as "\n" (browsers send "\r\n"), trailing spaces trimmed. */
export function cleanBody(body: string): string {
  return body.replace(/\r\n?/g, "\n").trim();
}

/** Checks the form. knownSiteIds: the sites that can be chosen. */
export function validateNotice(
  form: NoticeForm,
  today: string,
  knownSiteIds: string[],
): { values?: NoticeValues; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const title = form.title.trim();
  const body = cleanBody(form.body);

  if (!title) errors.title = "Give it a title";
  else if (title.length > TITLE_MAX) errors.title = `Keep the title to ${TITLE_MAX} characters`;

  if (!body) errors.body = "Write the notice";
  else if (body.length > BODY_MAX) errors.body = `Keep it to ${BODY_MAX} characters`;

  let siteIds: string[] | null = null;
  if (form.audience === "sites") {
    const known = new Set(knownSiteIds);
    siteIds = [...new Set(form.site_ids)].filter((id) => known.has(id));
    if (siteIds.length === 0) errors.site_ids = "Choose at least one site";
  } else if (form.audience !== "everyone") {
    errors.audience = "Choose who it's for";
  }

  let expiresAt: string | null = null;
  if (form.expires_on) {
    if (!YMD.test(form.expires_on) || Number.isNaN(Date.parse(`${form.expires_on}T00:00:00Z`))) {
      errors.expires_on = "Choose a date";
    } else if (form.expires_on < today) {
      errors.expires_on = "Choose today or a later date";
    } else {
      expiresAt = expiryFromDate(form.expires_on);
    }
  }

  if (Object.keys(errors).length > 0) return { errors };
  return {
    values: { title, body, site_ids: siteIds, pinned: form.pinned, needs_ack: form.needs_ack, expires_at: expiresAt },
    errors,
  };
}
