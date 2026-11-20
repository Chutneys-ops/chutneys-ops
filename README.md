# Chutneys Ops

A side project to learn full-stack development: one operations app for the Chutneys business (a restaurant, a cafe and four food trucks in Auckland).

Status: Phase 1 MVP in progress. Concept demo shown to the owner on 16 Nov 2026.

## What's built so far

- **Database** (`supabase/migrations/`): all Phase 1 tables (sites, staff, shifts, checklists, temperature units and readings, cash-ups, daily sales, alerts) with row-level security on every table.
- **Access by site choice** (fourth migration): staff move between sites, so what you can do depends on the site you chose today, not on a fixed list.
  - "Choose site" (`start_shift`) records today's site in `shifts`. It no longer means hours (see Timesheets). A choice lasts 14 hours, so you choose again each day.
  - Staff see and add records only at the site they chose today.
  - Managers and the owner see records at every site and can sign off anywhere. They need to choose a site to add entries.
  - Money (cash-ups, daily sales) is owner only; managers can't see it.
  - Old clock-in/clock-out rows (and `fix_clock_out`, `needs_review`) stay in the database for history. The app no longer shows Clock out, forgotten-shift notices or the "Needs fixing" list.
  - `staff_sites` is no longer used for access. It's kept for now as history.
- **Login**: email and password through Supabase Auth, with `web/proxy.ts` refreshing the session on every request. Owners and managers then type a code from an authenticator app (see Security hardening). Signing in always lands on Home (never a "next" or last-visited page). `/` redirects to `/home`, and refreshing a page stays on it. Wrong details always say "Email or password is incorrect", including for turned-off accounts, so the form never reveals who has an account.
- **Staff accounts** (thirteenth migration, owner only at More > Staff):
  - **No public sign-up** (`enable_signup = false`). The owner invites people (name, email, role). They get an email with a link and choose their own password.
  - **Invite**: a server action checks with the caller's *own* session that they are an active owner. Only then does it use the admin client (`web/lib/supabase/admin.ts`, `SUPABASE_SECRET_KEY`) to call `auth.admin.inviteUserByEmail`. It then adds the `staff` row with the owner's session (an owner-only insert policy).
  - **Statuses:** Active; Invited, not joined yet (no password set; `staff_logins()`); Turned off. Resend invite sends a new link. If they opened the first link but never saved a password, it sends a "choose a password" link instead.
  - **Roles and turning off** go only through `set_staff_role` and `set_staff_active`. Both are owner only, and neither works on yourself, so there is always an owner. Turning someone off:
    - deletes their sessions (signed out everywhere);
    - bans the login through the Auth admin API;
    - makes the database show them nothing.
    Turning them back on lifts the ban. Their records, hours and leave stay either way.
  - **Turned-off people are hidden** from the training matrix, the trainee picker and "Add hours for someone". More > Staff and the audit log still list them. Their past timesheets, records, leave and training still show under their name.
  - **Nothing new can be added for them** (fourteenth migration). Nobody can add timesheets, training records, leave, site choices or food safety records for a turned-off person, not even the owner or the SQL editor. The page says, for example, "Ana's account is turned off, so you can't add hours for them". Their existing rows stay. This is one `active_staff_only` trigger function on each of those tables, using `require_active_staff()`.
  - **Turned off means nothing works**, even with a token that hasn't expired:
    - `is_active()` is inside `is_owner`, `is_manager`, `on_shift_at`, `can_see_site`, `shares_site_with` and the functions that act for yourself.
    - A restrictive "active accounts only" policy is on every table and on Storage. Many policies only check `staff_id = auth.uid()`, so the helpers alone weren't enough.
    - The one exception: a turned-off person can read their own `staff` row. `getSession` uses it to send them to `/auth/signout`, which signs them out with "Your account has been turned off. Talk to your manager."
  - **Passwords**:
    - `/auth/confirm` checks invite and reset links (`verifyOtp` with `token_hash`) and goes on to `/set-password`. That page has new + confirm, at least 10 characters, not your email, and Show/Hide.
    - `/forgot-password` always says the same thing, whether or not the email has an account.
    - Settings > Change password needs your current password. Supabase Auth checks it (`require_current_password`).
    - Auth also refuses passwords under 10 characters (`minimum_password_length`).
  - **Emails**: `supabase/templates/invite.html` and `recovery.html`. They use the Chutneys Ops name, a green button, and the link as plain text for email apps that block buttons. Locally they land in Mailpit at http://127.0.0.1:54324.
- **Home** (`/home`): where every login lands.
  - A greeting by Auckland time of day ("Good morning, Ana") and the date.
  - A daily message: one original line a day, the same for everyone, picked by the Auckland date from about 60 lines in `web/lib/daily-messages.ts` (`pickMessage`).
  - Today's site, with Change site, or a big "Choose site" button. Choosing from Home comes back to Home.
  - **Due today:** records that must be done every day (`record_templates.required_daily`: fridge temperatures, opening checks and cleaning) with no entry yet at your site, each linking to its record, or "All done for today". Records that only apply when something happens (cooking, cooling, reheating, deliveries...) never show as due. The flag is set in the twelfth migration and in `seed.sql`, and only daily templates can have it.
  - **Your stuff:** training to confirm, your latest leave request and this week's paid hours.
  - **Managers and the owner** also see "Needs attention" counts: people to clear after illness, out-of-range readings today, sheets not signed off today, timesheets to approve, leave waiting. Cards with a zero count are hidden.
  - **The owner** also sees this month's purchases (total and GST).
  - Every query runs as the signed-in person, so RLS decides what's counted. The logic is in `web/lib/home.ts`, with tests.
- **Installable app (PWA):**
  - `app/manifest.ts` sets the name "Chutneys Ops" (short "Chutneys"), start page `/home`, full screen, and the brand colours.
  - Every icon (192, 512, maskable, Apple touch, favicon) is drawn at build time from one file, `web/lib/brand/app-icon.tsx`, by `app/icons/[file]/route.tsx`. **To use the real logo, change only `app-icon.tsx`.**
  - `/install` shows the steps for iPhone (Safari > Share > Add to Home Screen) and Android (Chrome > Install app), with pictures drawn in SVG. Your phone's steps come first, and it says "Already installed" when the app is running from the home screen.
  - Home shows a small "Install the app" card until it's installed or dismissed. The dismissal is remembered per device.
- **Choose site** (`/start`): a big card per site. Tapping one sets today's site and opens Records, or goes back to Home if you came from there. The header shows "Site: …" with Change site.
- **Food safety records** (`/records`, third migration): record types from templates in the database:
  - opening checks for each kind of site
  - fridge temperatures, cooking, cooling, reheating, hot holding, cold display, transport, batter fermentation and cleaning
  - deliveries, maintenance, incidents and complaints

  How the records work:
  - The site comes from today's site choice, not the URL. Managers and the owner get a site and date filter.
  - Entries can never be edited or deleted. Mistakes are fixed with a correction entry, and every entry can have Comments.
  - A database trigger checks every value against its template. Out-of-range readings, or a "No" on a check that should be "Yes", are flagged and need a corrective action.
  - Cooling and batter readings taken hours later are added as follow-up entries.
  - A manager or owner signs off each day's sheet with a 4-digit PIN, set under More and stored only as a hash. Five wrong PINs lock sign-off for 15 minutes.
