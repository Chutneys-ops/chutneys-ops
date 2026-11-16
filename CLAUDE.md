# Project context for Claude Code

This is Chutneys Ops, a learning side project: an operations app for a small Auckland food business with a restaurant, a cafe and four food trucks. Read README.md for the full plan, phases and integration notes.

## About me

- I am learning: explain what you change and why, in short plain steps.
- Comfortable with C, C++ and Python. Newer to TypeScript, React and Next.js.

## Stack

- Supabase (Postgres, auth, storage), Sydney region
- Next.js app router, TypeScript, installable PWA, mobile first
- Python FastAPI service for integrations, scheduled jobs and the AI assistant
- GitHub Actions for tests and deploys, Docker for the Python service

## Conventions

- Database changes go through migration files in `supabase/migrations/`, never by clicking in the dashboard.
- Every table has row-level security on. Staff see only their sites (via `staff_sites`); owners see everything.
- Money is stored as `numeric(10,2)` in NZD. Times are `timestamptz`, shown in Pacific/Auckland.
- Temperatures in degrees Celsius. Fridges must read 5 C or below, hot hold 60 C or above.
- No real business data in the repo. Use `supabase/seed.sql` sample data.
- Write tests alongside features. Keep secrets in `.env` (git-ignored).

## Current phase

Phase 1 MVP: sites, staff and roles, checklists, temperature logs, cash-up with manual daily sales, owner dashboard, nightly Slack summary.
