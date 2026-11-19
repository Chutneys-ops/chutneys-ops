// Skeleton for the records list while Supabase loads.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6" aria-busy="true">
      <p className="flex min-h-12 items-center text-sm font-medium text-muted">‹ Opening checklist</p>
      <div className="mt-1 h-4 w-36 animate-pulse rounded bg-line" />
      <div className="mt-2 h-7 w-2/3 animate-pulse rounded bg-line" />
      <p className="mt-4 text-[13px] font-medium text-muted" role="status">
        Loading records…
      </p>
      <ul className="mt-2.5 space-y-2.5">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex min-h-16 items-center rounded-[14px] border border-line bg-white px-4">
            <div className="h-4 w-1/2 animate-pulse rounded bg-line" />
          </li>
        ))}
      </ul>
    </main>
  );
}
