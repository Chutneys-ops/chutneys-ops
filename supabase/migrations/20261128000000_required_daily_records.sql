-- Slice 12: which daily records must be done every day.
--
-- Some daily templates only apply when something happens (cooking, cooling,
-- reheating, hot holding, transport, batter). Others must be filled in
-- every day the site opens. Home's "Due today" lists only the second kind.
--
-- required_daily = true: fridge temperatures, opening checks, cleaning.
-- The seed (supabase/seed.sql) sets the same list, because on a fresh
-- database migrations run before the seed adds the templates.

alter table record_templates
  add column required_daily boolean not null default false;

-- Only a daily record can be required every day ("Deliveries" can't).
alter table record_templates
  add constraint record_templates_required_daily_is_daily
  check (not required_daily or period = 'daily');

comment on column record_templates.required_daily is
  'Must be filled in every day the site is open. Shown on Home under "Due today".';

-- Existing databases: set the flag on the templates already there.
update record_templates
set required_daily = code in (
  'fridge_daily',
  'opening_checks_truck',
  'opening_checks_cafe',
  'opening_checks_restaurant',
  'cleaning'
);
