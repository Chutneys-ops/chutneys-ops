import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { aucklandShortDay, aucklandTime, formatYmd } from "@/lib/dates";
import {
  RECENT_SITE_DAYS,
  audienceFor,
  audienceLabel,
  expiryDate,
  isLive,
  readStats,
  readStatsText,
  type Notice,
  type NoticeRead,
  type Person,
  type SiteChoice,
} from "@/lib/notices";
import { NOTICE_COLUMNS } from "@/lib/supabase/notices";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";
import { AcknowledgeButton, ArchiveButton, MarkRead } from "../notice-buttons";
import { NoticeTags } from "../notice-tags";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Site choices in the last 30 days, page by page past the API's 1000-row limit. */
async function recentChoices(supabase: Supabase, now: Date): Promise<SiteChoice[]> {
  const since = new Date(now.getTime() - RECENT_SITE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows: SiteChoice[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data } = await supabase
      .from("shifts")
      .select("staff_id, site_id, clock_in")
      .gt("clock_in", since)
      .order("id")
      .range(offset, offset + 999);
    rows.push(...((data ?? []) as SiteChoice[]));
    if (!data || data.length < 1000) return rows;
  }
}

/** Managers and owner: "Read by 12 of 18, acknowledged by 9" and who hasn't. */
async function ReadCounts({ supabase, notice, now }: { supabase: Supabase; notice: Notice; now: Date }) {
  const [peopleResult, choices, readsResult] = await Promise.all([
    supabase.from("staff").select("id, name, active"),
    notice.site_ids ? recentChoices(supabase, now) : Promise.resolve([]),
    supabase.from("notice_reads").select("notice_id, staff_id, read_at, acknowledged_at").eq("notice_id", notice.id),
  ]);
  const audience = audienceFor(notice, (peopleResult.data ?? []) as Person[], choices, now);
  const stats = readStats(notice, audience, (readsResult.data ?? []) as NoticeRead[]);

  return (
    <section className="mt-4 rounded-[14px] border border-line bg-white p-4">
      <h2 className="text-lg font-semibold">{readStatsText(stats, notice.needs_ack)}</h2>
      {notice.site_ids && (
        <p className="mt-1 text-sm text-muted">
          Counts people who chose {notice.site_ids.length === 1 ? "this site" : "one of these sites"} in the last{" "}
          {RECENT_SITE_DAYS} days.
        </p>
      )}
      {stats.notRead.length > 0 && (
        <details className="mt-2">
          <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold text-primary">
            Not read yet ({stats.notRead.length})
          </summary>
          <p className="text-[15px] text-ink">{stats.notRead.map((p) => p.name).join(", ")}</p>
        </details>
      )}
      {stats.notAcknowledged.length > 0 && (
        <details className="mt-2">
          <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold text-primary">
            Read but not acknowledged ({stats.notAcknowledged.length})
          </summary>
          <p className="text-[15px] text-ink">{stats.notAcknowledged.map((p) => p.name).join(", ")}</p>
        </details>
      )}
      {stats.total > 0 && stats.notRead.length === 0 && stats.notAcknowledged.length === 0 && (
        <p className="mt-1 text-[15px] font-semibold text-primary-dark">Everyone has seen it</p>
      )}
    </section>
  );
}

export default async function NoticePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  const manager = isManager(me);
  const now = new Date();

  // RLS: staff only get it if it's live and meant for them.
  const { data } = await supabase.from("notices").select(NOTICE_COLUMNS).eq("id", id).maybeSingle();
  const notice = data as Notice | null;
  if (!notice) notFound();

  const [posterResult, sitesResult, readResult] = await Promise.all([
    supabase.from("staff").select("name").eq("id", notice.posted_by).maybeSingle(),
    notice.site_ids ? supabase.from("sites").select("id, name").in("id", notice.site_ids) : Promise.resolve({ data: [] }),
    supabase
      .from("notice_reads")
      .select("acknowledged_at")
      .eq("notice_id", id)
      .eq("staff_id", userId)
      .maybeSingle(),
  ]);
  const poster = (posterResult.data as { name: string } | null)?.name ?? "a manager";
  const siteNames = Object.fromEntries(((sitesResult.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const myRead = readResult.data as { acknowledged_at: string | null } | null;

  const live = isLive(notice, now);
  const mine = notice.posted_by === userId;
  const acknowledged = Boolean(myRead?.acknowledged_at);
  const ended = notice.archived_at ? "Archived" : live ? undefined : "Expired";

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <BackLink href="/notices" label="Notices" />
      {/* Opening it marks it read (not your own posts, not ended ones). */}
      {!myRead && !mine && live && <MarkRead noticeId={id} />}

      <article className="mt-1 rounded-[14px] border border-line bg-white p-4">
        <NoticeTags pinned={notice.pinned} needsAck={notice.needs_ack} ended={ended} />
        <h1 className="mt-1 text-2xl font-bold break-words">{notice.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {poster} · {aucklandShortDay(notice.posted_at)}, {aucklandTime(notice.posted_at)}
          {notice.edited_at && ` · edited ${aucklandShortDay(notice.edited_at)}`}
        </p>
        <p className="text-sm text-muted">
          For: {audienceLabel(notice.site_ids, siteNames)}
          {notice.expires_at && ` · until ${formatYmd(expiryDate(notice.expires_at))}`}
        </p>

        <p className="mt-4 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-ink">{notice.body}</p>

        {notice.needs_ack && !mine && live && !acknowledged && <AcknowledgeButton noticeId={id} />}
        {notice.needs_ack && acknowledged && myRead?.acknowledged_at && (
          <p className="mt-4 rounded-xl bg-primary-light p-3 text-sm font-medium text-primary-dark">
            You acknowledged this on {aucklandShortDay(myRead.acknowledged_at)} at {aucklandTime(myRead.acknowledged_at)}.
          </p>
        )}
      </article>

      {manager && (
        <>
          {!notice.archived_at && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/notices/${id}/edit`}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted"
              >
                Edit
              </Link>
              <ArchiveButton noticeId={id} />
            </div>
          )}
          <ReadCounts supabase={supabase} notice={notice} now={now} />
        </>
      )}
    </main>
  );
}
