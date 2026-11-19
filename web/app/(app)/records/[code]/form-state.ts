// Shared between the server actions and the client forms. It lives in its
// own file because a "use server" file may only export async functions.

/** What a server action hands back to useActionState. */
export type FormState = {
  /** Goes up on every submit. The form uses it as a React key, so it remounts
   *  fresh after a save, or with the typed values after an error. */
  seq: number;
  ok?: boolean;
  message?: string;
  /** Field key -> message. "_form" is for errors not tied to one field. */
  errors?: Record<string, string>;
  /** What was typed, so nothing is lost when the server says no. */
  values?: Record<string, string>;
  /** Sign-off only: when the PIN lock ends (ISO time), so the button can
   *  stay disabled and count down the minutes left. */
  lockedUntil?: string;
  /** Minutes left when the server answered, shown until the first tick. */
  lockedMinutes?: number;
};

export const initialFormState: FormState = { seq: 0 };

/** Which kind of entry the form creates. The ids come from the page, so the
 *  action treats them as untrusted: RLS and the trigger check them. */
export type EntryTarget =
  | { kind: "new" }
  | { kind: "followup"; sheetId: string; entryId: string }
  | { kind: "correction"; sheetId: string };
