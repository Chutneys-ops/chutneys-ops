"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { useEffect } from "react";

export default function ChecklistError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // In development you see the real message. In production Next hides
  // server error messages (they could leak details) and sends a generic one.
  const message = error instanceof Error ? error.message : null;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div role="alert" className="rounded-[14px] border border-warning/30 bg-warning-light p-4">
        <h1 className="text-xl font-bold text-warning">That didn&apos;t save</h1>
        <p className="mt-1 text-ink">Check your connection and try again.</p>
        {message && <p className="mt-2 text-sm break-words text-muted">{message}</p>}
      </div>
      <button
        onClick={() => retry()}
        className="mt-4 min-h-[50px] w-full rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark"
      >
        Try again
      </button>
      <Link
        href="/sites"
        className="mt-2 flex min-h-11 items-center justify-center text-sm font-medium text-primary hover:text-primary-dark"
      >
        Back to all sites
      </Link>
    </main>
  );
}
