// Placeholder for a tab that isn't built yet. Not used right now (Purchases
// replaced it); kept for the next new section.
export function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-3xl font-bold">{title}</h1>
      <div className="mt-4 rounded-[14px] border border-dashed border-line bg-white p-5">
        <p className="font-semibold text-ink">Coming soon</p>
        <p className="mt-1 text-sm text-muted">{blurb}</p>
      </div>
    </main>
  );
}
