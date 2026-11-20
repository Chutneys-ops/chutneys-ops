// Password rules for /set-password and Settings > Change password.
// Pure functions (no React, no Supabase), so they run under `node --test`.
//
// Supabase Auth also refuses passwords shorter than 10 characters
// (minimum_password_length in supabase/config.toml), so the rule holds even
// if someone skips this page.

export const MIN_PASSWORD_LENGTH = 10;

/** What's wrong with a new password, or null if it's fine. */
export function newPasswordProblem(password: string, email: string | null | undefined): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return "Your password can't be your email address.";
  }
  return null;
}

/** /set-password: the rules above, plus both boxes must match. */
export function setPasswordProblem(password: string, confirm: string, email: string | null | undefined): string | null {
  const problem = newPasswordProblem(password, email);
  if (problem) return problem;
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}

/** Settings: the rules above, and the new one must differ from the current one. */
export function changePasswordProblem(current: string, next: string, email: string | null | undefined): string | null {
  if (!current) return "Enter your current password.";
  const problem = newPasswordProblem(next, email);
  if (problem) return problem;
  if (current === next) return "Your new password must be different from your current one.";
  return null;
}

/** A readable message for an error from Supabase Auth's updateUser. */
export function authErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "same_password":
      return "Your new password must be different from your current one.";
    case "weak_password":
      return `That password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    case "current_password_invalid":
    case "current_password_required":
    case "invalid_credentials":
      return "Your current password isn't right.";
    case "session_not_found":
    case "session_expired":
    case "user_not_found":
      return "Your sign-in has expired. Sign in again.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many tries. Wait a few minutes and try again.";
    default:
      return fallback;
  }
}
