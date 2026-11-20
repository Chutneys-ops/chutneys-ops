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
- **Login**: email and password through Supabase Auth, with `web/proxy.ts` refreshing the session on every request. Signing in always lands on Home (never a "next" or last-visited page). `/` redirects to `/home`, and refreshing a page stays on it.
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
- **More menu** (`/more`): Leave, Training, Settings and Sign out. Managers also see Leave requests, Staff sickness and Training matrix; the owner also sees Export hours and leave, and Audit log. More stays highlighted on its sub-pages.
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
- **Bottom navigation**: Home, Records, Time, Purchases and More (the menu above).
- **Design** (`web/app/globals.css`): the concept demo's colours as Tailwind theme tokens, Inter and Space Grotesk via `next/font`, and restyled login, picker, records, loading and error screens. Light theme only for now.
- **Tests**: unit tests in `web/lib/*.test.ts` for:
  - NZ dates, record validation, NZ breaks (every boundary, plus agreement with the SQL) and timesheet checks
  - Home (greeting, what's due, count cards, money) and the daily message picker
  - purchases (GST maths, CSV)
  - shared upload and CSV helpers (`uploads.ts`, `csv.ts`)
  - leave validation, the training matrix and the hours CSV

  pgTAP tests in `supabase/tests/` for checklist, records, shift access, temperature limits, purchases, sick leave, training (including the storage policies), timesheets and NZ breaks, and the audit log, including a check that every table is audited.
- **Test users in the seed**: three local logins (see Daily start), so testing never needs clicking in Studio.
- **CI** (`.github/workflows/ci.yml`): on every PR to `main` it runs TypeScript, ESLint, unit tests, the RLS tests against a local Supabase (with Storage and the buckets from `config.toml`), and a production build.

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
5. Log in with one of the seeded test users. The password for all three is `password123`, and they are for local testing only. After logging in, choose a site: that decides which site's records you can add today. Enter hours on Time.

   | Login | Role | What they can do |
   |---|---|---|
   | `owner@test.local` | owner | everything, including money pages |
   | `manager@test.local` | manager | view and sign off records at every site; add entries at the site they chose; approve hours |
   | `staff@test.local` | staff | add records only at the site they chose today; enter their own hours |

6. Check `web/.env.local` has `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (copy them from `npx supabase status`).
7. `cd web` then `npm run dev`, and open http://localhost:3000. Studio (the database UI) is at http://localhost:54323.
8. Before pushing: `npm test` and `npm run lint` in `web/`, and `npx supabase test db` in the root.
9. End of day: `npx supabase stop`.

## Known follow-ups

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
- **The 14-hour rule lives in two places:** `stale_shift_cutoff()` in the database and `STALE_HOURS` in `web/lib/hours.ts`. It now only decides how long a site choice lasts. Change both together, or move the number into a settings table.
- **Sick leave:**
  - **Add a certificate later:** a certificate can only be attached when asking for leave. Doctors' notes often come afterwards; add an "attach certificate" step for pending or approved requests.
  - **Leave in the hours export:** a leave request is one row with its total hours, even if it runs past the export's end date. Split by day if payroll needs it.
  - **Leave balances and the Employment Leave Act 2026:** nothing tracks how many sick leave hours each person has left. Check the Act's rules with the owner and accountant before building balances.
  - **Notify managers** of new requests and vomiting/diarrhoea reports (part of the Slack work).
- **Training:**
  - **Refreshers:** no "due again" dates yet. Add how often each topic must be refreshed and highlight overdue cells in the matrix.
  - **Leavers:** the matrix lists every staff row. Add an `active` flag to staff when someone leaves.
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
  - **Offline:** there's no service worker, so the installed app needs a connection. Chrome no longer requires one to install. Add one later if trucks need to work offline.
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
  - **Export for the inspector:** a printable or PDF view of a date range for MPI or council verification.
  - ~~**Per-unit min/max.**~~ Done: `"range_from": "unit"` on a number field uses the chosen unit's own limits.
  - **Photos:** attach a photo to an entry (for example a probe reading or a delivery label).
  - **Confirm templates with the owner:** the 13 record templates in `seed.sql` are drafts based on a typical Food Control Plan.

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

## Rules for this repo

- **Every new business table must call `enable_audit()` in its migration**, for example `select enable_audit('stock_counts');`. The pgTAP test `supabase/tests/audit.test.sql` fails if a table in `public` has no audit trigger. Only tables holding secrets (like `staff_pins`) are left out, by adding them to that test's allowlist with a comment saying why.
- When you add a table, also give it friendly names in `web/lib/audit.ts` (area, thing, any new columns) so the audit page reads well.

- Real Chutneys data never goes in this repo. Use the sample seed data only.
- Secrets (Supabase keys, Slack webhooks) go in `.env`, which is git-ignored.

## Files

- `CLAUDE.md` - project context for Claude Code
- `supabase/migrations/` - database tables, RLS policies and functions, applied in date order
- `supabase/seed.sql` - sample data matching the concept demo, record templates and local test users
- `supabase/tests/` - pgTAP tests for the RLS rules and food safety records
- `web/` - the Next.js app
- `.github/workflows/ci.yml` - CI checks on pull requests
- `.gitattributes` - keeps line endings as LF for everyone
- `demo-source/` - the concept demo screens (they run inside Claude's design canvas, kept here for reference)
