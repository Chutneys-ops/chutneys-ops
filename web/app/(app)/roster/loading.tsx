// Skeleton for /roster while the week loads.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6" aria-busy="true">
      <h1 className="text-3xl font-bold">Roster</h1>
      <p className="sr-only" role="status">
        Loading the roster…
      </p>
      <div className="mt-4 h-32 animate-pulse rounded-[14px] border border-line bg-white" />
      <div className="mt-6 h-6 w-32 animate-pulse rounded bg-line" />
      <div className="mt-3 h-48 animate-pulse rounded-[14px] border border-line bg-white" />
    </main>
  );
}