- **Opening checks**: the old opening checklist is now a record template per kind of site (`opening_checks_truck`, `_cafe`, `_restaurant`). The checklist pages are gone; the old checklist tables are still in the database.
- **Purchases** (`/purchases`, seventh migration): groceries and supplies bought for a site, with the invoice for GST.
  - Add a purchase at the site you chose today: supplier, what was bought, total incl GST, GST included yes/no, how it was paid (company card, till cash, own money) and comments.
  - The database works out the GST (`round(total * 3 / 23, 2)`, or 0 when the supplier isn't GST registered), so nobody can type it wrong.
  - Every purchase needs an invoice (photo or PDF) or a "no receipt" reason. A check constraint enforces it.
  - "Take photo" opens the camera; "Choose file" takes a photo or PDF (two buttons because Android hides the file picker when the camera option is set). Photos are shrunk in the browser to 1600 px wide JPEG (about 200-400 KB) before uploading, which also strips GPS data.
  - Invoices live in a private Storage bucket, `invoices` (5 MB, images and PDF), at `{site_id}/{yyyy}/{mm}/{uuid}.{ext}`. Storage policies: upload only into the folder of the site you chose today; read your own uploads; managers and the owner read all. A purchase can only point at your own file in that site's folder. Files are shown with short-lived signed URLs through `/purchases/invoice/<id>`.
  - The file is uploaded first, then the purchase is saved. If saving fails, the file is deleted (allowed only for your own file that no purchase uses).
  - Nobody can edit or delete a purchase. Staff see their own; managers and the owner see all, with site and month filters.
  - "Owed to staff": own-money purchases not yet paid back. A manager or the owner taps "Mark paid back" (`mark_reimbursed`). You can't mark your own, except the owner.
  - The owner gets "Export month": a CSV for the accountant (date, site, supplier, description, total, GST, payment method, who bought, invoice link, no-receipt reason). The route checks the role on the server, so anyone else gets 403.
- **Sick leave** (`/leave`, eighth migration): staff request sick leave (sick, injured or caring for a dependant) for a date range, in whole days or hours. Leave is stored in hours, because the Employment Leave Act 2026 moves leave to hours.
  - An optional medical certificate (photo or PDF) goes to a private bucket, `leave-documents`, at `{staff_id}/{uuid}.{ext}`. You can upload only into your own folder and read your own; managers and the owner read all. It uses the same "Take photo / Choose file" picker and photo shrinking as purchases (`components/document-picker.tsx`).
  - Staff see only their own requests. Managers and the owner decide them on **Leave requests** through `decide_leave`: they can adjust the hours when approving, a decline needs a note, and a decision is final. You can't decide your own (the owner can).
  - **Food safety:** the form asks "Do you have vomiting or diarrhoea?". If yes, today's site choice ends straight away. Until a manager clears you, `start_shift` refuses with "Your manager needs to clear you to return to work after illness", and you can't enter your own hours for days after the illness started. Clearing is separate from approving: even a declined request still has to be cleared.
  - **Staff sickness** (managers): the MPI staff sickness record (name, date sick, date cleared, cleared by) with "Clear to return". The 48-hour symptom-free reminder needs a tick-box before it can be submitted.
  - `needs_clearance()` only says whether *you* need clearing, so nobody can look up a colleague's illness.
- **Training records** (`/training`, ninth migration): managers and the owner record training they gave (topic, date, notes). Their login is their trainer signature, stamped by the database.
  - The trainee sees "Training to confirm" and taps Confirm (`confirm_training`). Logging in is their signature; drawing one with a finger is optional and is stored as a PNG in the private `signatures` bucket.
  - After both have signed, a trigger locks the record. Before that, only the trainee's confirmation can be added. Nobody can edit or delete records through the API.
  - **Training matrix** (managers): staff down the side, topics across, the latest date in each cell. Dates the trainee hasn't confirmed yet are marked with `*`.
- **Hours and leave export** (owner only, More > Export hours and leave): a CSV of timesheets and approved leave for a date range (up to 92 days): name, site, date, start, finish, at work, rest breaks, meal breaks, paid hours, type, status, edit note. Leave rows put their first and last day in Start and Finish, and their hours in Paid hours. The route returns 403 for anyone but the owner and fetches in pages, so it isn't cut off at the API's 1,000-row limit.
- **Audit log** (tenth migration, owner only at More > Audit log): who changed what, and when, on every business table.
  - One trigger function, `audit_row()`, writes a row for every insert, update and delete: time, person (`auth.uid()`, which is still the real person inside functions like `mark_reimbursed`), their role, table, row id, old and new data, and for updates only the changed columns. "System" means a migration, the seed or the SQL editor. An update that changes nothing writes no row, so re-running the seed adds nothing.
  - Audited: every table in `public` except `staff_pins` (PIN hashes are secrets) and `audit_log` itself. Any column with `hash`, `password`, `secret` or `token` in its name is stripped before storing (`audit_redact`).
  - Only the owner can read it (RLS with `is_owner()`), not even managers. Nobody can insert, update or delete through the API, and an append-only trigger blocks changes even from the SQL editor.
  - The page shows newest first, 50 per page, with filters for person, area and Auckland dates. Each row says what happened in words ("Signed off Fridge temperatures", "Marked Ana's purchase paid back") and, for updates, the changed fields before and after. Friendly names live in `web/lib/audit.ts`, with raw names as a fallback.
- **Notice board** (`/notices`, fifteenth migration): managers and the owner post announcements; staff read them.
  - A notice has a title (up to 120 characters), plain text with line breaks (up to 2000), who it's for (everyone, or chosen sites), Pin, Needs acknowledgement and an optional "show until" date (through the end of that Auckland day).
  - **Who sees what:** staff see live notices (not archived, not expired) for everyone, or for a site they chose in the last 30 days (`my_recent_site_ids()`). Managers and the owner see everything, including archived and expired ones (folded away at the bottom of the list).
  - **Reading:** opening a notice marks it read (from the browser after the page opens, so link prefetching can't). "Needs acknowledgement" notices show "I've read and understood this". The database stamps the time, and an acknowledgement can never be cleared or changed, even from the SQL editor.
  - **Home** shows a Notices card at the top while any are unread or waiting for your acknowledgement (pinned first). **More** shows Notices with a badge counting the same.
  - **Managers and the owner:** New notice (with a live preview), Edit (the database stamps "edited"), and Archive (final; it disappears for staff). Each notice shows "Read by 12 of 18, acknowledged by 9" and who hasn't. The audience is every active person except the poster; for a site notice, those who chose one of its sites in the last 30 days.
  - **Confirmed wording is locked** (sixteenth migration): once anyone has acknowledged a notice, its title and text can't be edited, even by the owner or from the SQL editor ("People have already confirmed this notice. Archive it and post a new one."). This holds even if Needs acknowledgement is turned off later. Pin, expiry, audience and archiving can still change, and notices nobody has acknowledged stay fully editable. The edit form shows the title and text read-only with that explanation.
  - **Never deleted:** no delete grants, and a trigger refuses deletes. Only the managers' columns can be written; `posted_by` and `posted_at` are fixed.
  - The rules for the audience, unread counts, read counts, form checks and expiry are in `web/lib/notices.ts`, with tests.
  - **Phone notifications:** a new notice is pushed to its audience (see Phone notifications). Editing doesn't notify.
- **More menu** (`/more`): Notices, Leave, Training, My payslips, Settings, Your privacy and Sign out. Managers also see Roster, Leave requests, Staff sickness, Training matrix and Verifier pack; the owner also sees Staff, Payslips, Export hours and leave, and Audit log. More stays highlighted on its sub-pages.
- **Trading days** (twentieth migration): `sites.trading_days` lists the ISO weekdays each site trades (1 = Monday ... 7 = Sunday), default every day.
  - Managers and the owner set them in Settings > Opening times and trading days (Mon to Sun toggles next to each site's opening time) through `set_site_trading_days()`. It sorts the days and removes repeats. Sites have no update policy, so it's the only way in.
  - A check (`valid_trading_days`) holds even in the SQL editor: at least one day (a site that never trades is turned off instead), only 1 to 7, and no repeats.
  - On a non-trading day there are no fridge or opening-check reminders, and the verifier pack shows CLOSED instead of NO RECORD. Entries made on a closed day still show as normal.
  - The rules are in `web/lib/trading-days.ts`, with tests (one reads the migration's default).
- **Per-unit temperature limits** (sixth migration): fridge readings are checked against each unit's own `min_c`/`max_c` (fridges 0 to 5 C, freezers -25 to -15 C). The seed adds sample fridges and freezers at every site.
- **Timesheets** (`/time`, eleventh migration): hours are entered by hand, not clocked.
  - **Add my hours:** date, site, start and finish. A finish earlier than the start means the next morning. A live preview shows, for example, "7 h at work, 2 x 10 min paid rest, 1 x 30 min meal, 6.5 h paid".
  - **This week:** your timesheets with paid and at-work totals and their status. You can change or delete your own until they're approved.
  - **Breaks are worked out, never typed.** `nz_breaks()` follows the Employment NZ table: rest breaks are 10 minutes and paid, meal breaks are 30 minutes and unpaid. A trigger stores minutes at work, breaks and paid minutes (at work minus 30 per meal break). The browser can't write them. `web/lib/breaks.ts` has the same table for the preview. Its test reads the shared cases in `supabase/tests/nz_breaks.test.sql`, which also tests the SQL, so the two can't drift apart.
  - **Rules in the database:** no future dates, at most 16 hours, and no overlapping timesheets for one person (an exclusion constraint, `btree_gist`). Times are Auckland local, so daylight saving nights count real time.
  - **Managers and the owner:**
    - "To approve" is grouped by week and site, with Approve all (`approve_timesheets`: never your own, except the owner).
    - "Add hours for someone".
    - Adding or changing someone else's hours needs a note, and so does changing approved hours.
    - Approved hours are locked for staff and can't be deleted.
- **Rosters** (`/roster`, seventeenth migration): managers and the owner plan each site's week (Monday to Sunday) and publish it; staff see their shifts.
  - **Tables:** `roster_weeks` (one per site per week: published at/by, "changed since published") and `roster_shifts` (person, day, start, finish, optional position and note). Like timesheets, a finish earlier than the start is the next morning, the database stores the real Auckland instants, and breaks and paid minutes come from `nz_breaks()` in a trigger. The browser can't write them (column grants).
  - **No double-booking:** one person can't have overlapping shifts at any site (an exclusion constraint). A turned-off person can't be rostered, or be given someone's shift.
  - **Who sees what:** only managers and the owner add, change, delete and publish. Staff see only their own shifts, and only in published weeks. "Who's on with me" (`roster_coworkers()`) gives them the names and times of others at the same site that day, nothing else.
  - **The roster page:** site and week pickers, one section per day, Add shift (with the live breaks preview), Change and Delete, Copy last week (`copy_roster_week`: skips shifts that would overlap or are for turned-off people, so running it twice adds nothing), Publish / Re-publish, and paid-hour totals per person and for the week.
  - **Publishing** (`publish_roster_week`) stamps the time and the person. Any change to a published week marks it "changed since published" until it's published again.
  - **Warnings, not blocks** (`roster_warnings()`): someone on approved leave that day, or over 40 paid hours rostered in the week across all sites. The 40 is also `OVER_HOURS_LIMIT` in `web/lib/roster.ts`; a unit test reads the migration so they can't differ.
  - **Staff:** "My shifts" on Home (next shift up top) and on Time (this week and next), each with "Who's on with me".
  - **Timesheet approval:** each timesheet waiting shows the rostered shift for that person, day and site (published weeks only), and flags a start or finish more than 15 minutes away, or "Not rostered".
  - **Phone notifications:** publishing pushes "Your shifts at Cafe for the week of Mon 23 Nov are up" to everyone on that week; re-publishing pushes "Your shifts changed".
  - The week dates, form checks, totals, warning text and the rostered-vs-actual comparison are in `web/lib/roster.ts`, with tests.
- **Phone notifications and reminders** (`/settings`, eighteenth migration): standard Web Push, no app store.
  - **Turning them on:** Settings > Notifications > "Turn on notifications". The browser asks for permission only after that tap (iPhone requires it). It registers `public/sw.js`, subscribes with the VAPID public key and saves the subscription (`save_push_subscription`). "Send me a test" pushes to every device you've turned on. On iPhone, Safari only offers notifications to the app added to the Home Screen, so Settings says so and links to `/install`.
  - **Four switches**, for every device: Notices, Roster (published or changed, and the evening before a shift), Reminders (fridge, opening checks) and Approvals (your leave decided; managers: things waiting). No `notification_prefs` row means all on.
  - **Sent straight away** (`web/lib/notify.ts`, run with `after()` so the action doesn't wait): a new notice to its audience, a roster published or re-published to the people on that week, leave approved or declined to the person.
  - **Scheduled reminders** (Auckland time, `web/lib/reminders.ts`):
    - 10:00: "Fridge temperatures not done yet at <site>" to the people who chose that site today. From 11:00, managers hear about every site open today (someone chose it) that's still missing them.
    - Opening checks not done 30 minutes after the site's opening time (`sites.opens_at`, default 9:00; managers change it in Settings > Opening times and trading days).
    - Fridge and opening-check reminders only go out on the site's trading days (see Trading days).
    - 17:00: managers get "3 timesheets and 1 leave request waiting" (not counting their own, except the owner). Nothing waiting, nothing sent.
    - 19:00: "You're on tomorrow 9:00 am to 5:00 pm at Cafe" for shifts in published weeks.
    - Each has a window (fridge until 14:00, opening checks until 3 hours after opening, digest until 20:00, shift tomorrow until 22:00), so a late run never sends a stale reminder.
  - **Never twice:** `sent_notifications` has a unique key per person, type and Auckland day (`reminderKey`). The job claims the key before sending, so overlapping runs can't both send. If every push to that person failed for a passing reason, the claim is removed and the next run tries again.
  - **The scheduler:** Supabase `pg_cron` runs `run_reminders()` every 5 minutes. It uses `pg_net` to POST to `/api/cron/reminders` with `Authorization: Bearer <CRON_SECRET>`. The URL and secret live in Supabase Vault (`set_reminder_settings`), never in a migration. The route answers 401 without the right secret (timing-safe compare). Replies are kept for a few hours in `net._http_response`, and runs in `cron.job_run_details`.
    - Why this one: it works the same locally and hosted, and pg_cron and pg_net are on Supabase's free plan. One copy of the rules, in TypeScript next to `web-push`. Vercel Hobby cron only runs once a day, GitHub Actions schedules are often late, and an Edge Function would mean a second copy of the rules in Deno.
  - **Shared devices:** one browser belongs to one person. Turning notifications on takes the browser over from whoever had it, and Sign out removes this device's subscription first.
  - **Tidy up:** subscriptions the push service says are gone (404/410) are deleted. Turned-off accounts get nothing. Push addresses and keys are stripped from the audit log.
  - **Who can do what:** staff see and remove only their own subscriptions and switches. Only the job writes `sent_notifications`. Only managers change opening times and trading days. The API can't call `run_reminders` or `set_reminder_settings`.
- **Verifier pack** (More > Verifier pack, nineteenth migration): every food safety record for a date range as one PDF for the Auckland Council verifier, plus a monthly copy.
  - **What's in it:**
    - a cover (business, sites, dates, who made it and when, totals) and a contents list with page numbers;
    - one part per site. In each part, one section per record with entries in the range, plus every record that must be done daily. Each day is a table: time, values with units, who recorded it, comments;
    - out-of-range readings marked OUT OF RANGE with their corrective action;
    - corrections and later readings (cooling, batter) right under the entry they belong to, and the sign-off (who, when) or NOT SIGNED OFF on each sheet;
    - days with no entry for a daily record listed as NO RECORD, never hidden, counting only the site's trading days. Each says whether anyone chose that site that day. Days the site doesn't trade show as CLOSED (a thin solid box, so it never looks like a gap);
    - supplier deliveries with arrival temperatures, maintenance, incidents and complaints (each appears only if it has entries);
    - the staff sickness record (name, date sick, date cleared, cleared by; no reason, note, hours or certificate);
    - training: everyone who chose a site or had a timesheet in the range (at the chosen site, for a one-site pack), each with all their training up to the end date, whenever it was given (topic, date, trainer, both confirmations). Someone with no training gets "No training recorded".
  - **Format: a PDF made on the server** with `@react-pdf/renderer`, the same file on every phone and printer. We chose it over a print-ready HTML page:
    - iPhone Safari doesn't print CSS page numbers;
    - no browser can fill in "see page 7" in a contents list;
    - the monthly job has no browser to print from.
  - **How the PDF is drawn:**
    - it's drawn twice. The first pass notes the page each heading lands on, and the second prints those numbers in the contents;
    - it's readable in black and white: a thick bar, grey shading and words mark problems, never colour alone;
    - the font is Inter, embedded from `web/assets/fonts/` (OFL licence), because the PDF's built-in fonts can't show macrons ("Māngere").
  - **Who:** managers and the owner pick a site (or all sites) and up to 92 days. The page shows a summary (entries, out of range, days with no record, sheets not signed off), then Open PDF or Download. `/more/verifier-pack/pdf` returns 403 to anyone else and reads everything with the caller's own session, so RLS decides what's in the pack.
  - **Monthly copy:**
    - pg_cron runs `run_verifier_pack()` every day at 14:30 UTC (2:30 or 3:30 am in Auckland). It posts to `/api/cron/verifier-pack` with the same `CRON_SECRET` as reminders, and reuses the reminders URL in Vault with the path swapped, so there's nothing new to set up;
    - the route builds last month's all-sites pack only if `verifier-packs/<year>/<year>-<month>.pdf` isn't there yet. So it's made on the 1st, a failed night is retried the next day, and a stored copy is never replaced;
    - `verifier-packs` is a private bucket that only the owner can read (Storage policy). Only the server key writes, and nobody can change or delete a copy through the API;
    - the owner downloads past copies from the same page, through a 5-minute signed link.
  - The grouping, gap detection, contents and page numbering, and month and file names live in `web/lib/verifier-pack.ts`, with tests. Loading (paged past the 1,000-row limit) is in `web/lib/supabase/verifier-pack.ts`; drawing is in `web/lib/verifier-pack-pdf.tsx`. The cron secret check is shared with reminders in `web/lib/cron-auth.ts`.
- **Payslips** (twenty-first migration): the owner uploads each pay run's PDFs from Crystal Payroll; each person sees only their own.
  - **Payroll codes:** `staff.payroll_code` is the person's code in Crystal Payroll (optional, unique ignoring case, up to 20 letters, numbers, - or _). The owner sets it in More > Staff (`set_staff_payroll_code`; staff rows have no update grant).
    - **Private** (twenty-second migration): only the owner and the person themselves can read it. `staff` now has column-level select grants for every column except `payroll_code`, so coworkers and managers can't read it (`select *` on `staff` is refused too). Codes are read through `staff_payroll_codes()`: everyone's for the owner (and the secret key), only your own for anyone else, nothing for turned-off accounts. **A new column on `staff` needs its own `grant select (column) on staff to authenticated`.**
  - **Upload pay run** (More > Payslips, owner only): pick the pay date and period (default: paid today, for last Monday to Sunday), then drop all the PDFs at once. Each file goes to `/more/payslips/upload`, which matches it to a person and saves an unpublished draft. Matching, in order: the payroll code as a word in the file name, the full name, a first or last name nobody else has, then the text inside the PDF (a labelled "Employee code: E012", or the full name). If two people fit, nobody is guessed.
  - **Review:** each file shows the person, how sure the match is (Sure, Check, No match) and why. Unmatched files need a person picked (the same file is sent again for them). A wrong match is withdrawn ("Matched to the wrong person") and sent again. "Leave out" withdraws a draft. Then **Publish all**.
  - **Notification:** publishing pushes "Your payslip for 10 to 16 Nov is ready" to each person (a new Payslips switch in Settings > Notifications).
  - **My payslips** (More, everyone): your published payslips, newest pay date first. `/payslips/<id>/file` marks the first view (`mark_payslip_viewed`, your own only, so the owner opening one never counts) and redirects to a 5-minute signed link.
  - **Pay runs** (owner): each run with "8 published, 5 opened, 1 not published", who opened theirs and when, Open, Download (saved as `payslip-<name>-<pay date>.pdf`), Withdraw (with a reason) and Publish for leftover drafts.
  - **Leavers' final pay** (twenty-second migration): the owner can upload and publish a payslip for a turned-off person. On `payslips` the general `active_staff_only` trigger is replaced by `payslips_active_staff_only()`, which skips the owner; anyone else (including the secret key, so a future email webhook) is still refused. Matching includes leavers, and the review and the pay run list mark them "turned off". They still can't sign in, so the owner uses Download and sends it another way.
  - **Rules in the database:**
    - `payslips` rows are drafts until `publish_payslips` and are never edited or deleted (triggers, even in the SQL editor). Only published, viewed and withdrawn can each be set once.
    - A mistake is fixed with `withdraw_payslip(id, reason)` and a corrected upload. Withdrawn payslips are hidden from the person but kept.
    - One live payslip per person per run. The file path must be `{staff_id}/{pay_date}-{uuid}.pdf` and the file must be uploaded first.
    - RLS: you see your own once published and not withdrawn (managers too); only the owner sees all, uploads, publishes and withdraws.
  - **Storage:** a private `payslips` bucket (PDF only, 2 MB) in `config.toml` and the migration. The owner uploads and reads everything. Anyone else can only read the file of their own published, not withdrawn payslip. Nobody can replace or delete a file through the API.
  - **The seam for email:** `ingestPayslip(db, source, file, staffHint, run)` in `web/lib/payslips-ingest.ts` is the only way a PDF comes in. A future inbound-email webhook can call it with the admin client and `source: "email"` (allowed with no uploader), after checking its own secret.
  - Matching, period labels, run grouping and file checks are in `web/lib/payslips.ts`, with tests. PDF text is read with `unpdf` (pinned, loaded with Node's own require through `serverExternalPackages`).
- **Security hardening** (slice 8b, migrations 23 to 25). The threat model and which test proves each control: [SECURITY.md](SECURITY.md). What to do when something goes wrong: [docs/RUNBOOK.md](docs/RUNBOOK.md).
  - **Two-step sign-in** (authenticator app codes, TOTP; `[auth.mfa.totp]` in `config.toml`):
    - Owners and managers must set it up at their next sign-in (`/mfa`: a QR code or a typed key, then a 6-digit code). Staff can turn it on in Settings > Two-step sign-in, which also lists your devices, adds a second one (encouraged: phone plus a spare) and removes one.
    - **The database enforces it:** `is_owner()` and `is_manager()` need a token that came with a code (`aal2`). A manager who signed in with only a password and has no authenticator yet gets staff-level access. Anyone who *has* an authenticator gets nothing until they type the code, except their own staff row (so the app can show the code screen); `is_active()` checks this.
    - `mfa_status()` tells the app what to ask for (`enrol`, `verify` or `none`); `getSession()` sends people to `/mfa` until it's `none`.
    - **Lost phone:** the owner uses More > Staff > Manage > **Reset two-step sign-in** (`reset_staff_mfa`): removes their authenticators, signs them out everywhere, and records it in `mfa_resets` (audited). Never on yourself; the owner's own recovery is in the runbook. The Staff page shows "Two-step: 2 devices" or "not set up" for everyone.
    - More > Staff asks the database `is_owner()` before using the secret key, because the staff row says "owner" even for a password-only sign-in.
  - **Rate limits:**
    - Supabase Auth's limits tightened in `config.toml` (sign-in 20 per 5 minutes per IP, link checks 15, one reset email per address per minute); the hosted equivalents are in the runbook's checklist.
    - The app's own limiter, with no paid service: a `rate_limits` table and `check_rate_limit(key, max, window_seconds)`. Signed-in people can only use keys starting `user:<their id>:`, so nobody can use up someone else's allowance. Per-IP keys (`ip:<hash>:...`) are for the server's secret key only, and the IP is hashed so no address is stored. Old rows are pruned nightly (pg_cron).
    - Used for invites, PIN sign-off, two-step codes and setup, saving purchases and leave (with their uploads), payslip uploads, resetting two-step sign-in, and the cron routes (per IP, before the secret is checked). Limits are in `web/lib/rate-limit.ts`. People see "Too many attempts, try again in N minutes."
  - **Security headers:**
    - A Content Security Policy with a new random nonce on every response, set in `proxy.ts` (`web/lib/security-headers.ts`). Only scripts we served run; no `eval`; no inline styles except React's exact `display:none` (by hash). It allows only this site, the Supabase URL, and Sentry when it's on.
    - Every response (`next.config.ts`) also gets Strict-Transport-Security (two years), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` with `frame-ancestors 'none'`, and a Permissions-Policy that turns off what we don't use (camera allowed for "Take photo").
    - **Every page renders per request** (`export const instant = false` and `connection()` in the root layout). Next.js adds the nonce only when it renders the HTML for that request, so a page prebuilt at build time would have every script blocked. Cache Components stays on.
    - The signature pad's inline height became a class, and the app has its own 404 page, because Next.js's built-in one uses inline styles.
  - **Shared tablets:**
    - Settings > This device > "This is a shared device", remembered in this browser only. It shows which mode is on.
    - On a shared device, 15 minutes without a tap, key press or scroll signs the person out, including after the tablet has slept. Signing in restarts the clock.
    - **Sign out** (always, shared or not) removes the push subscription, clears Cache Storage, sessionStorage and the app's localStorage keys (keeping the device settings), then loads `/login` as a full page. If the Back button shows a page from the browser's memory, it reloads (and goes to `/login`).
    - The rules are in `web/lib/shared-device.ts`, with tests.
  - **Database guards** (migration 25): `anon` (signed out) loses every table grant and can't run any of our functions, now and for anything created later (default privileges). `supabase/tests/security_guards.test.sql` fails CI if any table has RLS off, anon has any table grant or function, a security definer function has no fixed `search_path`, or a bucket is public. `npx supabase db lint` runs in CI too.
  - **Error monitoring:** Sentry (`@sentry/nextjs`), only when `SENTRY_DSN` is set (otherwise it's never loaded). `web/lib/sentry-scrub.ts` removes names, emails, IPs, request bodies, cookies, headers and query strings before anything is sent. Errors only: no tracing or session replay. Setup: runbook > Error monitoring.
  - **`/privacy`:** for staff, no sign-in needed: what the app records about them, why, who sees it, how long it's kept, and how to ask for or correct it (Privacy Act 2020). Linked from More and the sign-in page.
  - **CI:** Dependabot (npm in the root and `web/`, and GitHub Actions, weekly), `npm audit --audit-level=high`, CodeQL (`.github/workflows/codeql.yml`), gitleaks secret scanning on every push and PR (`gitleaks.yml`), and every action pinned to a commit SHA.
- **Bottom navigation**: Home, Records, Time, Purchases and More (the menu above).
- **Design** (`web/app/globals.css`): the concept demo's colours as Tailwind theme tokens, Inter and Space Grotesk via `next/font`, and restyled login, picker, records, loading and error screens. Light theme only for now.
- **Tests**: unit tests in `web/lib/*.test.ts` for:
  - NZ dates, record validation, NZ breaks (every boundary, plus agreement with the SQL) and timesheet checks
  - Home (greeting, what's due, count cards, money) and the daily message picker
  - purchases (GST maths, CSV)
  - shared upload and CSV helpers (`uploads.ts`, `csv.ts`)
  - leave validation, the training matrix and the hours CSV
  - staff accounts (statuses, invite checks) and password rules
  - notices (audience, inbox, read counts, form checks, expiry dates)
  - rosters (week dates, the shift form, totals, warnings, next shift, rostered vs actual)
  - trading days (weekdays across daylight saving, the form checks, the wording, and the default matching the migration)
  - reminders (no fridge or opening-check reminders on a non-trading day; Auckland clock in summer and winter, every reminder's window and audience, switches, keys, message wording)
  - payslips (file name matching by code and name with macrons and ambiguity, leavers matched for final pay, download file names, text inside the PDF, period labels across months and years, the default run, run checks matching the migration, file checks, paths, run grouping and the notification wording)
  - security: rate limit keys, IP hashing and messages; two-step codes, setup keys and device advice; the CSP and headers (including the `display:none` hash); the shared-device idle rules and which keys sign out clears; the Sentry scrubber
  - the verifier pack (date ranges and months, rows with corrections and later readings, per-unit limits, gaps from the day a site was added, trading days and CLOSED days, closed and new sites, sickness rows with no medical details, training to date for everyone who worked, contents pages and page numbers)

  pgTAP tests in `supabase/tests/` for checklist, records, shift access, temperature limits, purchases, sick leave, training (including the storage policies), timesheets and NZ breaks, the audit log (including a check that every table is audited), notices (only managers post, edit and archive; staff see only their sites' live notices; reads are your own; acknowledgements can't be undone; acknowledged wording can't be edited), rosters (staff see only their own shifts in published weeks and never another site's; only managers write and publish; no overlaps across sites; turned-off people refused; breaks and paid minutes can't be written; publishing stamps time and person; warnings; copy last week), notifications (own subscriptions and switches only, a shared browser moves to the new person, the reminders log is job-only and unique, opening times are manager only, the scheduler functions can't be called through the API, no push keys in the audit log), trading days (only managers and the owner change them, never directly; at least one day, 1 to 7, no repeats, even from the SQL editor), payslips (staff and managers never see anyone else's payslip or file; drafts are invisible even to their owner; only the owner uploads, publishes and withdraws; withdrawn ones are hidden but kept; no edits or deletes even as postgres; one live payslip per run; payroll codes owner only and unique; the owner can upload, publish and download a turned-off person's final payslip, but nobody else can add one and the leaver still sees nothing; payroll codes readable only by the owner and the person, never from the staff table), verifier packs (only the owner reads the monthly copies; nobody uploads, changes or deletes them through the API; the scheduler can't be called through the API and runs daily), staff accounts (turned-off people see and add nothing; only the owner changes roles or turns accounts off, never their own; a check that every table has the "active accounts only" policy), two-step sign-in (an aal1 manager can't approve, sign off or see all, and an aal2 one can; with an authenticator a password alone opens nothing; staff who opted in; only the owner resets, never their own, audited, signs them out), the rate limiter (the window, the reset, per-person keys only your own, per-IP keys server only) and the security guards (RLS everywhere, nothing for anon, fixed search_path, no public buckets).
- **Test users in the seed**: three local logins (see Daily start), so testing never needs clicking in Studio.
- **CI** (`.github/workflows/ci.yml`): on every PR to `main` it runs TypeScript, ESLint, unit tests, `npm audit`, the RLS tests against a local Supabase (with Storage and the buckets from `config.toml`), the database linter, and a production build. `codeql.yml` and `gitleaks.yml` run alongside; Dependabot opens update PRs weekly.

## Daily start

Run from the repo root unless it says `web/`. Docker Desktop must be running first.

1. `git switch main` then `git pull`, then make a branch for today's work: `git switch -c my-branch`.
2. `npx supabase start` - starts the local database, auth and API in Docker. Prints the URLs and keys.
3. If a migration changed since last time: `npx supabase migration up`. It applies only the new migrations and keeps your data.
   If `supabase/config.toml` changed (for example a new Storage bucket): `npx supabase stop`, then `npx supabase start`, then `npx supabase seed buckets` to create the buckets. None of these wipe your data.
4. If `seed.sql` changed, re-run it in PowerShell:

   ```powershell
   Get-Content supabase/seed.sql -Raw | docker exec -i supabase_db_chutneys-ops psql -U postgres -d postgres
   ```

   The seed is safe to re-run: rows that already exist are skipped or updated. Don't use `npx supabase db reset`; it wipes everything you've tested with.
5. Log in with one of the seeded test users. The password for all three is `password123`, and they are for local testing only. **Owner and manager need two-step sign-in:** the first time, `/mfa` shows a QR code; scan it with any authenticator app (Google Authenticator, Microsoft Authenticator, 1Password...) and type the code. After that, type a code at each sign-in. To start over, remove their authenticator: `docker exec supabase_db_chutneys-ops psql -U postgres -d postgres -c "delete from auth.mfa_factors where user_id in (select id from staff where email = 'manager@test.local');"` After logging in, choose a site: that decides which site's records you can add today. Enter hours on Time.

   | Login | Role | What they can do |
   |---|---|---|
   | `owner@test.local` | owner | everything, including money pages |
   | `manager@test.local` | manager | view and sign off records at every site; add entries at the site they chose; approve hours |
   | `staff@test.local` | staff | add records only at the site they chose today; enter their own hours |

6. Check `web/.env.local` has these three (copy the values from `npx supabase status`):

   ```
   NEXT_PUBLIC_SUPABASE_URL=...         # API URL
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...  # Publishable key
   SUPABASE_SECRET_KEY=...              # Secret key: server only, for invites and turning accounts off
   ```

   For phone notifications, also add these (one time). Generate the keys with `npx web-push generate-vapid-keys` in `web/`, and the secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`:

   ```
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=...     # public: the browser needs it to subscribe
   VAPID_PRIVATE_KEY=...                # server only: signs every push
   VAPID_SUBJECT=mailto:you@example.com # who to contact about the pushes
   CRON_SECRET=...                      # server only: at least 32 characters
   ```

   Then tell the local database where to send the reminders check (one time; it's kept in Vault and survives restarts):

   ```powershell
   docker exec supabase_db_chutneys-ops psql -U postgres -d postgres -c "select set_reminder_settings('http://host.docker.internal:3000/api/cron/reminders', '<your CRON_SECRET>');"
   ```

   Never add `NEXT_PUBLIC_` to the secret key, the VAPID private key or the cron secret. That prefix copies a value into the code sent to every browser, and the secret key skips all row-level security. Invite and password-reset emails land in Mailpit at http://127.0.0.1:54324.
7. `cd web` then `npm run dev`, and open http://localhost:3000. Studio (the database UI) is at http://localhost:54323.
8. Before pushing: `npm test` and `npm run lint` in `web/`, and `npx supabase test db` in the root.
9. End of day: `npx supabase stop`.

## Known follow-ups

- **Security (slice 8b):**
  - **Hosted settings before go-live:** work through docs/RUNBOOK.md > Hosted settings checklist (two-step sign-in, rate limits, buckets, env vars, two-step sign-in on your own dashboard accounts).
  - **GitHub settings:** branch protection and security features can't be set from code. See Branch protection and security settings below.
  - **Recovery codes:** Supabase Auth supports one-time recovery codes for two-step sign-in. Adding them would let a manager recover without the owner.
  - **Restore drill:** do the first backup restore (runbook) once the hosted project has real data, then every three months.
  - **CSP report collection:** violations only show in the browser console. A `report-to` endpoint (or Sentry's CSP reports) would tell us if a real page is blocked.
  - **Sentry source maps:** not uploaded, so browser stack traces are minified. Add `withSentryConfig` and an auth token if the traces are hard to read.
  - **Uploads before a refused save:** if the rate limit refuses a purchase or leave request, its upload is removed straight away. A file uploaded straight to Storage without ever calling the action is only bounded by the bucket's size limit (see Orphaned uploads).

- **Staff accounts:**
  - **Hosted Supabase settings before go-live:** `config.toml` only configures the local stack. In the hosted dashboard:
    - turn off sign-ups;
    - set the minimum password length to 10 and require the current password to change it;
    - paste in the invite and reset templates;
    - set Site URL and the `/auth/confirm` redirect URL to the real domain;
    - set up custom SMTP (Supabase's built-in sender only mails team members, a few an hour).
    Put `SUPABASE_SECRET_KEY` in the host's server environment variables, never with `NEXT_PUBLIC_`.
  - **Email link scanners:** some work email systems (for example Outlook Safe Links) open links to check them, which uses up the one-time token before the person taps it. If that happens, make `/auth/confirm` show a "Continue" button that verifies on POST.
  - **Names and emails:** there's no "edit name" yet, and `staff.email` is a copy taken at invite time. If someone's login email changes in Auth, the staff list still shows the old one.
  - **Sign-out message:** a turned-off person sees "Your account has been turned off" only while their access token (up to 1 hour) is still valid. After that they're simply signed out, and the login form stays vague on purpose.

- **`supabase/snippets/` is committed.** These are Studio scratch queries, and one changes site names and inserts a site. That data is already in `seed.sql`, so delete the folder and git-ignore it, so schema and data changes only happen through migrations and the seed.
- **`web/README.md` is still the create-next-app boilerplate.** Replace it or point it to this README.
- **Root `package.json`** still has the placeholder `test` script and `main` field from `npm init`.
- **Rest of Phase 1:** closing checks (now just another record template), temperature logs (fridge 5 C or below, hot hold 60 C or above), cash-up with manual daily sales, owner dashboard, nightly Slack summary, PWA install (manifest and icons).
- **Midnight cut-off:** records use "today in NZ", so a closing check done after midnight lands on the next day's sheet. Decide how late shifts should count when building closing checks.
- **`cash_ups.cash_date`** still defaults to UTC `current_date` (the same bug fixed for checklists). Fix it in the cash-up slice.
- **Opening checks in `seed.sql` are drafts.** Replace them with Chutneys' real procedures after checking with the owner.
- ~~**Dark mode:** the checklist submit bar uses `bg-white` and looks out of place on dark screens.~~ Done: the design pass made the app light-only, and the submit bar now uses the cream background.
- **Labels:** use "5°C" instead of "5 C".
- **Database types:** generate them with `supabase gen types` to replace the `as` casts in page code.
- **Old checklist tables and `staff_sites`:** no longer used by the app. Drop them in a later migration once nothing needs their history.
- ~~**Fix clock-out screen.**~~ Done: "Needs fixing" on `/time` for managers and the owner.
- **Notices:**
  - **The 30-day rule lives in two places:** `my_recent_site_ids()` in the database and `RECENT_SITE_DAYS` in `web/lib/notices.ts` (for the managers' read counts). A unit test reads the migration and fails if they differ.
  - **Audit log size:** every read and acknowledgement is an audit row (all tables are audited). Fine for a small team; revisit with the audit retention decision.
- **Rosters:**
  - **Edits show straight away:** staff see changes to a published week as soon as a manager saves them, before Re-publish. "Changed since published" only tells the manager to re-publish (and, from slice 7, to notify). Keep a published snapshot if half-finished edits turn out to confuse people.
  - **Pending leave** doesn't warn, only approved leave. Add it if managers want an earlier heads-up.
  - **Positions** are free text with suggestions. Make them a list per site if reports by position are wanted.
  - **Unpublish** isn't possible; a published week can only be changed and re-published.
- **The 14-hour rule lives in two places:** `stale_shift_cutoff()` in the database and `STALE_HOURS` in `web/lib/hours.ts`. It now only decides how long a site choice lasts. Change both together, or move the number into a settings table.
- **Sick leave:**
  - **Add a certificate later:** a certificate can only be attached when asking for leave. Doctors' notes often come afterwards; add an "attach certificate" step for pending or approved requests.
  - **Leave in the hours export:** a leave request is one row with its total hours, even if it runs past the export's end date. Split by day if payroll needs it.
  - **Leave balances and the Employment Leave Act 2026:** nothing tracks how many sick leave hours each person has left. Check the Act's rules with the owner and accountant before building balances.
  - **Notify managers** of new requests and vomiting/diarrhoea reports (part of the Slack work).
- **Training:**
  - **Refreshers:** no "due again" dates yet. Add how often each topic must be refreshed and highlight overdue cells in the matrix.
- **Orphaned uploads** (all three buckets): a file uploaded just before the browser closes stays with no record pointing at it. One scheduled job can clean `invoices`, `leave-documents` and `signatures` (files older than a day that nothing uses).
- **Audit log:**
  - **Retention:** the log keeps everything forever and grows with every record entry. Decide with the owner how long to keep it (for example 7 years, like financial records), then prune in a migration that disables the append-only trigger on purpose.
  - **Health information:** sick leave rows (including vomiting or diarrhoea answers) are copied into the log. Only the owner can read it, but count it as health data under the Privacy Act.
  - **Storage files** (invoices, certificates, signatures) aren't audited, only the database rows that point at them.
- **Purchases:**
  - **Export row limit:** the purchases page and CSV read up to 1,000 rows in one request. Page through like the hours export does if a month ever has more.
  - **Hosted buckets:** `config.toml` only creates the buckets (`invoices`, `leave-documents`, `signatures`) locally. Before go-live, run `npx supabase seed buckets --remote` (or create them in the dashboard with the same settings).
  - **HEIC photos:** "Choose file" with an iPhone HEIC photo only works in Safari (other browsers can't open HEIC to shrink it). The camera button always gives a JPEG.
  - **Xero:** push purchases as bills instead of the CSV once the Xero connection exists.
- **Home and the app:**
  - **Real logo:** replace the placeholder in `web/lib/brand/app-icon.tsx`. The image renderer's built-in font has no bold, so a real logo image will look better than the letter.
  - **Offline:** the service worker (`public/sw.js`) only handles notifications, so the installed app still needs a connection. Chrome no longer requires one to install. Add one later if trucks need to work offline.
  - **Android install button:** Chrome can offer a one-tap "Install" through the `beforeinstallprompt` event. The guide currently shows the menu steps instead.
- **Timesheets:**
  - **Agreed break arrangements per person:** the Employment Relations Act lets an employer and employee agree different break times, or compensation instead of breaks. Everyone gets the default Employment NZ table for now. Add a per-person arrangement (for example a 45-minute unpaid meal, or a paid meal break) for `nz_breaks` or the paid-minutes trigger to use.
  - **Changing someone's approved hours:** the database allows it for managers with a note, but the page only shows "Change" on your own week and on hours waiting for approval. Add a manager view of approved weeks.
  - **How far back:** hours can be entered for any past date. Consider limiting staff to the current pay period, so late entries go through a manager.
  - **Weekly totals for payroll:** a per-person, per-week summary (paid hours, leave) for managers, beyond the owner's CSV.
  - **Old shift rows:** `shifts` still holds old clock-in history, and `fix_clock_out`/`clock_out` remain in the database. Drop them in a later migration once nobody needs that history.
- **Food safety records:**
  - ~~**PIN lockout.**~~ Done: 5 wrong PINs lock sign-off for 15 minutes. `sign_off_sheet` returns a status (`ok`, `wrong_pin`, `locked`) instead of raising for a wrong PIN, because a raised exception would roll back the saved attempt count.
  - **Unlock early:** an owner can't clear a manager's lock yet; they wait 15 minutes or set a new PIN. Add an owner-only unlock if that's too slow in practice.
  - **Browse past days:** managers and the owner can pick a date on `/records`. Staff only see today (plus yesterday's unfinished cooling and batter records). A history view for staff could come later.
  - ~~**Export for the inspector.**~~ Done: More > Verifier pack.
  - ~~**Per-unit min/max.**~~ Done: `"range_from": "unit"` on a number field uses the chosen unit's own limits.
  - **Photos:** attach a photo to an entry (for example a probe reading or a delivery label).
  - **Confirm templates with the owner:** the 13 record templates in `seed.sql` are drafts based on a typical Food Control Plan.

- **Verifier pack:**
  - **Hosted setup:** nothing extra beyond the reminders setup. The migration creates the bucket and the schedule. The PDF routes set `maxDuration` (60 s on demand, 300 s monthly); check the host's plan allows them.
  - ~~**Closed days count as gaps.**~~ Done: trading days per site (Settings). Non-trading days show CLOSED.
  - **Trading days have no history:** only the current setting is kept. Changing a truck's days also changes how earlier days look in a pack made later (a past CLOSED day can become NO RECORD, or the other way). Stored monthly copies keep what was true when they were made. If that matters, keep dated changes (a `site_trading_days` history table) and look up the setting for each date.
  - **One-off closures:** public holidays or a truck off the road for repairs still count as trading days. Add closed dates per site if verifiers ask.
  - **Home's "Due today"** still lists daily records on a non-trading day for someone who chose that site. They're working there anyway, so it's left as is; use `isTradingDay` there if it confuses people.
  - **Late corrections:** the monthly copy is made on the 1st and never replaced. A correction to last month added later is in the database and in packs made on demand, not in the stored copy.
  - ~~**Training only in the range.**~~ Done: everyone who worked in the range, with all their training to date.
  - **Training refreshers:** the pack lists every record but doesn't say which are out of date. Add refresher periods per topic (see Training) and mark overdue ones.
  - **Keeping copies:** monthly copies are kept forever. Decide with the owner how long to keep them (food control plan records: at least 4 years).
- **Payslips:**
  - **Hosted setup:** nothing extra; the migration creates the bucket.
  - ~~**Leavers' final payslip.**~~ Done: the owner uploads and publishes it, then downloads it from More > Payslips and sends it on (email it themselves; the app doesn't send email yet).
  - **Email webhook and leavers:** the exemption is for the owner only. A future email webhook (secret key) can't add a leaver's final payslip; the owner uploads it by hand.
  - **Inbound email:** not built. The webhook needs its own secret check, and somewhere to keep unmatched files (today they're never stored, because there's no person's folder to put them in), for example an `unmatched/` folder the owner reviews.
  - **Stray files:** if saving the row fails after the PDF uploaded, the file stays in the bucket with nothing pointing at it (only the owner could ever read it). Add `payslips` to the orphaned uploads clean-up job.
  - ~~**Payroll codes are visible like emails.**~~ Done: column grants plus `staff_payroll_codes()`. They are still in the audit log (owner only), like every staff change.
  - **Long history:** the owner's list loads the latest 300 payslips. Page by run if that's ever not enough.
- **Notifications:**
  - **Hosted setup before go-live:** add the four env vars (VAPID keys, `VAPID_SUBJECT`, `CRON_SECRET`) to the host, then run `select set_reminder_settings('https://<your domain>/api/cron/reminders', '<CRON_SECRET>');` once in the hosted SQL editor. iPhone testing needs this HTTPS deploy.
  - **Free Supabase projects pause** after a week without activity, and paused means no reminders. Daily use keeps it awake.
  - **Audit log size:** every reminder sent is an audit row (`sent_notifications` is audited, like every table). Revisit with the audit retention decision.
  - **Not yet notified:** new leave requests and vomiting/diarrhoea reports to managers (the 17:00 digest counts pending leave), out-of-range readings, closing checks.
  - **Opening times** are one time per site for every day. Add per-weekday times if trucks keep different hours.
  - **Sign-out:** only the More menu's Sign out removes the device. A session that simply expires keeps the device until the next person turns notifications on there.

## Design plan

- **Home screen:** built (see What's built so far). The logo is still a placeholder green "C" until the owners send the real one.
- **Money pages are owner only:** cash-ups, daily sales and anything else with money in it. The database already enforces this (`is_owner()` on `cash_ups` and `daily_sales`), so managers can't see it even through the API.
  - Exception: **purchases**. Managers see all purchases, because they approve staff spending and pay people back. The monthly export is still owner only.
- **Mobile first:** big tap targets (48px or more), the bottom tab bar for the main sections, and the current site always visible at the top.

## The idea

Do not rebuild the till. Build an operations hub that sits on top of the tools Chutneys already uses and adds what they do not have in one place:

- Open and close checklists, saved with time and staff name
- Food safety logs (fridge and hot-hold temperatures, fixes when out of range), matching the MPI food control plan records
- Cash-up with automatic cash difference
- Owner view across every site
- Nightly summary to Slack or WhatsApp
- Later: sales from the till, delivery app reports, stock and waste, truck locations, an "ask the app" assistant

## Stack

| Part | Choice | Why |
|---|---|---|
| Database, logins, file storage | Supabase (Postgres), Sydney region | Free while building, real SQL, row-level security per site |
| App | Next.js as an installable web app (PWA) | One codebase for phones and laptops, no app store, can work offline for trucks |
| Integrations and AI | Python (FastAPI) | Webhooks, report imports, scheduled summaries, AI agent |
| Hosting | Vercel or Netlify | Free to start |
| Messages | Slack first, WhatsApp later | Slack is free for alerts; WhatsApp costs a little per message |
| Dev tools | VS Code + Claude Code, GitHub, GitHub Actions, Docker | Same skills employers ask for |

## Phases

1. **Discovery** - meet the owner and a manager per site, collect paper forms, find out the till and delivery apps. Get written OK to show the project on CV and GitHub.
2. **MVP** - logins and roles, sites and trucks, checklists, temperature logs, cash-up with manual sales, owner dashboard, nightly Slack summary. Pilot on one truck.
3. **Phase 2** - sales from the till, delivery report imports, clock in and out, stock and waste.
4. **Phase 3** - AI assistant in Slack or WhatsApp, prep forecasts using weather, one order screen via an aggregator if they want it.

## Integration notes (researched Nov 2026)

- **Till:** Loyverse has an open API with webhooks (easy). Lightspeed Restaurant needs partner approval through their account manager (hard). Square card payments do not work in NZ.
- **Uber Eats / DoorDash:** direct APIs need partner approval and an NDA. Start by importing their payout reports. Aggregators (Next Order, MOBI, Deliverect) can merge orders later.
- **Xero:** free Starter tier (5 connections, 1,000 calls a day) is enough for one business.
- **WhatsApp:** charged per message (NZ utility about US$0.011, marketing about US$0.073). Needs a dedicated number and Meta business verification.
- **Slack free plan:** 90 days of visible history, max 10 apps. The database is the real record, Slack only carries alerts.
- **Privacy Act 2020:** storing data with an overseas cloud provider acting for you is not a disclosure under IPP 12, but the business stays responsible for it. Keep staff data to the minimum.

## Accounts to create

| Account | When | Cost |
|---|---|---|
| GitHub (personal) | Day 1 | Free |
| Supabase (sign in with GitHub) | Day 1 | Free while building, about US$25/month at go-live |
| Vercel or Netlify | When a live link is needed | Free to start |
| Slack workspace | When building the nightly summary | Free |
| Meta Business + WhatsApp number | Only if they pick WhatsApp | Per message |
| Till back-office access | After the owner agrees | Their existing plan |

## Questions for the owner

1. Which till does each site use? Same everywhere?
2. Which delivery apps, at which sites?
3. How are checks, temperatures and cash-ups recorded today?
4. What is used for rosters, payroll and accounts?
5. Do staff use WhatsApp or Slack more?
6. What one thing do you want to see every night without calling anyone?
7. Can one truck pilot the app for two weeks?
8. Site check: restaurant, Orewa cafe, Urban Roast in Grey Lynn, four trucks? Confirm the list.

Owner answers (fill in after the meeting):

-

## Branch protection and security settings

GitHub settings can't be set from code, so set these by hand once (and check them after changing the repo's owner or visibility).

**Protect `main`** (repository Settings > Rules > Rulesets > New branch ruleset, or Settings > Branches > Add rule):

1. Name it `main`, enforcement **Active**, target branch `main` (Include default branch).
2. **Require a pull request before merging.** Working alone, set required approvals to 0; the point is that every change goes through a PR and its checks. With a second developer, require 1 approval and "Dismiss stale approvals when new commits are pushed".
3. **Require status checks to pass**, with "Require branches to be up to date before merging". Add the checks (they appear after they've run once): `ci` (CI), `analyze` (CodeQL), `gitleaks` (Secret scan).
4. **Block force pushes** and **Restrict deletions**.
5. **Bypass list: empty**, so the rules apply to admins too.

**Security features** (Settings > Advanced Security, or Code security and analysis):

- **Dependabot alerts** and **Dependabot security updates**: on. (`.github/dependabot.yml` does the weekly version updates.)
- **Secret scanning** and **Push protection**: on. GitHub's own scanner blocks a push that contains a known key format, before gitleaks even runs.
- **Code scanning:** CodeQL results from `codeql.yml` appear here. Free for public repositories; a private repository needs GitHub Code Security.
- **Private vulnerability reporting:** on (SECURITY.md tells people to use it).

**Actions** (Settings > Actions > General): allow only actions from GitHub and verified creators plus the ones we use, and set the default `GITHUB_TOKEN` permission to **read**.

## Rules for this repo

- **Every new business table must call `enable_audit()` in its migration**, for example `select enable_audit('stock_counts');`. The pgTAP test `supabase/tests/audit.test.sql` fails if a table in `public` has no audit trigger. Only tables holding secrets (like `staff_pins`) are left out, by adding them to that test's allowlist with a comment saying why.
- When you add a table, also give it friendly names in `web/lib/audit.ts` (area, thing, any new columns) so the audit page reads well.
- **A new table with rows about a person** (who did it, or who it's for) also gets the `active_staff_only` trigger, for example `create trigger active_staff_only before insert on stock_counts for each row execute function active_staff_only('counted_by', 'stock counts');`.
- **Every new table must also call `enable_active_only()`**, for example `select enable_active_only('stock_counts');`, so turned-off accounts can't read or write it. `supabase/tests/staff_accounts.test.sql` fails if a table in `public` is missing it.
- **The secret key (`SUPABASE_SECRET_KEY`) is only used in `web/lib/supabase/admin.ts`**, which imports `server-only`. Check the caller is an active owner with their own session *before* using it. Two other callers, each checked a different way:
  - `web/lib/notify.ts`, only after the action's own database call succeeded under the person's session (that success proves they were allowed to post, publish or decide);
  - `/api/cron/reminders` and `/api/cron/verifier-pack`, only after they checked `CRON_SECRET`;
  - `limitIp()` in `web/lib/supabase/rate-limit.ts`, which only counts a per-IP rate limit (before the cron secret is checked).

- **Security definer functions** need `set search_path = public` (or another fixed path), and `revoke execute ... from public, anon` with an explicit grant to `authenticated` only if signed-in people should call them. `supabase/tests/security_guards.test.sql` fails otherwise.
- **Owner and manager checks** use `is_owner()` / `is_manager()` in the database (they include two-step sign-in). In the app, `me.role` is for showing the right screens; anything that then uses the secret key must ask the database `is_owner()` first, as More > Staff does.
- **Expensive or sensitive actions** (sending email, uploads, anything with a PIN or code) call `limitPerson(supabase, userId, "<limit>")` first, with the limit added to `LIMITS` in `web/lib/rate-limit.ts`.
- **No inline styles or scripts** in pages: the Content Security Policy blocks them. Use Tailwind classes, and `next/script` with the nonce from `headers().get("x-nonce")` if a script is ever needed. New outside services (fonts, analytics, a payments iframe) must be added to `web/lib/security-headers.ts` on purpose.
- Real Chutneys data never goes in this repo. Use the sample seed data only.
- Secrets (Supabase keys, Slack webhooks) go in `.env`, which is git-ignored.

## Files

- `CLAUDE.md` - project context for Claude Code
- `SECURITY.md` - what we protect, from whom, how, and how to report a vulnerability
- `docs/RUNBOOK.md` - hosted settings, restoring a backup, rotating secrets, owner recovery, breach response
- `supabase/migrations/` - database tables, RLS policies and functions, applied in date order
- `supabase/seed.sql` - sample data matching the concept demo, record templates and local test users
- `supabase/tests/` - pgTAP tests for the RLS rules and food safety records
- `web/` - the Next.js app
- `.github/workflows/ci.yml` - CI checks on pull requests
- `.github/workflows/codeql.yml`, `gitleaks.yml` - code scanning and secret scanning
- `.github/dependabot.yml` - weekly dependency update PRs
- `.gitattributes` - keeps line endings as LF for everyone
- `demo-source/` - the concept demo screens (they run inside Claude's design canvas, kept here for reference)
