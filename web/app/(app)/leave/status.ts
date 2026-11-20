import type { LeaveStatus } from "@/lib/leave";

// Pill colours for a leave request's status. The text always says the
// status too, so colour is never the only signal.
export const statusClass: Record<LeaveStatus, string> = {
  pending: "bg-warning-light text-warning",
  approved: "bg-primary-light text-primary-dark",
  declined: "bg-stone-100 text-stone-700",
};
