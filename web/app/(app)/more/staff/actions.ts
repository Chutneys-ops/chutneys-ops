"use server";

// More > Staff (owner only): invite, resend invite, change role, turn an
// account off or back on.
//
// Every action does the same two steps, in this order:
//   1. ownerSession(): with the CALLER'S OWN session (publishable key +
//      their cookies, so RLS applies), check they are an active owner.
//      Nothing else happens if they aren't.
//   2. Only then use the admin client (SECRET key) for the Auth admin API:
//      sending invites and banning logins. Database changes still go through
//      the owner's own session (set_staff_role, set_staff_active, the staff
//      insert policy), so the database checks "is owner" a second time.

import { refresh } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { requestOrigin } from "@/lib/request-origin";
import { checkInvite, isRole, ROLE_LABELS } from "@/lib/staff";

export type StaffActionState = { seq: number; ok?: boolean; message?: string };
/** done counts successful invites, so the form empties only after one. */
export type InviteState = StaffActionState & { done: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Supabase Auth has no "ban forever": 100 years will do. "none" lifts it.
const BAN_FOREVER = "876000h";

type DbError = { code?: string; message: string };

async function ownerSession() {
  const supabase = await createClient();
  const { me } = await getSession(supabase);
  if (!me || me.role !== "owner" || !me.active) return null;
  return supabase;
}

/** Our own database messages (no permission, can't lock yourself out, bad
 *  input) read well as they are; anything else gets a prefix. */
function dbMessage(error: DbError, prefix: string): string {
  return ["42501", "23514", "22023"].includes(error.code ?? "") ? error.message : `${prefix}: ${error.message}`;
}

async function personName(supabase: NonNullable<Awaited<ReturnType<typeof ownerSession>>>, id: string) {
  const { data } = await supabase.from("staff").select("name, email, active").eq("id", id).maybeSingle();
  return data as { name: string; email: string | null; active: boolean } | null;
}

// ---- Invite -----------------------------------------------------------------------

export async function inviteStaff(prev: InviteState, formData: FormData): Promise<InviteState> {
  const seq = prev.seq + 1;
  const supabase = await ownerSession();
  if (!supabase) return { ...prev, seq, ok: false, message: "Only the owner can invite staff." };

  const checked = checkInvite({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? ""),
  });
  if (!checked.ok) return { ...prev, seq, ok: false, message: checked.error };
  const { name, email, role } = checked.value;

  const { data: existing } = await supabase.from("staff").select("name").eq("email", email).maybeSingle();
  if (existing) return { ...prev, seq, ok: false, message: `${existing.name} is already on the list with ${email}.` };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${await requestOrigin()}/auth/confirm`,
    data: { name }, // the email template says "Kia ora {name}"
  });
  if (error || !data.user) {
    const message =
      error?.code === "email_exists"
        ? "That email already has a login but isn't on the staff list. Check Authentication in Supabase Studio."
        : `Could not send the invite: ${error?.message ?? "no user returned"}`;
    return { ...prev, seq, ok: false, message };
  }

  // The staff row, added with the owner's own session ("owner adds staff").
  const { error: insertError } = await supabase.from("staff").insert({ id: data.user.id, name, email, role });
  if (insertError) {
    // Undo the login, so trying again starts clean.
    await admin.auth.admin.deleteUser(data.user.id);
    return { ...prev, seq, ok: false, message: dbMessage(insertError, "Could not add them") };
  }

  refresh();
  return {
    seq,
    done: prev.done + 1,
    ok: true,
    message: `Invite sent to ${email}. The link works for 1 hour; use Resend invite if it runs out.`,
  };
}

export async function resendInvite(prev: StaffActionState, formData: FormData): Promise<StaffActionState> {
  const seq = prev.seq + 1;
  const supabase = await ownerSession();
  if (!supabase) return { seq, message: "Only the owner can invite staff." };

  const id = String(formData.get("staffId") ?? "");
  if (!UUID_RE.test(id)) return { seq, message: "Staff member not found." };
  const person = await personName(supabase, id);
  if (!person?.email) return { seq, message: "Staff member not found, or they have no email." };
  if (!person.active) return { seq, message: `Turn ${person.name}'s account back on first.` };

  const { data: logins } = await supabase.rpc("staff_logins");
  const login = (logins as { staff_id: string; joined: boolean }[] | null)?.find((l) => l.staff_id === id);
  if (login?.joined) {
    return { seq, message: `${person.name} has already joined. They can use Forgot password on the sign-in page.` };
  }

  const admin = createAdminClient();
  const redirectTo = `${await requestOrigin()}/auth/confirm`;
  let { error } = await admin.auth.admin.inviteUserByEmail(person.email, { redirectTo, data: { name: person.name } });
  // They opened the first link but never saved a password: Auth won't send
  // a second invite, so send a "choose a password" (reset) link instead.
  if (error?.code === "email_exists") {
    ({ error } = await admin.auth.resetPasswordForEmail(person.email, { redirectTo }));
  }
  if (error) return { seq, message: `Could not send the invite: ${error.message}` };

  const { error: noteError } = await supabase.rpc("note_invite_sent", { target_id: id });
  if (noteError) return { seq, ok: true, message: `Invite sent, but the date wasn't saved: ${noteError.message}` };

  refresh();
  return { seq, ok: true, message: `New invite sent to ${person.email}.` };
}

