// A plain loading skeleton for a page while Supabase loads. Each section's
// loading.tsx uses it; it also gives Next.js the <Suspense> boundary it needs
// to prerender the shell around per-request data.
export function PageSkeleton({ label }: { label: string }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded bg-line" />
      <p className="mt-4 text-[13px] font-medium text-muted" role="status">
        {label}
      </p>
      <ul className="mt-2.5 space-y-2.5">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="flex min-h-16 items-center rounded-[14px] border border-line bg-white px-4">
            <div className="h-4 w-1/2 animate-pulse rounded bg-line" />
          </li>
        ))}
      </ul>
    </main>
  );
}
