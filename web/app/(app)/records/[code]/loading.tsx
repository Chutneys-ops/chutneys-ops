// Skeleton for one record sheet while Supabase loads.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-8" aria-busy="true">
      <p className="flex min-h-12 items-center text-sm font-medium text-muted">‹ All records</p>
      <div className="mt-1 h-4 w-36 animate-pulse rounded bg-line" />
      <div className="mt-2 h-7 w-2/3 animate-pulse rounded bg-line" />
      <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-line" />
      <p className="mt-5 text-[13px] font-medium text-muted" role="status">
        Loading entries…
      </p>
      <div className="mt-2.5 h-24 animate-pulse rounded-[14px] border border-line bg-white" />
      <div className="mt-5 h-64 animate-pulse rounded-[14px] border border-line bg-white" />
    </main>
  );
}
