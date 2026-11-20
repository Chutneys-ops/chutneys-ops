import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { aucklandShortDay } from "@/lib/dates";
import { isLive, sortNotices, type Notice } from "@/lib/notices";
import { loadMyInbox, NOTICE_COLUMNS } from "@/lib/supabase/notices";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";
import { NoticeTags } from "./notice-tags";

// The notice board. Everyone sees their notices, pinned first then newest,
// with unread ones highlighted. Managers and the owner see every live
// notice (also other sites' and their own), "New notice", and the expired
// and archived ones folded away at the bottom.

type Row = Notice & { unread: boolean; toAcknowledge: boolean };

function NoticeList({ rows, now }: { rows: Row[]; now: Date }) {
  return (
    <ul className="space-y-2">
      {rows.map((n) => {
        const ended = n.archived_at ? "Archived" : isLive(n, now) ? undefined : "Expired";
        return (
          <li key={n.id}>
            <Link
              href={`/notices/${n.id}`}
              className={`block rounded-[14px] border p-4 hover:border-muted ${
                n.unread ? "border-primary bg-primary-light" : "border-line bg-white"
              }`}
            >
              <NoticeTags
                pinned={n.pinned}
                unread={n.unread}
                toAcknowledge={n.toAcknowledge}
                needsAck={n.needs_ack}
                ended={ended}
              />
              <span className={`mt-1 block text-[17px] break-words text-ink ${n.unread ? "font-bold" : "font-semibold"}`}>
                {n.title}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-sm break-words text-muted">{n.body}</span>
              <span className="mt-1 block text-xs text-muted">{aucklandShortDay(n.posted_at)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function NoticesPage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  const manager = isManager(me);
  const now = new Date();

  const { items, notices } = await loadMyInbox(supabase, userId);
  const mineById = new Map(items.map((i) => [i.id, i]));
  const toRow = (n: Notice): Row => {
    const item = mineById.get(n.id);
    return {
      ...n,
      unread: item ? !item.read : false,
      toAcknowledge: item ? item.needs_ack && !item.acknowledged : false,
    };
  };

  // Staff: RLS already limits them to their notices. Managers: every live
  // notice, highlighted only where it's meant for them.
  const rows = manager ? sortNotices(notices).map(toRow) : items.map(toRow);

  // Managers: the ended ones (archived or expired), newest first.
  let ended: Row[] = [];
  if (manager) {
    const { data } = await supabase
      .from("notices")
      .select(NOTICE_COLUMNS)
      .or(`archived_at.not.is.null,expires_at.lte.${now.toISOString()}`)
      .order("posted_at", { ascending: false })
      .limit(50);
    ended = ((data ?? []) as Notice[]).map((n) => ({ ...n, unread: false, toAcknowledge: false }));
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <BackLink />
      <div className="mt-1 flex items-center gap-3">
        <h1 className="min-w-0 flex-1 text-3xl font-bold">Notices</h1>
        {manager && (
          <Link
            href="/notices/new"
            className="inline-flex min-h-12 shrink-0 items-center rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark"
          >
            New notice
          </Link>
        )}
      </div>

      <div className="mt-4">
        {rows.length === 0 ? (
          <p className="rounded-[14px] border border-line bg-white p-4 text-[15px] text-muted">No notices right now.</p>
        ) : (
          <NoticeList rows={rows} now={now} />
        )}
      </div>

      {ended.length > 0 && (
        <details className="mt-6">
          <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold text-primary">
            Expired and archived ({ended.length}
            {ended.length === 50 ? "+" : ""})
          </summary>
          <div className="mt-2">
            <NoticeList rows={ended} now={now} />
          </div>
        </details>
      )}
    </main>
  );
}
