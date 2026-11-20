# Runbook

What to do, step by step, when something needs fixing in the live app. Written so the owner or a developer can follow it under pressure. Why things are set up this way is in [SECURITY.md](../SECURITY.md).

Contents:

1. [Hosted settings checklist](#hosted-settings-checklist) (before go-live, and after any change)
2. [Restore a backup to a test project](#restore-a-backup-to-a-test-project)
3. [Rotate every secret](#rotate-every-secret)
4. [Owner locked out of two-step sign-in](#owner-locked-out-of-two-step-sign-in)
5. [Respond to a suspected breach](#respond-to-a-suspected-breach) (including the Privacy Act duty to notify)
6. [Error monitoring (Sentry)](#error-monitoring-sentry)

Keep a printed copy of sections 4 and 5 with the owner: if the app or someone's phone is the problem, this file may be hard to reach.

---

## Hosted settings checklist

`supabase/config.toml` only sets up the **local** stack. The hosted project is set in the Supabase dashboard. Check these before go-live and whenever `config.toml` changes.

**Authentication > Sign In / Providers**
- [ ] Allow new users to sign up: **off** (the owner invites people).
- [ ] Minimum password length: **10**. Require current password when updating: **on**.

**Authentication > Multi-Factor**
- [ ] TOTP (App Authenticator): **enabled** for enrolment and verification.
- [ ] Maximum enrolled factors per user: **5**.
- [ ] Phone MFA: **off** (costs money, and SMS is weaker).

**Authentication > Rate Limits** (the hosted equivalents of `[auth.rate_limit]`)
- [ ] Sign-ups and sign-ins: **20 per 5 minutes per IP** (a busy shift change from one restaurant's wifi).
- [ ] Token verifications (invite and reset links): **15 per 5 minutes per IP**.
- [ ] Token refreshes: **150 per 5 minutes per IP** (the default).
- [ ] Emails sent: as low as the SMTP provider allows for real use, for example **30 per hour**. (Locally it's 2.)
- [ ] Authentication > Email > minimum interval between emails to one address: **60 seconds**.

**Authentication > URL Configuration and Emails**
- [ ] Site URL and redirect URL (`https://<domain>/auth/confirm`) set to the real domain.
- [ ] Invite and reset templates pasted in from `supabase/templates/`.
- [ ] Custom SMTP set up (the built-in sender is for testing only).

**Storage**
- [ ] Every bucket private: `invoices`, `leave-documents`, `signatures`, `verifier-packs`, `payslips`. (`npx supabase seed buckets --remote` creates the first three with the right settings; the migrations create the last two.)

**Database**
- [ ] All migrations applied: `npx supabase db push --remote` (with the project linked).
- [ ] Advisors > Security Advisor shows no errors.
- [ ] `select set_reminder_settings('https://<domain>/api/cron/reminders', '<CRON_SECRET>');` run once.

**Your own accounts**
- [ ] Two-step sign-in **on** for the Supabase dashboard account, GitHub, the web host and Sentry. Whoever controls these controls the app.

**Host environment variables** (never with `NEXT_PUBLIC_` except where shown)
- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- [ ] `SUPABASE_SECRET_KEY`, `CRON_SECRET`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- [ ] Optional: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`

---

## Restore a backup to a test project

Do this **every three months**, and after any big database change, so you know the backups actually work. Never restore over the live project to "try it".

The copy holds real staff data (pay, health answers), so it gets the same care as the live one: only you can access it, don't share its keys, and **delete the test project when you've finished**.

### What a backup includes

| Part | Where it lives | How it's backed up |
|---|---|---|
| Database (tables, functions, policies, Auth users and two-step devices) | Postgres | Supabase daily backups (Pro plan), or your own dump (below) |
| Files (invoices, certificates, signatures, payslips, verifier packs) | Storage | **Not** in a database backup. Copied separately (step 6) |
| Secrets (Vault: reminder URL and cron secret) | Vault, encrypted with the project's own key | Can't be moved; set again if needed |
| Auth settings (MFA, rate limits, templates) | Dashboard | Not backed up: the checklist above |

### Steps

1. **Create a test project** in the Supabase dashboard: same region (Sydney), a new strong database password. Name it `chutneys-restore-test-<date>`.

2. **Get a backup.** Either:
   - **Pro plan:** Database > Backups. Pick the most recent daily backup and use **Restore to a new project**, choosing the test project. Then skip to step 5.
   - **Any plan (your own dump):** from the repo root, with the **live** database URL (Project Settings > Database > Connection string, session pooler):

     ```bash
     npx supabase db dump --remote="$LIVE_DB_URL" -f roles.sql --role-only
     npx supabase db dump --remote="$LIVE_DB_URL" -f schema.sql
     npx supabase db dump --remote="$LIVE_DB_URL" -f data.sql --use-copy --data-only
     ```

     These files contain real personal data. Keep them out of the repo (save them outside the project folder) and delete them at the end.

3. **Load it into the test project** with its database URL:

   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql \
     --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql \
     --dbname "$TEST_DB_URL"
   ```

   `session_replication_role = replica` switches triggers off while loading, so the audit log doesn't record the restore as thousands of new changes, and the append-only and "can't edit" triggers don't refuse old rows.

4. **If it fails**, read the first error; later ones usually follow from it. Common causes: the test project has a different Postgres major version (create it again on the same version), or an extension isn't enabled (Database > Extensions: `pg_cron`, `pg_net`, `btree_gist`).

5. **Stop the copy sending anything.** In the test project's SQL editor:

   ```sql
   select cron.unschedule(jobname) from cron.job;   -- no reminders or monthly packs from the copy
   ```

   Don't run `set_reminder_settings` there, and don't point a web app with real VAPID keys at it.

6. **Files (optional, to test them too).** Copy one bucket's recent files to check they come back, for example:

   ```bash
   npx supabase storage cp -r ss:///invoices ./restore-check/invoices --experimental --remote
   ```

   For a full off-site copy of files, use Storage's S3 access keys (Project Settings > Storage) with a tool like rclone.

7. **Check it.** In the test project's SQL editor:

   ```sql
   select count(*) from staff;
   select count(*) from record_entries;
   select count(*) from timesheets;
   select count(*) from payslips;
   select max(at) from audit_log;          -- close to when the backup was taken
   select count(*) from auth.users;
   ```

   Compare with the same queries on the live project (numbers a little lower is expected: the live one has moved on). Then run the database tests against it if you like: `npx supabase test db --remote="$TEST_DB_URL"`. Each test runs in a transaction that is rolled back, so it changes nothing, and `security_guards.test.sql` confirms the restored copy kept its protections.

8. **Write it down**: date, backup used, how long it took, anything that went wrong. Put it in the README's Known follow-ups if something needs fixing.

9. **Delete** the test project (Project Settings > General > Delete project) and the `.sql` files.

---

## Rotate every secret

Rotate a secret when it might have been seen by someone who shouldn't have it (a laptop lost, a key pasted in a chat, someone with access leaves), and at least once a year. Do one at a time and check the app still works after each.

| Secret | Where it's used | How to rotate | What breaks meanwhile |
|---|---|---|---|
| **Supabase secret key** (`SUPABASE_SECRET_KEY`, `sb_secret_…`) | Server only: invites, turning accounts off, push, reminders, the monthly pack, rate limits for cron | Dashboard > Project Settings > API Keys > create a new secret key. Put it in the host's env vars, redeploy, check More > Staff and a test notification work, then **delete the old key** | Nothing, if you add the new one before deleting the old |
| **Publishable key** (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) | Every browser (public by design) | Same page: create a new one, update env, redeploy, delete the old | Open tabs need a reload |
| **JWT signing key** (signs everyone's sign-in tokens) | Supabase Auth | Project Settings > JWT Keys: create a standby key, then **Rotate**. Revoke the old key once an hour has passed (the longest a token lives) | Revoking the old key at once signs everyone out (use this deliberately in a breach) |
| **`CRON_SECRET`** | pg_cron → `/api/cron/*` | Make a new one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Set it in the host's env vars and redeploy, then in the SQL editor: `select set_reminder_settings('https://<domain>/api/cron/reminders', '<new secret>');` | Reminders refused (401) for the minutes between the two steps |
| **VAPID keys** (`VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) | Signing phone notifications | Only if the private key leaked: `npx web-push generate-vapid-keys` in `web/`, update both env vars, redeploy, then `delete from push_subscriptions;` | Everyone must turn notifications on again in Settings |
| **Database password** | `supabase db dump`/`db push` from your computer (the app doesn't use it) | Project Settings > Database > Reset database password | CLI commands until you use the new one |
| **SMTP password** | Invite and reset emails | Make a new password or API key at the email provider, paste it in Authentication > Emails > SMTP, delete the old one at the provider | Emails fail between the two steps |
| **Sentry DSN** (`SENTRY_DSN`) | Error reports (public by design) | Only if someone floods Sentry with junk: Sentry > Project Settings > Client Keys: new key, update env, redeploy, disable the old key | Nothing |
| **GitHub and host tokens** | Your own access, any deploy tokens | GitHub > Settings > Developer settings; the host's account settings. Revoke anything unused | Whatever used them |
| **Staff passwords** | Each person | In a breach: sign everyone out (rotate the JWT key, or `delete from auth.sessions;`) and ask people to use **Forgot password** | Everyone signs in again |

After rotating: run the [hosted settings checklist](#hosted-settings-checklist) env var section again, and note the date.

---

## Owner locked out of two-step sign-in

The owner can reset a **manager's** two-step sign-in (More > Staff > Manage > Reset two-step sign-in), but nobody can do it to themselves through the app. That's on purpose: otherwise a stolen owner password would be enough to remove the owner's protection.

**Prevent it:** the owner sets up **two** devices (Settings > Two-step sign-in > Add a device), for example their phone and a tablet kept at home, or a password manager that holds codes.

If the owner has lost every device:

1. **Use the second device** if there is one. Then remove the lost one in Settings and add a new one.
2. **Another owner** (if the business has one) resets it in More > Staff, after checking with them in person or by phone.
3. **Otherwise**, someone with access to the Supabase dashboard (the developer) does it, **only after confirming in person or by a phone call to a number they already know** that the request really comes from the owner. Anyone can send an email claiming to be the owner.
   - Dashboard > Authentication > Users > find the owner > remove their MFA factors. Or in the SQL editor:

     ```sql
     -- Who: the owner's id
     select id, email from auth.users where email = '<owner email>';

     -- Remove their authenticators and sign them out everywhere
     delete from auth.mfa_factors where user_id = '<owner id>';
     delete from auth.sessions where user_id = '<owner id>';

     -- Keep the record the app would have made (reset_staff_mfa does this for managers)
     insert into mfa_resets (staff_id, reset_by, factors_removed)
     values ('<owner id>', '<owner id>', <number removed>);
     ```

   - The owner signs in with their password and is taken straight to setting up a new authenticator. They should add a second device straight away.
4. Note in the audit log what happened and why. The `mfa_resets` row and the factor deletions are visible there.

If the **Supabase dashboard account itself** is lost, recover it through Supabase support with the account's email. This is why the dashboard account needs its own two-step sign-in and recovery codes kept somewhere safe.

---

## Respond to a suspected breach

A breach is when personal information is accessed, seen, changed, lost or destroyed by someone who shouldn't have, or can't be reached when needed. Examples: a lost unlocked tablet, a manager account used by someone else, the secret key pasted somewhere public, a staff member reading payslips they shouldn't see.

Write down everything as you go: times, what you saw, what you did. You'll need it for the Privacy Commissioner, and memory is unreliable under stress.

### 1. Contain it (first hour)

Do whichever of these fit:

- **One account misused:** More > Staff > **Turn off account** (signs them out everywhere and blocks sign-in). For a manager whose phone or code may be compromised, also **Reset two-step sign-in**.
- **Possibly many accounts:** sign everyone out: rotate the JWT signing key and revoke the old one, or run `delete from auth.sessions;`. Ask everyone to reset their password.
- **A secret exposed:** rotate it now ([Rotate every secret](#rotate-every-secret)). The Supabase secret key first: it skips every rule.
- **A lost device:** turn off or reset the person's account as above. If it was a shared tablet, sign everyone out.
- **Ongoing attack or unknown cause:** take the app offline at the host (pause the deployment). Food safety records go back to paper for the day.

### 2. Keep the evidence (same day)

Logs don't last long (one day on Supabase's free plan, seven on Pro), so save them now:

- **Audit log:** More > Audit log (owner), filtered to the dates. Or export from the SQL editor: `select * from audit_log where at > '<start>' order by at;`
- **Supabase logs:** Dashboard > Logs: Auth (sign-ins, failed sign-ins, IPs), API (PostgREST requests) and Storage (file downloads). Export what covers the time.
- **Two-step resets and rate limits:** `select * from mfa_resets;` and `select * from rate_limits;`
- **Sentry** (if on), the host's request logs, and GitHub's security alerts.

### 3. Work out what happened and how bad it is (within a few days)

Answer: what information, whose, how many people, who got it, is it still exposed, and what could they do with it.

**The Privacy Act 2020 duty to notify.** A breach is **notifiable** if it has caused, or is likely to cause, **serious harm** to anyone affected. To decide, consider (section 113 of the Act):

- how sensitive the information is. **Health information (the vomiting or diarrhoea answers, medical certificates), pay and payslips count as sensitive;**
- what harm it could cause (embarrassment, discrimination, identity fraud, loss of a job, distress);
- who got it, and what they're likely to do with it;
- whether the information was protected (for example, a stolen tablet that was signed out);
- what you've done to reduce the harm.

When in doubt, treat it as notifiable. You can also ask the Office of the Privacy Commissioner for guidance.

### 4. Notify

If the breach is notifiable, Chutneys (the owner, as the agency responsible) **must**:

- **Tell the Privacy Commissioner as soon as practicable** after becoming aware of it. Use the online **NotifyUs** form at [privacy.org.nz](https://www.privacy.org.nz). Don't wait until the investigation is finished: you can send more information later. Not notifying the Commissioner of a notifiable breach is an offence (a fine of up to $10,000).
- **Tell the affected people as soon as practicable**: in person or in writing, saying what happened, what information, what you've done, what they can do to protect themselves, and who to contact. If telling each person isn't reasonably practicable, a public notice may be used instead.

Keep a record of every breach, including ones you decided weren't notifiable and why.

### 5. Recover and learn (within two weeks)

- Fix the cause, not just the symptom (a missing policy, a weak setting, a gap in the shared-device routine).
- Add a test if the cause was a rule the code should enforce.
- Update [SECURITY.md](../SECURITY.md) with the threat and control, and this runbook with anything that was hard to do.
- Tell staff what changed, without blaming individuals for honest mistakes, so people keep reporting problems early.

---

## Error monitoring (Sentry)

Optional. With no `SENTRY_DSN` set, Sentry isn't loaded at all.

1. Create a free Sentry account with two-step sign-in on. Choose the **EU** or **US** data region (data leaves New Zealand either way; the privacy page says so).
2. Create a project, platform **Next.js**. Copy its **DSN** (Project Settings > Client Keys).
3. In Sentry > Project Settings > **Security & Privacy**, as a second layer: turn on **Data Scrubber**, **Use Default Scrubbers**, and **Prevent Storing of IP Addresses**.
4. At the host, set `SENTRY_DSN` (and optionally `SENTRY_ENVIRONMENT`, for example `production`). The DSN is used both on the server and, at build time, in the browser, so **redeploy** after setting it.
5. Check: trigger an error (for example open `/purchases/invoice/not-a-real-id` signed in), then confirm in Sentry that the event has **no user, no IP, no request body, no cookies, and no query string**. If anything personal shows up, unset `SENTRY_DSN`, redeploy, and fix `web/lib/sentry-scrub.ts` (with a test) first.

The CSP allows the Sentry ingest host automatically when `SENTRY_DSN` is set (`lib/security-headers.ts`). Source map upload and performance tracing are deliberately not set up.
