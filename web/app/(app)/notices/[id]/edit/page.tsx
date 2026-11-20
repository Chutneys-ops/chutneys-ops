import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { aucklandDate } from "@/lib/dates";
import { expiryDate, type Notice } from "@/lib/notices";
import { NOTICE_COLUMNS } from "@/lib/supabase/notices";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";
import { saveNotice } from "../../actions";
import { NoticeForm } from "../../notice-form";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Edit notice": managers and the owner. Saving stamps "edited" (the
// database does it). Archived notices can't be edited, and once anyone has
// acknowledged a notice its title and body are locked (also the database).
export default async function EditNoticePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  if (!isManager(me)) redirect(`/notices/${id}`);

  const [{ data }, { data: sites }, { count: acknowledgements }] = await Promise.all([
    supabase.from("notices").select(NOTICE_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("sites").select("id, name").eq("active", true).order("name"),
    // Managers see every read. Any acknowledgement locks the wording.
    supabase
      .from("notice_reads")
      .select("notice_id", { count: "exact", head: true })
      .eq("notice_id", id)
      .not("acknowledged_at", "is", null),
  ]);
  const notice = data as Notice | null;
  if (!notice) notFound();
  if (notice.archived_at) redirect(`/notices/${id}`);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <BackLink href={`/notices/${id}`} label="Notice" />
      <h1 className="mt-1 text-3xl font-bold">Edit notice</h1>
      <div className="mt-4">
        <NoticeForm
          action={saveNotice}
          sites={(sites ?? []) as { id: string; name: string }[]}
          today={aucklandDate()}
          noticeId={id}
          wordingLocked={(acknowledgements ?? 0) > 0}
          initial={{
            title: notice.title,
            body: notice.body,
            audience: notice.site_ids ? "sites" : "everyone",
            site_ids: notice.site_ids ?? [],
            pinned: notice.pinned,
            needs_ack: notice.needs_ack,
            expires_on: notice.expires_at ? expiryDate(notice.expires_at) : "",
          }}
        />
      </div>
    </main>
  );
}
