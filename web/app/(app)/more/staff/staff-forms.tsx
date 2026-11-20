"use client";

import { useActionState, useState } from "react";
import { ChoiceOption } from "@/components/choice-option";
import { FormMessage } from "@/components/password-field";
import { ROLE_HINTS, ROLE_LABELS, ROLES, type Role, type StaffStatus } from "@/lib/staff";
import {
  changeRole,
  inviteStaff,
  resendInvite,
  setActive,
  type InviteState,
  type StaffActionState,
} from "./actions";

const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border border-muted bg-white px-3 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";
const primaryButton =
  "min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70";
const secondaryButton =
  "min-h-12 w-full rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted disabled:cursor-wait disabled:opacity-70";
const dangerButton =
  "min-h-12 w-full rounded-xl border border-warning/40 bg-warning-light px-4 font-semibold text-warning hover:border-warning disabled:cursor-wait disabled:opacity-70";

// ---- Invite staff ---------------------------------------------------------------------

const inviteInitial: InviteState = { seq: 0, done: 0 };

export function InviteForm() {
  const [state, formAction, pending] = useActionState(inviteStaff, inviteInitial);
  return (
    <>
      {/* key: the boxes empty after a successful invite, but keep what you
          typed when something needs fixing. */}
      <form key={state.done} action={formAction} className="space-y-4">
        <div>
          <label htmlFor="invite-name" className="block text-sm font-semibold text-ink">
            Name
          </label>
          <input id="invite-name" name="name" required maxLength={100} autoComplete="off" className={inputClass} />
        </div>
        <div>
          <label htmlFor="invite-email" className="block text-sm font-semibold text-ink">
            Email
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className={inputClass}
          />
        </div>
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Role</legend>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {ROLES.map((role) => (
              <ChoiceOption key={role} name="role" value={role} defaultChecked={role === "staff"} required>
                {ROLE_LABELS[role]}
              </ChoiceOption>
            ))}
          </div>
          <ul className="mt-2 space-y-0.5 text-sm text-muted">
            {ROLES.map((role) => (
              <li key={role}>
                <span className="font-semibold">{ROLE_LABELS[role]}:</span> {ROLE_HINTS[role]}
              </li>
            ))}
          </ul>
        </fieldset>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Sending invite…" : "Send invite"}
        </button>
      </form>
      <div className="mt-4 empty:hidden">
        <FormMessage ok={state.ok} message={state.message} />
      </div>
    </>
  );
}

// ---- One person ---------------------------------------------------------------------------

const initial: StaffActionState = { seq: 0 };

type Person = { id: string; name: string; role: Role; status: StaffStatus };

export function StaffActions({ person }: { person: Person }) {
  const [roleState, roleAction, rolePending] = useActionState(changeRole, initial);
  const [activeState, activeAction, activePending] = useActionState(setActive, initial);
  const [inviteState, inviteAction, invitePending] = useActionState(resendInvite, initial);
  // Turning off needs a second tap, so it can't happen by accident.
  const [confirming, setConfirming] = useState(false);
  const isOff = person.status === "deactivated";

  return (
    <div className="space-y-5">
      {!isOff && (
        <form action={roleAction} className="space-y-2">
          <input type="hidden" name="staffId" value={person.id} />
          <label htmlFor={`role-${person.id}`} className="block text-sm font-semibold text-ink">
            Role
          </label>
          <div className="flex gap-2">
            {/* key: after a change the select shows the saved role. */}
            <select
              key={person.role}
              id={`role-${person.id}`}
              name="role"
              defaultValue={person.role}
              className="min-h-12 flex-1 rounded-xl border border-muted bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            <button type="submit" disabled={rolePending} className={`${secondaryButton} w-auto shrink-0`}>
              {rolePending ? "Saving…" : "Change role"}
            </button>
          </div>
          <FormMessage ok={roleState.ok} message={roleState.message} />
        </form>
      )}

      {person.status === "invited" && (
        <form action={inviteAction} className="space-y-2">
          <input type="hidden" name="staffId" value={person.id} />
          <button type="submit" disabled={invitePending} className={secondaryButton}>
            {invitePending ? "Sending…" : "Resend invite"}
          </button>
          <FormMessage ok={inviteState.ok} message={inviteState.message} />
        </form>
      )}

      <div className="space-y-2">
        {isOff ? (
          <form action={activeAction}>
            <input type="hidden" name="staffId" value={person.id} />
            <input type="hidden" name="active" value="true" />
            <button type="submit" disabled={activePending} className={secondaryButton}>
              {activePending ? "Turning on…" : "Turn account back on"}
            </button>
          </form>
        ) : confirming ? (
          <form
            action={(formData) => {
              setConfirming(false);
              activeAction(formData);
            }}
            className="space-y-3 rounded-xl border border-warning/30 bg-warning-light p-3"
          >
            <input type="hidden" name="staffId" value={person.id} />
            <input type="hidden" name="active" value="false" />
            <p className="text-sm text-ink">
              <span className="font-semibold">Turn off {person.name}&apos;s account?</span> They&apos;ll be signed
              out at once and can&apos;t sign in or see anything. Their records, hours and leave stay. You can turn
              it back on later.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirming(false)} className={secondaryButton}>
                Cancel
              </button>
              <button type="submit" className={dangerButton}>
                Yes, turn off
              </button>
            </div>
          </form>
        ) : (
          <button type="button" disabled={activePending} onClick={() => setConfirming(true)} className={dangerButton}>
            {activePending ? "Turning off…" : "Turn off account"}
          </button>
        )}
        <FormMessage ok={activeState.ok} message={activeState.message} />
      </div>
    </div>
  );
}
