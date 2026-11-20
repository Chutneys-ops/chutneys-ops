// Small labels on a notice: "Pinned", "Please acknowledge", "New", ...
// A plain component (no hooks), so server pages and the client form share it.

const tag = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold";

export function NoticeTags({
  pinned = false,
  needsAck = false,
  unread = false,
  toAcknowledge = false,
  ended,
}: {
  pinned?: boolean;
  /** The notice asks for acknowledgement (shown when you've done it, or for managers). */
  needsAck?: boolean;
  unread?: boolean;
  /** You still need to acknowledge it. */
  toAcknowledge?: boolean;
  /** "Archived" or "Expired" */
  ended?: string;
}) {
  if (!pinned && !needsAck && !unread && !toAcknowledge && !ended) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {unread && <span className={`${tag} bg-primary text-white`}>New</span>}
      {pinned && <span className={`${tag} bg-primary-light text-primary-dark`}>Pinned</span>}
      {toAcknowledge ? (
        <span className={`${tag} bg-warning-light text-warning`}>Please acknowledge</span>
      ) : (
        needsAck && <span className={`${tag} bg-cream text-muted`}>Needs acknowledgement</span>
      )}
      {ended && <span className={`${tag} bg-line text-ink`}>{ended}</span>}
    </span>
  );
}
