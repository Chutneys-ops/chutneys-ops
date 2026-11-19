// Stands in for a thumbnail when an invoice is a PDF.
export function PdfIcon() {
  return (
    <span className="flex h-20 w-16 shrink-0 flex-col items-center justify-center rounded-lg border border-line bg-cream text-xs font-bold text-warning">
      <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
        <path d="M14 3v4h4" />
      </svg>
      PDF
    </span>
  );
}
