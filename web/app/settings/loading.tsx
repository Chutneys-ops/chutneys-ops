// Shown while the settings page checks who you are. It also gives the page
// the <Suspense> boundary Cache Components needs for a page that reads cookies.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6" aria-busy="true">
      <h1 className="text-3xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-muted" role="status">
        Loading…
      </p>
      <div className="mt-5 h-56 animate-pulse rounded-[14px] border border-line bg-white" />
    </main>
  );
}
