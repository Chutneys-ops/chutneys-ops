# Chutneys Ops

A side project to learn full-stack development: one operations app for the Chutneys business (a restaurant, a cafe and four food trucks in Auckland).

Status: Phase 1 MVP in progress. Concept demo shown to the owner on 16 Nov 2026.

## What's built so far

- **Database** (`supabase/migrations/`): all Phase 1 tables (sites, staff, shifts, checklists, temperature units and readings, cash-ups, daily sales, alerts) with row-level security on every table.
- **Access by shift** (fourth migration): staff move between sites, so what you can do depends on where you're working today, not on a fixed list.
  - Picking a site clocks you in (`start_shift`). Clock-in and clock-out times come from the database clock, and nobody can have two open shifts.
  - Staff see and add records only at the site they're clocked in at.
  - Managers and the owner see records at every site and can sign off anywhere. They need to be clocked in to add entries.
  - Money (cash-ups, daily sales) is owner only; managers can't see it.
  - Forgotten clock-outs (fifth migration): a shift open for more than 14 hours no longer counts as being on shift. The next clock-in closes it with zero hours and `needs_review`, and staff see "Your last shift at X was never clocked out".
  - Managers fix it on `/time` under "Needs fixing": pick the real clock-out in Auckland time and add a required note. `fix_clock_out` records who fixed it and clears `needs_review`.
  - `staff_sites` is no longer used for access. It's kept for now as history.
- **Login**: email and password through Supabase Auth, with `web/proxy.ts` refreshing the session on every request. `/` goes to `/start`.
- **Site picker** (`/start`): "Where are you working today?" with a big card per site. Tapping one clocks you in and opens Records. The header shows "Working at …" with Change site and Clock out.
- **Food safety records** (`/records`, third migration): record types from templates in the database:
  - opening checks for each kind of site
  - fridge temperatures, cooking, cooling, reheating, hot holding, cold display, transport, batter fermentation and cleaning
  - deliveries, maintenance, incidents and complaints

  How the records work:
  - The site comes from your open shift, not the URL. Managers and the owner get a site and date filter.
  - Entries can never be edited or deleted. Mistakes are fixed with a correction entry, and every entry can have Comments.
  - A database trigger checks every value against its template. Out-of-range readings, or a "No" on a check that should be "Yes", are flagged and need a corrective action.
  - Cooling and batter readings taken hours later are added as follow-up entries.
  - A manager or owner signs off each day's sheet with a 4-digit PIN, set under More and stored only as a hash. Five wrong PINs lock sign-off for 15 minutes.
