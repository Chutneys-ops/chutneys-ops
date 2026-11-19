// Skeleton for the site picker while sites load.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6" aria-busy="true">
      <div className="h-4 w-24 animate-pulse rounded bg-line" />
      <h1 className="mt-1 text-3xl font-bold">Where are you working today?</h1>
      <p className="mt-1 text-sm text-muted" role="status">
        Loading sites…
      </p>
      <ul className="mt-5 space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="flex min-h-20 items-center rounded-[14px] border border-line bg-white px-4">
            <div className="h-5 w-2/3 animate-pulse rounded bg-line" />
          </li>
        ))}
      </ul>
    </main>
  );
}
