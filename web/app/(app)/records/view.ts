// Which site and date the records pages show, and what you may do there.
//
// Staff: always the site of their open shift, today. There's no site id in
// the URL to change, and RLS would refuse other sites anyway.
// Managers and owner: ?site=...&date=... to look at any site and day. They
// can add entries only at the site they chose today.

import { notFound, redirect } from "next/navigation";
import { aucklandDate } from "@/lib/dates";
import type { createClient } from "@/lib/supabase/server";
import {
  getCurrentShift,
  getSession,
  isManager as isManagerRole,
  type CurrentShift,
  type Me,
  type SiteSummary,
} from "@/lib/supabase/session";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Params = Record<string, string | string[] | undefined>;

export type RecordsView = {
  me: Me;
  shift: CurrentShift | null;
  site: SiteSummary;
  date: string;
  today: string;
  isManager: boolean;
  /** You chose this site today and are looking at today. */
  canAdd: boolean;
  /** Every site, for the manager filter. Empty for staff. */
  sites: (SiteSummary & { active: boolean })[];
  /** "?site=..&date=.." to keep the manager's filter on links. "" for staff. */
  query: string;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Returns null when the login has no staff row (the page shows NotStaff). */
export async function getRecordsView(supabase: Supabase, params: Params): Promise<RecordsView | null> {
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return null;

  const shift = await getCurrentShift(supabase, userId);
  const today = aucklandDate();

  if (!isManagerRole(me)) {
    if (!shift) redirect("/start");
    return { me, shift, site: shift.site, date: today, today, isManager: false, canAdd: true, sites: [], query: "" };
  }

  // Managers can read every site (RLS "managers see all sites").
  const { data } = await supabase.from("sites").select("id, name, kind, active").order("name");
  const sites = (data ?? []) as RecordsView["sites"];
  const wanted = first(params.site);
  const site =
    sites.find((s) => s.id === wanted) ??
    sites.find((s) => s.id === shift?.site.id) ??
    sites.find((s) => s.active) ??
    sites[0];
  if (!site) notFound();

  // Only real dates, and never the future.
  const wantedDate = first(params.date);
  const date =
    wantedDate && /^\d{4}-\d{2}-\d{2}$/.test(wantedDate) && wantedDate <= today ? wantedDate : today;

  const query = `?${new URLSearchParams({ site: site.id, date }).toString()}`;
  return {
    me,
    shift,
    site,
    date,
    today,
    isManager: true,
    canAdd: shift?.site.id === site.id && date === today,
    sites,
    query,
  };
}
