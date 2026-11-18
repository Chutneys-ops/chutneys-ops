// Shown while app/sites/[siteId]/page.tsx waits for Supabase.
// Next wraps the page in <Suspense> with this as the fallback, so tapping a
// site shows this skeleton straight away instead of a frozen screen.
// The shapes match the real page (back link, title, counter, rows, submit bar)
// so nothing jumps around when the data arrives.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-md p-4 pb-28" aria-busy="true">
      <p className="py-2 text-sm text-gray-400">← All sites</p>

      <div className="mt-2 h-7 w-2/3 animate-pulse rounded bg-gray-200" />
      <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-gray-200" />

      <p className="mt-3 font-medium text-gray-500" role="status">
        Loading checklist…
      </p>

      <ul className="mt-3 space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="h-14 animate-pulse rounded-lg border bg-gray-100" />
        ))}
      </ul>

      <div className="fixed inset-x-0 bottom-0 border-t bg-white p-4">
        <div className="mx-auto max-w-md">
          <div className="min-h-12 w-full rounded-lg bg-gray-200" />
        </div>
      </div>
    </main>
  );
}
