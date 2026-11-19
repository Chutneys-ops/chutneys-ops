-- A number field with "range_from": "unit" is checked against the chosen
-- unit's own min_c / max_c (fridge 0 to 5 C, freezer -25 to -15 C).
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- Setup (as postgres, which skips RLS) ---------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local');
insert into staff (id, name, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff');
insert into sites (id, name, kind) values
  ('10000000-0000-0000-0000-00000000000a', 'Test truck A', 'truck'),
  ('10000000-0000-0000-0000-00000000000b', 'Test truck B', 'truck');
insert into shifts (site_id, staff_id) values
  ('10000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a');
insert into temp_units (id, site_id, name, min_c, max_c) values
  ('30000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a', 'Fridge', 0, 5),
  ('30000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-00000000000a', 'Freezer', -25, -15),
  -- No limits of its own: the template's max of 5 applies.
  ('30000000-0000-0000-0000-0000000000f3', '10000000-0000-0000-0000-00000000000a', 'Old fridge', null, null),
  ('30000000-0000-0000-0000-0000000000f4', '10000000-0000-0000-0000-00000000000b', 'Other site freezer', -25, -15);

insert into record_templates (code, title, period, site_kinds, fields) values
  ('test_unit_temps', 'Test unit temps', 'daily', '{truck}', '[
     {"key":"unit","label":"Unit","type":"temp_unit","required":true},
     {"key":"temp","label":"Temperature","type":"number","required":true,"max":5,"unit":"C","range_from":"unit"}
   ]');

-- Act as Ana -----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

insert into record_sheets (site_id, template_code) values ('10000000-0000-0000-0000-00000000000a', 'test_unit_temps');

-- Adds an entry and returns its out_of_range flag.
create function pg_temp.flag(unit text, temp numeric, action text default 'Moved stock') returns boolean
language plpgsql as $$
declare result boolean;
begin
  insert into record_entries (sheet_id, "values", corrective_action)
  select id, jsonb_build_object('unit', unit, 'temp', temp), action
  from record_sheets where template_code = 'test_unit_temps'
  returning out_of_range into result;
  return result;
end;
$$;

select is(pg_temp.flag('30000000-0000-0000-0000-0000000000f2', -18, null), false,
  'Freezer at -18 C is in range (no corrective action needed)');
select is(pg_temp.flag('30000000-0000-0000-0000-0000000000f2', -5), true,
  'Freezer at -5 C is flagged, even though it is under the template''s 5 C');
select is(pg_temp.flag('30000000-0000-0000-0000-0000000000f2', -30), true,
  'Freezer at -30 C is flagged (below its min of -25)');
select throws_ok(
  $$ select pg_temp.flag('30000000-0000-0000-0000-0000000000f2', -5, null) $$,
  '23514', 'Out of range: say what you did about it (corrective action)',
  'A flagged freezer reading needs a corrective action');

select is(pg_temp.flag('30000000-0000-0000-0000-0000000000f1', 4, null), false,
  'Fridge at 4 C is in range');
select is(pg_temp.flag('30000000-0000-0000-0000-0000000000f1', 6), true,
  'Fridge at 6 C is flagged');
select is(pg_temp.flag('30000000-0000-0000-0000-0000000000f1', -1), true,
  'Fridge at -1 C is flagged (below its min of 0)');

select is(pg_temp.flag('30000000-0000-0000-0000-0000000000f3', 6), true,
  'A unit with no limits falls back to the template''s 5 C');

select throws_ok(
  $$ select pg_temp.flag('30000000-0000-0000-0000-0000000000f4', -18, null) $$,
  '23514', 'Unit must be a unit at this site',
  'A unit from another site is rejected');

select * from finish();
rollback;
