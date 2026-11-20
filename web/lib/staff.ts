// Staff accounts (More > Staff, owner only): roles, statuses and the
// invite form check. Pure functions, so they run under `node --test`.

export const ROLES = ["staff", "manager", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  staff: "Staff",
  manager: "Manager",
  owner: "Owner",
};

export const ROLE_HINTS: Record<Role, string> = {
  staff: "Records and hours at the site they choose",
  manager: "Also signs off records, approves hours and leave",
  owner: "Everything, including money and staff accounts",
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * active:      has set a password and the account is on
 * invited:     invited, but hasn't used the link to set a password yet
 * deactivated: turned off (a leaver); can't sign in or see anything
 */
export type StaffStatus = "active" | "invited" | "deactivated";

export const STATUS_LABELS: Record<StaffStatus, string> = {
  active: "Active",
  invited: "Invited, not joined yet",
  deactivated: "Turned off",
};

/** joined comes from staff_logins(): true once they have a password. */
export function staffStatus(active: boolean, joined: boolean): StaffStatus {
  if (!active) return "deactivated";
  return joined ? "active" : "invited";
}

const STATUS_ORDER: Record<StaffStatus, number> = { active: 0, invited: 1, deactivated: 2 };

/** Active people first, then invited, then turned off; by name in each group. */
export function sortByStatusThenName<T extends { name: string; status: StaffStatus }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name),
  );
}

export const NAME_MAX = 100;
export const EMAIL_MAX = 254;

/** "  Ana@Example.COM " -> "ana@example.com" (staff.email is stored like this). */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** A light check: something@something.something, no spaces. The invite
 *  email itself is the real test. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export type InviteInput = { name: string; email: string; role: Role };

export function checkInvite(form: {
  name: string;
  email: string;
  role: string;
}): { ok: true; value: InviteInput } | { ok: false; error: string } {
  const name = form.name.trim().replace(/\s+/g, " ");
  const email = normaliseEmail(form.email);
  if (!name) return { ok: false, error: "Enter their name." };
  if (name.length > NAME_MAX) return { ok: false, error: `Keep the name under ${NAME_MAX} characters.` };
  if (!email) return { ok: false, error: "Enter their email address." };
  if (email.length > EMAIL_MAX || !looksLikeEmail(email)) {
    return { ok: false, error: "That email address doesn't look right." };
  }
  if (!isRole(form.role)) return { ok: false, error: "Choose a role." };
  return { ok: true, value: { name, email, role: form.role } };
}
