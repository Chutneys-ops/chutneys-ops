# Chutneys Ops

A side project to learn full-stack development: one operations app for the Chutneys business (a restaurant, a cafe and four food trucks in Auckland).

Status: Phase 1 MVP in progress. Concept demo shown to the owner on 16 Nov 2026.

## What's built so far

- **Database** (`supabase/migrations/`): all Phase 1 tables (sites, staff, staff_sites, shifts, checklists, temperature units and readings, cash-ups, daily sales, alerts) with row-level security on every table. Staff see only their sites; owners see everything.
- **Opening checklist rules** (second migration): staff can start, tick, untick and submit today's run at their own sites. A submitted run is locked. "Today" is the Pacific/Auckland date.
- **Login**: email and password through Supabase Auth, with `web/proxy.ts` refreshing the session on every request.
- **Sites list** (`/sites`): your sites with today's opening checklist status (not started, in progress, done).
- **Opening checklist** (`/sites/[siteId]`): tick items, see who ticked what and when, submit once everything is ticked. Has loading and error screens.
- **Food safety records** (`/sites/[siteId]/records`, third migration): 13 record types from templates in the database (fridge temperatures, cooking, cooling, reheating, hot holding, cold display, transport, batter fermentation, cleaning, deliveries, maintenance, incidents, complaints).
  - Entries can never be edited or deleted. Mistakes are fixed with a correction entry and a note.
  - A database trigger checks every value against its template. Out-of-range readings are flagged and need a corrective action.
  - Cooling and batter readings taken hours later are added as follow-up entries.
  - A manager or owner signs off each day's sheet with a 4-digit PIN, set in `/settings` and stored only as a hash.
- **Bottom navigation**: Sites, Records, Time and Purchases (the last two are "Coming soon").
- **Design** (`web/app/globals.css`): the concept demo's colours as Tailwind theme tokens, Inter and Space Grotesk via `next/font`, an app header, and restyled login, sites, checklist, loading and error screens. Light theme only for now.
- **Tests**: unit tests for NZ dates, checklist status and record validation (`web/lib/*.test.ts`), pgTAP tests for the checklist and food safety records rules (`supabase/tests/`).
- **Test users in the seed**: three local logins (see Daily start), so testing never needs clicking in Studio.
- **CI** (`.github/workflows/ci.yml`): on every PR to `main` it runs TypeScript, ESLint, unit tests, the RLS tests against a local Supabase, and a production build.

## Daily start

Run from the repo root unless it says `web/`. Docker Desktop must be running first.

1. `git switch main` then `git pull`, then make a branch for today's work: `git switch -c my-branch`.
2. `npx supabase start` - starts the local database, auth and API in Docker. Prints the URLs and keys.
3. If a migration changed since last time: `npx supabase migration up`. It applies only the new migrations and keeps your data.
4. If `seed.sql` changed, re-run it in PowerShell:

   ```powershell
   Get-Content supabase/seed.sql -Raw | docker exec -i supabase_db_chutneys-ops psql -U postgres -d postgres
   ```

   The seed is safe to re-run: rows that already exist are skipped or updated. Don't use `npx supabase db reset`; it wipes everything you've tested with.
5. Log in with one of the seeded test users. The password for all three is `password123`, and they are for local testing only.

   | Login | Role | Sites |
   |---|---|---|
   | `owner@test.local` | owner | every site |
   | `manager@test.local` | manager | Truck - Sandringham, Orewa Cafe |
   | `staff@test.local` | staff | Truck - Sandringham |

6. Check `web/.env.local` has `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (copy them from `npx supabase status`).
7. `cd web` then `npm run dev`, and open http://localhost:3000. Studio (the database UI) is at http://localhost:54323.
8. Before pushing: `npm test` and `npm run lint` in `web/`, and `npx supabase test db` in the root.
9. End of day: `npx supabase stop`.

## Known follow-ups

- **`supabase/snippets/` is committed.** These are Studio scratch queries, and one changes site names and inserts a site. That data is already in `seed.sql`, so delete the folder and git-ignore it, so schema and data changes only happen through migrations and the seed.
- **`web/README.md` is still the create-next-app boilerplate.** Replace it or point it to this README.
- **Root `package.json`** still has the placeholder `test` script and `main` field from `npm init`.
- **Rest of Phase 1:** closing checklist, temperature logs (fridge 5 C or below, hot hold 60 C or above), cash-up with manual daily sales, owner dashboard, nightly Slack summary, PWA install (manifest and icons).
- **Midnight cut-off:** checklist rules use "today in NZ", so a closing checklist that runs past midnight can't be submitted. Handle this when building closing checklists.
- **`cash_ups.cash_date`** still defaults to UTC `current_date` (the same bug fixed for checklists). Fix it in the cash-up slice.
- **Checklist items in `seed.sql` are drafts.** Replace them with Chutneys' real procedures after checking with the owner.
- ~~**Dark mode:** the checklist submit bar uses `bg-white` and looks out of place on dark screens.~~ Done: the design pass made the app light-only, and the submit bar now uses the cream background.
- **Labels:** use "5°C" instead of "5 C".
- **Database types:** generate them with `supabase gen types` to replace the `as` casts in page code.
- **Saving state:** show "saving..." on checklist rows while a tick is being saved (`useFormStatus`).
- **Food safety records:**
  - **PIN lockout:** lock sign-off for a while after several wrong PINs. A raised error rolls back any attempt counter in the same call, so the counter needs a different design, for example returning a result instead of raising.
  - **Browse past days:** the records pages only show today (plus yesterday's unfinished cooling and batter records).
  - **Export for the inspector:** a printable or PDF view of a date range for MPI or council verification.
  - **Per-unit min/max:** check fridge readings against each unit's own `min_c`/`max_c` in `temp_units`, not only the template's limit.
  - **Photos:** attach a photo to an entry (for example a probe reading or a delivery label).
  - **Confirm templates with the owner:** the 13 record templates in `seed.sql` are drafts based on a typical Food Control Plan.

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