- **Opening checks**: the old opening checklist is now a record template per kind of site (`opening_checks_truck`, `_cafe`, `_restaurant`). The checklist pages are gone; the old checklist tables are still in the database.
- **Purchases** (`/purchases`, seventh migration): groceries and supplies bought for a site, with the invoice for GST.
  - Add a purchase where you're clocked in: supplier, what was bought, total incl GST, GST included yes/no, how it was paid (company card, till cash, own money) and comments.
  - The database works out the GST (`round(total * 3 / 23, 2)`, or 0 when the supplier isn't GST registered), so nobody can type it wrong.
  - Every purchase needs an invoice (photo or PDF) or a "no receipt" reason. A check constraint enforces it.
  - "Take photo" opens the camera; "Choose file" takes a photo or PDF (two buttons because Android hides the file picker when the camera option is set). Photos are shrunk in the browser to 1600 px wide JPEG (about 200-400 KB) before uploading, which also strips GPS data.
  - Invoices live in a private Storage bucket, `invoices` (5 MB, images and PDF), at `{site_id}/{yyyy}/{mm}/{uuid}.{ext}`. Storage policies: upload only into the folder of the site you're on shift at; read your own uploads; managers and the owner read all. A purchase can only point at your own file in that site's folder. Files are shown with short-lived signed URLs through `/purchases/invoice/<id>`.
  - The file is uploaded first, then the purchase is saved. If saving fails, the file is deleted (allowed only for your own file that no purchase uses).
  - Nobody can edit or delete a purchase. Staff see their own; managers and the owner see all, with site and month filters.
  - "Owed to staff": own-money purchases not yet paid back. A manager or the owner taps "Mark paid back" (`mark_reimbursed`). You can't mark your own, except the owner.
  - The owner gets "Export month": a CSV for the accountant (date, site, supplier, description, total, GST, payment method, who bought, invoice link, no-receipt reason). The route checks the role on the server, so anyone else gets 403.
- **Per-unit temperature limits** (sixth migration): fridge readings are checked against each unit's own `min_c`/`max_c` (fridges 0 to 5 C, freezers -25 to -15 C). The seed adds sample fridges and freezers at every site.
- **Time** (`/time`): your current shift ("On shift at Orewa Cafe since 9:02 am") and this week's shifts with total hours. Missing clock-outs show as "your manager will fix it" and count zero hours. Managers and the owner also see the "Needs fixing" list.
- **Bottom navigation**: Records, Time, Purchases and More (PIN and sign out).
- **Design** (`web/app/globals.css`): the concept demo's colours as Tailwind theme tokens, Inter and Space Grotesk via `next/font`, and restyled login, picker, records, loading and error screens. Light theme only for now.
- **Tests**: unit tests for NZ dates, record validation, shift hours and purchases (GST maths, CSV, file checks) in `web/lib/*.test.ts`; pgTAP tests for checklist, records, shift-access, temperature-limit, purchase and invoice-storage rules (`supabase/tests/`).
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
5. Log in with one of the seeded test users. The password for all three is `password123`, and they are for local testing only. After logging in, pick a site: that clocks you in there. Clock out from the header when you're done testing.

   | Login | Role | What they can do |
   |---|---|---|
   | `owner@test.local` | owner | everything, including money pages |
   | `manager@test.local` | manager | view and sign off records at every site; add entries where clocked in |
   | `staff@test.local` | staff | add records only at the site they're clocked in at |

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
- **The 14-hour rule lives in two places:** `stale_shift_cutoff()` in the database and `STALE_HOURS` in `web/lib/hours.ts`. Change both together, or move the number into a settings table.
- **Night shifts longer than 14 hours** would be treated as forgotten. Fine for now; revisit if a site ever runs one.
- **Purchases:**
  - **Orphaned invoice files:** if the browser closes between uploading the file and saving the purchase, the file stays in Storage with no purchase. Clean these up with a scheduled job later (files older than a day that no purchase points at).
  - **Hosted bucket:** `config.toml` only creates the `invoices` bucket locally. Before go-live, run `npx supabase seed buckets --remote` (or create it in the dashboard with the same settings).
  - **HEIC photos:** "Choose file" with an iPhone HEIC photo only works in Safari (other browsers can't open HEIC to shrink it). The camera button always gives a JPEG.
  - **Xero:** push purchases as bills instead of the CSV once the Xero connection exists.
- **Shift reports for payroll:** hours per person per week across all sites, for managers and the owner.
- **Food safety records:**
  - ~~**PIN lockout.**~~ Done: 5 wrong PINs lock sign-off for 15 minutes. `sign_off_sheet` returns a status (`ok`, `wrong_pin`, `locked`) instead of raising for a wrong PIN, because a raised exception would roll back the saved attempt count.
  - **Unlock early:** an owner can't clear a manager's lock yet; they wait 15 minutes or set a new PIN. Add an owner-only unlock if that's too slow in practice.
  - **Browse past days:** managers and the owner can pick a date on `/records`. Staff only see today (plus yesterday's unfinished cooling and batter records). A history view for staff could come later.
  - **Export for the inspector:** a printable or PDF view of a date range for MPI or council verification.
  - ~~**Per-unit min/max.**~~ Done: `"range_from": "unit"` on a number field uses the chosen unit's own limits.
  - **Photos:** attach a photo to an entry (for example a probe reading or a delivery label).
  - **Confirm templates with the owner:** the 13 record templates in `seed.sql` are drafts based on a typical Food Control Plan.

## Design plan

- **Home screen:** a proper home screen with Chutneys branding later. For now `/` goes straight to the site picker.
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
- Later: sales from the till, delivery app reports, clock in and out, stock and waste, truck locations, an "ask the app" assistant

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
