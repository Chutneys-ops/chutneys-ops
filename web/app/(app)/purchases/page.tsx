import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NotStaff } from "@/components/not-staff";
import { PdfIcon } from "@/components/pdf-icon";
import { aucklandShortDay, aucklandTime } from "@/lib/dates";
import {
  PAYMENT_LABELS,
  currentMonth,
  formatMoney,
  isMonth,
  monthLabel,
  monthRange,
  toCents,
  type PaymentMethod,
} from "@/lib/purchases";
import { createClient } from "@/lib/supabase/server";
import { getCurrentShift, getSession, isManager, type Me } from "@/lib/supabase/session";
import { markPaidBack } from "./actions";
import { AddPurchaseForm } from "./add-purchase-form";
import { MarkPaidForm } from "./mark-paid-form";

type PurchaseRow = {
  id: string;
  purchased_by: string;
  purchased_at: string;
  supplier: string;
  description: string;
  total_incl_gst: number | string;
  gst_amount: number | string;
  payment_method: PaymentMethod;
  invoice_path: string | null;
  no_receipt_reason: string | null;
  comments: string | null;
  reimbursed_at: string | null;
  site: { name: string } | null;
  buyer: { name: string } | null;
};

// purchases has two links to staff (purchased_by, reimbursed_by), so name
// the one we mean.
const SELECT =
  "id, purchased_by, purchased_at, supplier, description, total_incl_gst, gst_amount, payment_method, " +
  "invoice_path, no_receipt_reason, comments, reimbursed_at, site:sites(name), " +
  "buyer:staff!purchases_purchased_by_fkey(name)";

const SIGNED_URL_SECONDS = 600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Managers and owner: pick a site (or all) and a month. A plain GET form, so
 *  the choice lives in the URL and works with Back. */
function Filter({
  sites,
  site,
  month,
}: {
  sites: { id: string; name: string; active: boolean }[];
  site: string;
  month: string;
}) {
  return (
    <form method="get" className="mt-4 grid grid-cols-[1fr_auto] gap-2 rounded-[14px] border border-line bg-white p-3">
      <label className="col-span-2 text-[13px] font-semibold text-muted" htmlFor="filter-site">
        Viewing
      </label>
      <select
        id="filter-site"
        name="site"
        defaultValue={site}
        className="col-span-2 min-h-12 rounded-xl border border-line bg-white px-3 text-base text-ink"
      >
        <option value="">All sites</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.active ? "" : " (closed)"}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="filter-month">
        Month
      </label>
      <input
        id="filter-month"
        name="month"
        type="month"
        max={currentMonth()}
        defaultValue={month}
        className="min-h-12 rounded-xl border border-line bg-white px-3 text-base text-ink"
      />
      <button type="submit" className="min-h-12 rounded-xl bg-primary px-5 font-semibold text-white hover:bg-primary-dark">
        Show
      </button>
    </form>
  );
}

function Thumb({ purchase, url }: { purchase: PurchaseRow; url: string | undefined }) {
  if (!purchase.invoice_path) {
    return (
      <span className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-line bg-cream px-1 text-center text-[11px] text-muted">
        No receipt
      </span>
    );
  }
  return (
    <a
      href={`/purchases/invoice/${purchase.id}`}
      target="_blank"
      rel="noopener"
      className="shrink-0 rounded-lg focus:ring-2 focus:ring-primary/30 focus:outline-none"
      aria-label={`Open invoice from ${purchase.supplier}`}
    >
      {purchase.invoice_path.endsWith(".pdf") || !url ? (
        <PdfIcon />
      ) : (
        // A short-lived signed URL from private storage; next/image can't
        // optimise those, so a plain <img>.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" className="h-20 w-16 rounded-lg border border-line object-cover" />
      )}
    </a>
  );
}

