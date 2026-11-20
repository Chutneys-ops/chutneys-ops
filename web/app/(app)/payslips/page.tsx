import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { PdfIcon } from "@/components/pdf-icon";
import { aucklandShortDay } from "@/lib/dates";
import { shortYmd } from "@/lib/leave";
import { periodLabel } from "@/lib/payslips";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";

type Row = { id: string; pay_date: string; period_start: string; period_end: string; viewed_at: string | null };

// More > My payslips: your own published payslips, newest pay date first.
// RLS only returns your own published ones (the owner sees everyone's, so
// the staff_id filter keeps this page to your own for the owner too).
export default async function MyPayslipsPage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;

  const { data, error } = await supabase
    .from("payslips")
    .select("id, pay_date, period_start, period_end, viewed_at")
    .eq("staff_id", userId)
    .not("published_at", "is", null)
    .is("withdrawn_at", null)
    .order("pay_date", { ascending: false })
    .order("period_start", { ascending: false });
  const payslips = (data ?? []) as Row[];

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6">
      <BackLink />
      <h1 className="text-3xl font-bold">My payslips</h1>
      <p className="mt-1 text-sm text-muted">Only you can see these. Each opens as a PDF.</p>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-warning-light px-3 py-2 text-sm font-medium text-warning">
          Could not load your payslips: {error.message}
        </p>
      )}
      {!error && payslips.length === 0 && (
        <p className="mt-6 rounded-[14px] border border-line bg-white px-4 py-5 text-sm text-muted">
          No payslips yet. When the owner publishes yours, it shows here
          {" "}and you get a notification if they&apos;re on (Settings).
        </p>
      )}

      <ul className="mt-5 divide-y divide-line rounded-[14px] border border-line bg-white empty:hidden">
        {payslips.map((p) => (
          <li key={p.id}>
            <a
              href={`/payslips/${p.id}/file`}
              target="_blank"
              rel="noopener"
              className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-cream"
            >
              <span className="scale-75">
                <PdfIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-ink">
                  {periodLabel(p.period_start, p.period_end)}
                </span>
                <span className="block text-sm text-muted">
                  Paid {shortYmd(p.pay_date)}
                  {p.viewed_at ? ` · Opened ${aucklandShortDay(p.viewed_at)}` : ""}
                </span>
              </span>
              {!p.viewed_at && (
                <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-white">New</span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