// ---- Role ---------------------------------------------------------------------------

export async function changeRole(prev: StaffActionState, formData: FormData): Promise<StaffActionState> {
  const seq = prev.seq + 1;
  const supabase = await ownerSession();
  if (!supabase) return { seq, message: "Only the owner can change roles." };

  const id = String(formData.get("staffId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!UUID_RE.test(id)) return { seq, message: "Staff member not found." };
  if (!isRole(role)) return { seq, message: "Choose staff, manager or owner." };

  const { error } = await supabase.rpc("set_staff_role", { target_id: id, new_role: role });
  if (error) return { seq, message: dbMessage(error, "Could not change the role") };

  const person = await personName(supabase, id);
  refresh();
  const whose = person ? `${person.name}'s` : "Their";
  return { seq, ok: true, message: `${whose} role is now ${ROLE_LABELS[role]}.` };
}

// ---- Turn off / back on -------------------------------------------------------------------

export async function setActive(prev: StaffActionState, formData: FormData): Promise<StaffActionState> {
  const seq = prev.seq + 1;
  const supabase = await ownerSession();
  if (!supabase) return { seq, message: "Only the owner can turn accounts on or off." };

  const id = String(formData.get("staffId") ?? "");
  const makeActive = formData.get("active") === "true";
  if (!UUID_RE.test(id)) return { seq, message: "Staff member not found." };

  // 1. The database: blocks everything for them at once, and deletes their
  //    sessions (signed out everywhere). Refuses to turn off yourself.
  const { error } = await supabase.rpc("set_staff_active", { target_id: id, make_active: makeActive });
  if (error) return { seq, message: dbMessage(error, "Could not change the account") };

  // 2. Auth: a ban stops them signing in again (lifted when turned back on).
  const admin = createAdminClient();
  const { error: banError } = await admin.auth.admin.updateUserById(id, {
    ban_duration: makeActive ? "none" : BAN_FOREVER,
  });

  const person = await personName(supabase, id);
  const name = person?.name ?? "This person";
  refresh();
  if (banError) {
    return {
      seq,
      message: makeActive
        ? `${name} is back on in the app, but their sign-in is still blocked: ${banError.message}. Try again.`
        : `${name} is turned off and can't see anything, but blocking their sign-in failed: ${banError.message}. Try again.`,
    };
  }
  return {
    seq,
    ok: true,
    message: makeActive
      ? `${name} can sign in again.`
      : `${name} is turned off and signed out. Their records stay.`,
  };
}
