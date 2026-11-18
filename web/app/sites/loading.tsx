// Shown while app/sites/page.tsx waits for Supabase.
// It also acts as the <Suspense> boundary that cacheComponents requires
// before a page can read cookies().
// The shapes match the real page (date, title, site cards) so nothing jumps
// around when the data arrives.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6" aria-busy="true">
      <div className="h-4 w-40 animate-pulse rounded bg-line" />
      <h1 className="mt-1 text-3xl font-bold">Sites</h1>
      <p className="mt-4 text-[13px] font-semibold text-muted" role="status">
        Loading sites…
      </p>

      <ul className="mt-2.5 space-y-2.5">
        {Array.from({ length: 6 }, (_, i) => (
          <li
            key={i}
            className="flex min-h-16 items-center gap-3 rounded-[14px] border border-line bg-white px-4 py-3.5"
          >
            <div className="flex flex-1 flex-col gap-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-line" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-line" />
            </div>
            <div className="h-6 w-20 animate-pulse rounded-full bg-line" />
          </li>
        ))}
      </ul>
    </main>
  );
}
