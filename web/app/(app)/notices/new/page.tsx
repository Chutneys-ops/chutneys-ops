import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { aucklandDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";
import { saveNotice } from "../actions";
import { NoticeForm } from "../notice-form";

// "New notice": managers and the owner. (The database refuses anyone else.)
export default async function NewNoticePage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  if (!isManager(me)) redirect("/notices");

  const { data: sites } = await supabase.from("sites").select("id, name").eq("active", true).order("name");

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <BackLink href="/notices" label="Notices" />
      <h1 className="mt-1 text-3xl font-bold">New notice</h1>
      <div className="mt-4">
        <NoticeForm action={saveNotice} sites={(sites ?? []) as { id: string; name: string }[]} today={aucklandDate()} />
      </div>
    </main>
  );
}
