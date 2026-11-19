// Shown while app/sites/[siteId]/page.tsx waits for Supabase.
// Next wraps the page in <Suspense> with this as the fallback, so tapping a
// site shows this skeleton straight away instead of a frozen screen.
// The shapes match the real page (back link, title, counter, rows, submit bar)
// so nothing jumps around when the data arrives.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-32" aria-busy="true">
      <p className="flex min-h-11 items-center text-sm font-medium text-muted">‹ All sites</p>

      <div className="mt-1 h-4 w-36 animate-pulse rounded bg-line" />
      <div className="mt-2 h-7 w-2/3 animate-pulse rounded bg-line" />
      <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-line" />

      <p className="mt-4 text-[13px] font-medium text-muted" role="status">
        Loading checklist…
      </p>
      <div className="mt-2 h-2 rounded-full bg-line" />

      <ul className="mt-4 space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <li
            key={i}
            className="flex min-h-[52px] items-center gap-3 rounded-xl border border-line bg-white px-3"
          >
            <div className="h-[26px] w-[26px] shrink-0 rounded-lg border-2 border-line" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-line" />
          </li>
        ))}
      </ul>

      <div className="fixed inset-x-0 bottom-(--nav-h) z-10 border-t border-line bg-cream px-4 py-3">
        <div className="mx-auto max-w-md">
          <div className="min-h-[50px] w-full animate-pulse rounded-xl bg-line" />
        </div>
      </div>
    </main>
  );
}
