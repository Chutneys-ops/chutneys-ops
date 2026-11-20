import Link from "next/link";

/** "‹ More" at the top of a sub-page. */
export function BackLink({ href = "/more", label = "More" }: { href?: string; label?: string }) {
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex min-h-12 items-center gap-1 text-sm font-medium text-primary hover:text-primary-dark"
    >
      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 6l-6 6 6 6" />
      </svg>
      {label}
    </Link>
  );
}
