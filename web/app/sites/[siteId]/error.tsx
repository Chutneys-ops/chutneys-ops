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
    <main className="mx-auto w-full max-w-md p-4">
      <h1 className="text-xl font-bold">That didn&apos;t save</h1>
      <p className="mt-2 text-gray-700">Check your connection and try again.</p>
      {message && <p className="mt-2 text-sm text-gray-500">{message}</p>}
      <button
        onClick={() => retry()}
        className="mt-4 min-h-12 w-full rounded-lg bg-green-700 px-4 py-3 font-semibold text-white"
      >
        Try again
      </button>
      <Link href="/sites" className="mt-4 inline-block py-2 underline">
        Back to all sites
      </Link>
    </main>
  );
}
