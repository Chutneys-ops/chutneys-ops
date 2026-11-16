-- Chutneys Ops - Phase 1 schema (Supabase / Postgres)
-- Run in the Supabase SQL editor, or save as a migration.

create extension if not exists "pgcrypto";

-- Sites: restaurant, cafe and trucks
create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('restaurant', 'cafe', 'truck')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Staff profile, one per Supabase auth user
create table staff (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  role text not null check (role in ('staff', 'manager', 'owner')),
  created_at timestamptz not null default now()
);

-- Which sites each staff member can see and work at
create table staff_sites (
  staff_id uuid not null references staff (id) on delete cascade,
  site_id uuid not null references sites (id) on delete cascade,
  primary key (staff_id, site_id)
);

create table shifts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  staff_id uuid not null references staff (id),
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  location_note text
);

-- Checklist items are defined per kind of site
create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  site_kind text not null check (site_kind in ('restaurant', 'cafe', 'truck')),
  checklist text not null check (checklist in ('opening', 'closing')),
  label text not null,
  sort_order int not null default 0,
  needs_photo boolean not null default false
);

create table checklist_runs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  checklist text not null check (checklist in ('opening', 'closing')),
  run_date date not null default current_date,
  due_at timestamptz,
  submitted_at timestamptz,
  submitted_by uuid references staff (id),
  unique (site_id, checklist, run_date)
);

create table checklist_ticks (
  run_id uuid not null references checklist_runs (id) on delete cascade,
  item_id uuid not null references checklist_items (id),
  ticked_at timestamptz not null default now(),
  ticked_by uuid not null references staff (id),
  photo_url text,
  primary key (run_id, item_id)
);

-- Fridges, freezers and hot-hold units at each site
create table temp_units (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  name text not null,
  min_c numeric(4,1),
  max_c numeric(4,1)
);

create table temp_readings (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references temp_units (id),
  reading_c numeric(4,1) not null,
  taken_at timestamptz not null default now(),
  taken_by uuid not null references staff (id),
  out_of_range boolean not null default false,
  fix_action text
);

create table cash_ups (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  cash_date date not null default current_date,
  sales_total numeric(10,2) not null,
  eftpos_total numeric(10,2) not null,
  float_amount numeric(10,2) not null,
  cash_expected numeric(10,2) generated always as (sales_total - eftpos_total + float_amount) stored,
  cash_counted numeric(10,2) not null,
  variance numeric(10,2) generated always as (cash_counted - (sales_total - eftpos_total + float_amount)) stored,
  note text,
  submitted_by uuid not null references staff (id),
  submitted_at timestamptz not null default now(),
  unique (site_id, cash_date)
);

-- One row per site, day and channel. source says where the number came from.
create table daily_sales (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  sale_date date not null,
  channel text not null check (channel in ('in_store', 'uber_eats', 'doordash', 'delivereasy', 'website')),
  amount numeric(10,2) not null,
  source text not null default 'manual' check (source in ('manual', 'pos', 'import')),
  unique (site_id, sale_date, channel)
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  kind text not null check (kind in ('temp', 'cash', 'checklist', 'other')),
  message text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references staff (id)
);

-- Row-level security ------------------------------------------------------

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and role = 'owner');
$$;

create or replace function can_see_site(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner() or exists (
    select 1 from staff_sites where staff_id = auth.uid() and site_id = target
  );
$$;

alter table sites enable row level security;
alter table staff enable row level security;
alter table staff_sites enable row level security;
alter table shifts enable row level security;
alter table checklist_items enable row level security;
alter table checklist_runs enable row level security;
alter table checklist_ticks enable row level security;
alter table temp_units enable row level security;
alter table temp_readings enable row level security;
alter table cash_ups enable row level security;
alter table daily_sales enable row level security;
alter table alerts enable row level security;

-- Read access. Write policies get added feature by feature.
create policy "see own sites" on sites for select using (can_see_site(id));
create policy "see self or owner" on staff for select using (id = auth.uid() or is_owner());
create policy "see own links" on staff_sites for select using (staff_id = auth.uid() or is_owner());
create policy "checklist items readable" on checklist_items for select using (auth.uid() is not null);
create policy "site shifts" on shifts for select using (can_see_site(site_id));
create policy "site runs" on checklist_runs for select using (can_see_site(site_id));
create policy "site ticks" on checklist_ticks for select using (
  exists (select 1 from checklist_runs r where r.id = run_id and can_see_site(r.site_id))
);
create policy "site temp units" on temp_units for select using (can_see_site(site_id));
create policy "site temp readings" on temp_readings for select using (
  exists (select 1 from temp_units u where u.id = unit_id and can_see_site(u.site_id))
);
create policy "site cash ups" on cash_ups for select using (can_see_site(site_id));
create policy "owner sales" on daily_sales for select using (is_owner());
create policy "site alerts" on alerts for select using (can_see_site(site_id));
