// Server-side loading for the notice board, shared by /notices, Home and
// More. Every query runs as the signed-in person, so RLS decides what comes
// back. The rules about what counts live in lib/notices.ts (tested).

import { inbox, inboxCounts, withMyReads, type InboxItem, type Notice, type NoticeRead } from "@/lib/notices";
import type { createClient } from "./server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const NOTICE_COLUMNS =
  "id, title, body, site_ids, pinned, needs_ack, posted_by, posted_at, expires_at, edited_at, archived_at";

/** Notices that are live right now (managers would otherwise get archived
 *  and expired ones too), newest first. */
export async function liveNotices(supabase: Supabase): Promise<Notice[]> {
  const { data } = await supabase
    .from("notices")
    .select(NOTICE_COLUMNS)
    .is("archived_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("posted_at", { ascending: false })
    .limit(300);
  return (data ?? []) as Notice[];
}

/** Your reads of these notices. */
export async function myReads(supabase: Supabase, userId: string, noticeIds: string[]): Promise<NoticeRead[]> {
  if (noticeIds.length === 0) return [];
  const { data } = await supabase
    .from("notice_reads")
    .select("notice_id, staff_id, read_at, acknowledged_at")
    .eq("staff_id", userId)
    .in("notice_id", noticeIds);
  return (data ?? []) as NoticeRead[];
}

/** Sites you chose in the last 30 days (the database's own rule). */
export async function myRecentSiteIds(supabase: Supabase): Promise<string[]> {
  const { data } = await supabase.rpc("my_recent_site_ids");
  return (data ?? []) as string[];
}

/** Your notices with read state, pinned first then newest, and the counts. */
export async function loadMyInbox(supabase: Supabase, userId: string) {
  const [notices, recentSiteIds] = await Promise.all([liveNotices(supabase), myRecentSiteIds(supabase)]);
  const mine = inbox(notices, { id: userId, recentSiteIds });
  const reads = await myReads(
    supabase,
    userId,
    mine.map((n) => n.id),
  );
  const items: InboxItem[] = withMyReads(mine, reads);
  return { items, counts: inboxCounts(items), notices, recentSiteIds };
}