function PurchaseItem({
  purchase,
  url,
  showBuyer,
  showSite,
}: {
  purchase: PurchaseRow;
  url: string | undefined;
  showBuyer: boolean;
  showSite: boolean;
}) {
  const ownMoney = purchase.payment_method === "own_money";
  return (
    <li className="flex gap-3 px-4 py-3">
      <Thumb purchase={purchase} url={url} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[15px] font-semibold text-ink">{purchase.supplier}</p>
          <p className="shrink-0 text-[15px] font-semibold text-ink">{formatMoney(toCents(purchase.total_incl_gst))}</p>
        </div>
        <p className="truncate text-sm text-muted">{purchase.description}</p>
        <p className="text-sm text-muted">
          {aucklandShortDay(purchase.purchased_at)}, {aucklandTime(purchase.purchased_at)} · GST {formatMoney(toCents(purchase.gst_amount))}
        </p>
        <p className="text-sm text-muted">
          {PAYMENT_LABELS[purchase.payment_method]}
          {showBuyer && purchase.buyer ? ` · ${purchase.buyer.name}` : ""}
          {showSite && purchase.site ? ` · ${purchase.site.name}` : ""}
        </p>
        {ownMoney && (
          <p
            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
              purchase.reimbursed_at ? "bg-primary-light text-primary-dark" : "bg-warning-light text-warning"
            }`}
          >
            {purchase.reimbursed_at ? "Paid back" : "Owed"}
          </p>
        )}
        {purchase.no_receipt_reason && (
          <p className="mt-1 text-sm text-ink">No receipt: {purchase.no_receipt_reason}</p>
        )}
        {purchase.comments && <p className="mt-1 text-sm text-ink">{purchase.comments}</p>}
      </div>
    </li>
  );
}

function OwedList({ owed, me }: { owed: PurchaseRow[]; me: Me }) {
  return (
    <section className="mt-6 rounded-[14px] border border-warning/40 bg-warning-light p-4">
      <h2 className="text-lg font-semibold text-warning">Owed to staff</h2>
      {owed.length === 0 ? (
        <p className="mt-1 text-sm text-ink">Nobody is owed money for purchases.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {owed.map((p) => {
            // mark_reimbursed refuses your own unless you're the owner.
            const canMark = p.purchased_by !== me.id || me.role === "owner";
            return (
              <li key={p.id} className="rounded-xl border border-line bg-white p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[15px] font-semibold text-ink">{p.buyer?.name ?? "Unknown"}</p>
                  <p className="text-[15px] font-semibold text-ink">{formatMoney(toCents(p.total_incl_gst))}</p>
                </div>
                <p className="text-sm text-muted">
                  {aucklandShortDay(p.purchased_at)}, {aucklandTime(p.purchased_at)} · {p.supplier}
                  {p.site ? ` · ${p.site.name}` : ""}
                </p>
                {canMark ? (
                  <MarkPaidForm action={markPaidBack.bind(null, p.id)} />
                ) : (
                  <p className="mt-2 text-sm text-muted">Your own purchase: another manager or the owner marks it.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;

  const params = await searchParams;
  const manager = isManager(me);
  const owner = me.role === "owner";
  const shift = await getCurrentShift(supabase, userId);

  const wantedMonth = first(params.month);
  const month = isMonth(wantedMonth) ? wantedMonth : currentMonth();
  const wantedSite = first(params.site) ?? "";
  const site = UUID_RE.test(wantedSite) ? wantedSite : "";

  // Staff: their latest purchases (RLS shows only their own anyway).
  // Managers and owner: the chosen month and site, plus everything owed.
  let listQuery = supabase.from("purchases").select(SELECT).order("purchased_at", { ascending: false });
  if (manager) {
    const { start, end } = monthRange(month);
    listQuery = listQuery.gte("purchased_at", start).lt("purchased_at", end).limit(500);
    if (site) listQuery = listQuery.eq("site_id", site);
  } else {
    listQuery = listQuery.eq("purchased_by", userId).limit(50);
  }

  const [listResult, owedResult, sitesResult] = await Promise.all([
    listQuery,
    manager
      ? supabase
          .from("purchases")
          .select(SELECT)
          .eq("payment_method", "own_money")
          .is("reimbursed_at", null)
          .order("purchased_at")
      : Promise.resolve({ data: [], error: null }),
    manager
      ? supabase.from("sites").select("id, name, active").order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const error = listResult.error ?? owedResult.error ?? sitesResult.error;
  const purchases = (listResult.data ?? []) as unknown as PurchaseRow[];
  const owed = (owedResult.data ?? []) as unknown as PurchaseRow[];
  const sites = (sitesResult.data ?? []) as { id: string; name: string; active: boolean }[];

  // Thumbnails: one batch of short-lived signed URLs for the photo invoices.
  const photoPaths = purchases.map((p) => p.invoice_path).filter((p): p is string => Boolean(p && !p.endsWith(".pdf")));
  const urls = new Map<string, string>();
  if (photoPaths.length > 0) {
    const { data } = await supabase.storage.from("invoices").createSignedUrls(photoPaths, SIGNED_URL_SECONDS);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
    }
  }

  const totalCents = purchases.reduce((sum, p) => sum + toCents(p.total_incl_gst), 0);
  const gstTotal = purchases.reduce((sum, p) => sum + toCents(p.gst_amount), 0);
  const exportHref = `/purchases/export?${new URLSearchParams(site ? { month, site } : { month }).toString()}`;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-3xl font-bold">Purchases</h1>
      <p className="mt-1 text-sm text-muted">Groceries and supplies, with the invoice for GST.</p>

      {manager && <Filter sites={sites} site={site} month={month} />}

      <section className="mt-4 rounded-[14px] border border-line bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold">Add purchase</h2>
        {shift ? (
          <AddPurchaseForm siteId={shift.site.id} siteName={shift.site.name} />
        ) : (
          <>
            <p className="text-[15px] text-ink">Choose a site to add a purchase.</p>
            <Link
              href="/start"
              className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark"
            >
              Choose site
            </Link>
          </>
        )}
      </section>

      {manager && <OwedList owed={owed} me={me} />}

      <section className="mt-6">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{manager ? monthLabel(month) : "Your purchases"}</h2>
          {owner && (
            <a href={exportHref} className="min-h-12 content-center text-sm font-semibold text-primary hover:text-primary-dark">
              Export month
            </a>
          )}
        </div>
        {manager && purchases.length > 0 && (
          <p className="text-sm text-muted">
            {purchases.length} {purchases.length === 1 ? "purchase" : "purchases"} · {formatMoney(totalCents)} · GST{" "}
            {formatMoney(gstTotal)}
          </p>
        )}

        {error ? (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 p-4 text-red-800">
            Could not load purchases: {error.message}
          </p>
        ) : purchases.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line bg-white p-4 text-muted">
            No purchases {manager ? "for this month" : "yet"}.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-[14px] border border-line bg-white">
            {purchases.map((p) => (
              <PurchaseItem
                key={p.id}
                purchase={p}
                url={p.invoice_path ? urls.get(p.invoice_path) : undefined}
                showBuyer={manager}
                showSite={manager && !site}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
