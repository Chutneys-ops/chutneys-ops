// Shown while app/sites/page.tsx waits for Supabase.
// It also acts as the <Suspense> boundary that cacheComponents requires
// before a page can read cookies().
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <p className="text-zinc-600 dark:text-zinc-400">Loading sites…</p>
    </main>
  );
}
