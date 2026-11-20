"use client";

// Client pieces of the notice page:
//   - MarkRead: marks the notice read once the page is really open. Done
//     from the browser (not while rendering on the server), so Next.js
//     prefetching the page in the background can't mark it read.
//   - AcknowledgeButton: "I've read and understood this".
//   - ArchiveButton: managers and owner, with a confirm step.

import { useEffect, useRef, useState, useTransition } from "react";
import { acknowledgeNotice, archiveNotice, markNoticeRead } from "./actions";

export function MarkRead({ noticeId }: { noticeId: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return; // React may run effects twice in development
    sent.current = true;
    void markNoticeRead(noticeId);
  }, [noticeId]);
  return null;
}

export function AcknowledgeButton({ noticeId }: { noticeId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await acknowledgeNotice(noticeId);
            setMessage(result.ok ? null : (result.message ?? "Could not save. Try again."));
          })
        }
        className="min-h-[50px] w-full rounded-xl bg-primary px-4 text-base font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Saving…" : "I've read and understood this"}
      </button>
      {message && (
        <p role="alert" className="mt-2 rounded-xl bg-warning-light p-3 text-sm font-medium text-warning">
          {message}
        </p>
      )}
    </div>
  );
}

export function ArchiveButton({ noticeId }: { noticeId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-12 flex-1 rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted"
      >
        Archive
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-warning bg-warning-light p-3">
      <p className="text-sm font-medium text-ink">
        Archive this notice? Staff won&apos;t see it any more. This can&apos;t be undone.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              // On success the action redirects to /notices.
              const result = await archiveNotice(noticeId);
              if (!result.ok) setMessage(result.message ?? "Could not archive. Try again.");
            })
          }
          className="min-h-12 flex-1 rounded-xl bg-warning px-4 font-semibold text-white disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? "Archiving…" : "Yes, archive"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="min-h-12 flex-1 rounded-xl border border-line bg-white px-4 font-semibold text-ink"
        >
          Cancel
        </button>
      </div>
      {message && (
        <p role="alert" className="mt-2 text-sm font-medium text-warning">
          {message}
        </p>
      )}
    </div>
  );
}
