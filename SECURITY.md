# Security

How Chutneys Ops protects the information in it: what we protect, who from, and how. Each threat points at the control that stops it and the test that proves the control works. When you add a feature, check it against this page; when you add a control, add its row.

For what to *do* when something goes wrong (restore a backup, rotate a secret, respond to a breach), see [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private reporting: on the repository page, **Security > Report a vulnerability**. Say what you found, how to reproduce it, and what someone could do with it. You'll get a reply within a week. Please don't access other people's data to prove a point; showing that you *could* is enough.

## What we protect

| What | Why it matters |
|---|---|
| **Food safety records** (temperatures, checks, sign-offs, training) | The law requires them, and the council verifier relies on them. They must be *true*: nobody may quietly change or delete one. |
| **Pay information** (hours, timesheets, payroll codes, the hours export) | Private to each person, and the basis of their wages. |
| **Payslips** | Only the person and the owner may ever see one. |
| **Health-related leave answers** (vomiting or diarrhoea, medical certificates) | Health information under the Privacy Act 2020: the most sensitive thing we hold. |
| **Staff details** (names, emails, roles, sign-in records) | Personal information. |
| **Money** (cash-ups, daily sales, purchases) | Owner only (purchases: managers too). |

## Who we protect it from

1. **Outsiders** on the internet: password guessing, calling the API directly, injecting scripts, abusing the scheduled routes.
2. **Curious staff** who are signed in and try to see or change more than their job needs (a colleague's payslip, someone's sick leave, their own hours).
3. **A lost or shared tablet**: the next person to pick it up, or someone who finds it.
4. **A compromised manager account**: a manager's password phished or reused from another site.

The owner's account is the most powerful one, so it gets the same protections as a manager plus a recovery plan ([RUNBOOK > Owner locked out](docs/RUNBOOK.md#owner-locked-out-of-two-step-sign-in)).

## How: each threat, its control, and its test

The database is the real guard. Every rule below is enforced in Postgres (row-level security, grants and functions), not just hidden in the screens, so it holds even for someone calling the API directly with the publishable key.

### 1. Outsiders

| Threat | Control | Proved by |
|---|---|---|
| Guessing passwords | No public sign-up (invite only); passwords at least 10 characters; Supabase Auth rate limits on sign-in, reset links and emails (`supabase/config.toml` `[auth.rate_limit]`, hosted settings in the runbook); the sign-in form never says whether an email exists | `staff_accounts.test.sql` (invite-only rules); config reviewed by hand |
| Calling the API without signing in | `anon` has no grant on any table and can't run any of our functions; RLS is on for every table | `security_guards.test.sql` |
| A new table or function forgetting the above | Default privileges give `anon` nothing for anything created later; the guard test fails CI if a table lacks RLS | `security_guards.test.sql` ("a new table or function gives anon nothing") |
| Hijacking a security definer function with a planted object | Every security definer function has a fixed `search_path` | `security_guards.test.sql` |
| Injected scripts (XSS) | React escapes everything it renders; a strict Content Security Policy with a fresh nonce per request (`proxy.ts`, `lib/security-headers.ts`): only scripts we served run, no `eval`, no inline styles except React's exact `display:none` | `lib/security-headers.test.ts`; every page loaded in the production build with no CSP violations (see README > Security checks) |
| Clickjacking (the app shown inside another site) | `frame-ancestors 'none'` and `X-Frame-Options: DENY` | `lib/security-headers.test.ts` |
| Eavesdropping or downgrade to http | HTTPS everywhere with `Strict-Transport-Security` (2 years); `upgrade-insecure-requests` | `lib/security-headers.test.ts` |
| Browser features misused (camera, microphone, location) | `Permissions-Policy` turns off everything we don't use; camera only for "Take photo" | `lib/security-headers.test.ts` |
| Guessing file links | Every Storage bucket is private; files are read through policies and links that expire in minutes | `security_guards.test.sql` (no public bucket); storage policy tests in `purchases`, `leave`, `training`, `payslips`, `verifier_packs` |
| Abusing the scheduled routes (`/api/cron/*`) | A 32+ character `CRON_SECRET`, compared in constant time; per-IP rate limit *before* the secret check, so guessing is slow | `rate_limits.test.sql` (per-IP keys); `lib/rate-limit.test.ts` |
| A vulnerable dependency | Dependabot PRs weekly; `npm audit --audit-level=high` fails CI; CodeQL scans our code | CI (`.github/workflows/ci.yml`, `codeql.yml`) |
| A secret committed by mistake | gitleaks scans the whole history on every push and PR; secrets live only in `.env` files (git-ignored) and the host's settings | CI (`.github/workflows/gitleaks.yml`) |
| A tampered GitHub Action | Every action is pinned to a commit SHA, not a movable tag | Review of `.github/workflows/` (Dependabot keeps the pins current) |

### 2. Curious staff

| Threat | Control | Proved by |
|---|---|---|
| Reading a colleague's payslip | RLS: your own published payslips only; files likewise; only the owner sees all (not managers) | `payslips.test.sql` |
| Reading someone's payroll code | Column grants hide it; only `staff_payroll_codes()` returns it, to the owner and the person | `payslips_leavers_private_codes.test.sql` |
| Reading someone's sick leave or illness | RLS: staff see their own requests only; `needs_clearance()` answers only for yourself | `leave.test.sql` |
| Changing or deleting a food safety record | No update or delete grants; triggers refuse edits; mistakes are fixed by a correction entry; the audit log is append-only even for the SQL editor | `food_safety_records.test.sql`, `audit.test.sql` |
| Signing off records or approving hours | Manager-only functions (`sign_off_sheet` with a PIN and lockout, `approve_timesheets`, never your own) | `pin_lockout_and_stale_shifts.test.sql`, `timesheets.test.sql` |
| Making themselves a manager | No update grant on `staff`; only `set_staff_role` (owner only, never on yourself) | `staff_accounts.test.sql` |
| Records at a site they aren't working at | Access follows today's site choice (`on_shift_at`) | `shift_access.test.sql` |
| Flooding uploads or actions | Per-person rate limits (`check_rate_limit`) on invites, PIN sign-off, two-step codes, purchase, leave and payslip uploads; "Too many attempts, try again in N minutes" | `rate_limits.test.sql`, `lib/rate-limit.test.ts` |
| Using up someone else's allowance to lock them out | A signed-in caller can only count against keys starting with their own id | `rate_limits.test.sql` |
| Covering their tracks | Every change to every business table goes to the owner-only, append-only audit log, with the real person even inside functions | `audit.test.sql` (including "every table is audited") |

### 3. A lost or shared tablet

| Threat | Control | Proved by |
|---|---|---|
| The next person carries on in someone else's session | Settings > This device > "This is a shared device": signs out after 15 minutes without use, also after the tablet has been asleep | `lib/shared-device.test.ts`; checked in the browser (README > Security checks) |
| Data left behind after signing out | Sign out removes this device's push subscription, clears Cache Storage, sessionStorage and our localStorage keys (not the device settings), and reloads `/login` in full; the Back button can't show a cached page | `lib/shared-device.test.ts` (which keys are cleared); checked in the browser |
| A turned-off leaver whose token hasn't expired | `is_active()` in every helper and a restrictive "active accounts only" policy on every table and Storage; their sessions are deleted | `staff_accounts.test.sql` (including "every table has the policy") |
| A manager's phone is lost while signed in | The owner's **Reset two-step sign-in** removes their authenticators and deletes their sessions everywhere (audited) | `two_factor.test.sql` |
| Someone who opted in to two-step sign-in has their password stolen | With an authenticator set up, a password alone opens nothing (not even their own payslips) until the code is typed | `two_factor.test.sql` |

### 4. A compromised manager account

| Threat | Control | Proved by |
|---|---|---|
| A stolen manager password | Two-step sign-in is required for owners and managers. The **database** checks it: `is_owner()` and `is_manager()` need a token that came with a code (`aal2`). A manager who hasn't set one up gets staff-level access; one who has gets nothing until the code | `two_factor.test.sql` (aal1 can't approve, sign off or see all; aal2 can) |
| Secret-key paths trusting the screen | More > Staff asks the database `is_owner()` (which includes `aal2`) before using the secret key; the staff row alone isn't enough | Code review of `app/(app)/more/staff/actions.ts`; the database functions it calls check again |
| Guessing the 6-digit code | 10 tries per 15 minutes per person (our limiter) on top of Supabase's own limits | `lib/rate-limit.test.ts` ("10 guesses in 15 minutes"), `rate_limits.test.sql` |
| Adding the attacker's own authenticator | Supabase Auth refuses to add a second device without a code from an existing one (`aal2`) | Supabase Auth behaviour; the app shows "Type your code from your existing device first" |
| Damage once inside | Managers never see money, payslips or the audit log; records can't be deleted; every change is audited for the owner | `payslips.test.sql`, `audit.test.sql`, `food_safety_records.test.sql` |
| Recovery | Owner: More > Staff > Turn off account, or Reset two-step sign-in; then [RUNBOOK > Suspected breach](docs/RUNBOOK.md#respond-to-a-suspected-breach) | `two_factor.test.sql`, `staff_accounts.test.sql` |

### Error monitoring without leaking

Sentry only runs when `SENTRY_DSN` is set. Before anything leaves the server or the browser, `lib/sentry-scrub.ts` removes the user (id, email, IP), request bodies, cookies, headers, query strings and local variables, and redacts emails, IP addresses, tokens and names in our own error wording. No performance tracing, no session replay. Proved by `lib/sentry-scrub.test.ts`.

## Known limits (accepted for now)

- **We trust Supabase and the web host.** Their staff and systems could in theory read the database. Data is encrypted in transit and at rest, and Supabase holds SOC 2 reports.
- **The secret key skips every rule.** It's only in the server's environment, and only `web/lib/supabase/admin.ts` reads it. If it leaks, rotate it at once (runbook).
- **IP rate limits share a network.** A whole restaurant shares one IP, so Auth's per-IP sign-in limit is set for a busy shift change, not one person.
- **No recovery codes yet.** A manager who loses their only authenticator needs the owner to reset it. Supabase Auth supports recovery codes; adding them is a follow-up.
- **Pages render on every request** (no prebuilt static pages), because a nonce can only be added at request time. It's slightly slower to first paint; fine for this app's size.
- **Health information appears in the audit log** (leave rows). Only the owner can read it, and it counts as health data under the Privacy Act.
- **CSP allows one style attribute** (`display:none`, by exact hash, needed by React's streaming). Nothing else inline.
