import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { logout } from "@/app/login/actions";
import { NotStaff } from "@/components/not-staff";
import { loadMyInbox } from "@/lib/supabase/notices";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";

// The "More" tab: a menu. Managers and the owner get extra items; the
// pages themselves check the role again (and the database checks it too).

/** badge: a count shown in a green circle (hidden when 0). */
type Item = { href: string; label: string; hint: string; badge?: number; badgeLabel?: string };

function Menu({ title, items }: { title?: string; items: Item[] }) {
  return (
    <section className="mt-5">
      {title && <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">{title}</h2>}
      <ul className="divide-y divide-line rounded-[14px] border border-line bg-white">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="flex min-h-14 items-center gap-3 px-4 py-3 text-ink hover:bg-cream">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-ink">{item.label}</span>
                <span className="block text-sm text-muted">{item.hint}</span>
              </span>
              {item.badge ? (
                <span
                  aria-label={item.badgeLabel}
                  className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary px-2 text-xs font-bold text-white"
                >
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null}
              <svg aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function MorePage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;

  // Notices waiting on you: unread, or read but not acknowledged yet.
  const { counts } = await loadMyInbox(supabase, userId);

  const mine: Item[] = [
    {
      href: "/notices",
      label: "Notices",
      hint: isManager(me) ? "Announcements: read, post and see who has read them" : "Announcements from your managers",
      badge: counts.waiting,
      badgeLabel: `${counts.waiting} ${counts.waiting === 1 ? "notice needs" : "notices need"} your attention`,
    },
    { href: "/leave", label: "Leave", hint: "Request sick leave and see your requests" },
    { href: "/training", label: "Training", hint: "Your training records" },
    { href: "/settings", label: "Settings", hint: isManager(me) ? "Your password and sign-off PIN" : "Your password" },
  ];
  const managing: Item[] = [
    { href: "/leave/requests", label: "Leave requests", hint: "Approve or decline sick leave" },
    { href: "/leave/sickness", label: "Staff sickness", hint: "Food safety record, clear to return" },
    { href: "/training/matrix", label: "Training matrix", hint: "Who is trained in what" },
  ];
  if (me.role === "owner") {
    managing.unshift({ href: "/more/staff", label: "Staff", hint: "Invite people, change roles, turn off leavers" });
    managing.push({ href: "/more/export", label: "Export hours and leave", hint: "CSV for payroll" });
    managing.push({ href: "/more/audit", label: "Audit log", hint: "Who changed what, and when" });
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-3xl font-bold">More</h1>
      <p className="mt-1 text-sm text-muted">
        Signed in as {me.name} <span className="capitalize">({me.role})</span>
      </p>

      <Menu items={mine} />
      {isManager(me) && <Menu title="Managing" items={managing} />}

      <form action={logout} className="mt-5">
        <button
          type="submit"
          className="min-h-12 w-full rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
