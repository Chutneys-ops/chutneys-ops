-- RLS, trigger and sign-off tests for food safety records.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- Setup (as postgres, which skips RLS) ---------------------------------------
-- Ana (staff) works on test truck A today, Ben (staff) on truck B, Mia is a manager.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'mia@test.local');
insert into staff (id, name, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', 'Ben', 'staff'),
  ('c0000000-0000-0000-0000-00000000000c', 'Mia', 'manager');
insert into sites (id, name, kind) values
  ('10000000-0000-0000-0000-00000000000a', 'Test truck A', 'truck'),
  ('10000000-0000-0000-0000-00000000000b', 'Test truck B', 'truck');
-- Access comes from open shifts (not staff_sites): Ana is on shift at A,
-- Ben at B. Mia is a manager, so she can view and sign off anywhere
-- without a shift.
insert into shifts (site_id, staff_id) values
  ('10000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b');
insert into temp_units (id, site_id, name, max_c) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Test fridge A', 5),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Test fridge B', 5);

-- Test templates, so these tests don't depend on seed.sql.
insert into record_templates (code, title, period, site_kinds, fields) values
  ('test_fridge', 'Test fridge', 'daily', '{truck}', '[
     {"key":"unit","label":"Unit","type":"temp_unit","required":true},
     {"key":"temp","label":"Temperature","type":"number","required":true,"max":5,"unit":"C"}
   ]'),
  ('test_transport', 'Test transport', 'daily', '{truck}', '[
     {"key":"food","label":"Food","type":"text","required":true},
     {"key":"mode","label":"Chilled or hot","type":"select","required":true,"options":["chilled","hot"]},
     {"key":"temp_arriving","label":"Temp arriving","type":"number","required":true,"unit":"C",
      "range_when":{"field":"mode","ranges":{"chilled":{"max":5},"hot":{"min":60}}}}
   ]'),
  ('test_cooling', 'Test cooling', 'daily', '{truck}', '[
     {"key":"dish","label":"Dish","type":"text","required":true},
     {"key":"temp_2h","label":"Temp after 2 hours","type":"number","max":21,"unit":"C"}
   ]'),
  ('test_cafe_only', 'Cafe only', 'daily', '{cafe}', '[
     {"key":"note","label":"Note","type":"text"}
   ]');

select col_default_is('record_sheets', 'sheet_date', 'today_nz()',
  'sheet_date defaults to the Auckland date');

-- Act as Ana -----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok(
  $$ insert into record_sheets (site_id, template_code) values ('10000000-0000-0000-0000-00000000000a', 'test_fridge') $$,
  'Ana can start a sheet at her own site');

select is(
  (select started_by from record_sheets where template_code = 'test_fridge'),
  'a0000000-0000-0000-0000-00000000000a'::uuid,
  'started_by is stamped as Ana');

select throws_ok(
  $$ insert into record_sheets (site_id, template_code) values ('10000000-0000-0000-0000-00000000000b', 'test_fridge') $$,
  '42501', null,
  'Ana cannot start a sheet at Ben''s site');

select throws_ok(
  $$ insert into record_sheets (site_id, template_code, sheet_date) values ('10000000-0000-0000-0000-00000000000a', 'test_transport', '2026-01-01') $$,
  '42501', null,
  'Ana cannot choose the sheet date');

select throws_ok(
  $$ insert into record_sheets (site_id, template_code) values ('10000000-0000-0000-0000-00000000000a', 'test_cafe_only') $$,
  '42501', null,
  'Ana cannot start a cafe-only sheet at a truck');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values", recorded_at)
     select id, '{"unit":"30000000-0000-0000-0000-00000000000a","temp":3}', '2026-01-01'
     from record_sheets where template_code = 'test_fridge' $$,
  '42501', null,
  'Ana cannot set recorded_at');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values", out_of_range)
     select id, '{"unit":"30000000-0000-0000-0000-00000000000a","temp":3}', false
     from record_sheets where template_code = 'test_fridge' $$,
  '42501', null,
  'Ana cannot set out_of_range');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values")
     select id, '{"unit":"30000000-0000-0000-0000-00000000000a"}'
     from record_sheets where template_code = 'test_fridge' $$,
  '23514', 'Temperature is required',
  'a missing required field is refused');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values")
     select id, '{"unit":"30000000-0000-0000-0000-00000000000b","temp":3}'
     from record_sheets where template_code = 'test_fridge' $$,
  '23514', null,
  'a unit from another site is refused');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values")
     select id, '{"unit":"30000000-0000-0000-0000-00000000000a","temp":3,"extra":1}'
     from record_sheets where template_code = 'test_fridge' $$,
  '23514', 'Unknown field: extra',
  'an unknown field is refused');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values")
     select id, '{"unit":"30000000-0000-0000-0000-00000000000a","temp":7}'
     from record_sheets where template_code = 'test_fridge' $$,
  '23514', null,
  'out of range without a corrective action is refused');

select lives_ok(
  $$ insert into record_entries (sheet_id, "values", corrective_action)
     select id, '{"unit":"30000000-0000-0000-0000-00000000000a","temp":7}', 'Moved food to fridge 2'
     from record_sheets where template_code = 'test_fridge' $$,
  'out of range with a corrective action is saved');

select is(
  (select out_of_range from record_entries where corrective_action = 'Moved food to fridge 2'),
  true,
  'the saved entry is flagged out of range');

select lives_ok(
  $$ insert into record_entries (sheet_id, "values")
     select id, '{"unit":"30000000-0000-0000-0000-00000000000a","temp":3.5}'
     from record_sheets where template_code = 'test_fridge' $$,
  'an in-range entry is saved');

select is(
  (select recorded_by from record_entries where "values"->>'temp' = '3.5'),
  'a0000000-0000-0000-0000-00000000000a'::uuid,
  'recorded_by is stamped as Ana');

-- range_when: the limit depends on chilled or hot.
insert into record_sheets (site_id, template_code) values ('10000000-0000-0000-0000-00000000000a', 'test_transport');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values")
     select id, '{"food":"Curry","mode":"hot","temp_arriving":50}'
     from record_sheets where template_code = 'test_transport' $$,
  '23514', null,
  'hot food arriving at 50 C needs a corrective action');

select lives_ok(
  $$ insert into record_entries (sheet_id, "values")
     select id, '{"food":"Raita","mode":"chilled","temp_arriving":4}'
     from record_sheets where template_code = 'test_transport' $$,
  'chilled food arriving at 4 C is fine');

-- Follow-up readings: a cooling dish gets its 2 hour reading later.
insert into record_sheets (site_id, template_code) values ('10000000-0000-0000-0000-00000000000a', 'test_cooling');
insert into record_entries (sheet_id, "values")
select id, '{"dish":"Dal"}' from record_sheets where template_code = 'test_cooling';

select lives_ok(
  $$ insert into record_entries (sheet_id, "values", continues_entry_id)
     select e.sheet_id, '{"temp_2h":18}', e.id
     from record_entries e where e."values"->>'dish' = 'Dal' $$,
  'a follow-up reading can skip the first entry''s required fields');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values")
     select id, '{"temp_2h":18}' from record_sheets where template_code = 'test_cooling' $$,
  '23514', 'Dish is required',
  'a normal entry still needs its required fields');

-- Entries are permanent.
select throws_ok(
  $$ update record_entries set corrective_action = 'changed' $$,
  '42501', null,
  'Ana cannot edit entries');

select throws_ok(
  $$ delete from record_entries $$,
  '42501', null,
  'Ana cannot delete entries');

select throws_ok(
  $$ select pin_hash from staff_pins $$,
  '42501', null,
  'Ana cannot read PIN hashes');

select throws_ok(
  $$ select set_my_pin('1111') $$,
  '42501', null,
  'staff cannot set a sign-off PIN');

select throws_ok(
  $$ select sign_off_sheet((select id from record_sheets where template_code = 'test_fridge'), '1234') $$,
  '42501', null,
  'staff cannot sign off');

-- Act as Mia (manager at site A) -------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

select throws_ok(
  $$ select set_my_pin('12ab') $$,
  '22023', null,
  'a PIN must be 4 digits');

select lives_ok(
  $$ select set_my_pin('1234') $$,
  'a manager can set a PIN');

select throws_ok(
  $$ select sign_off_sheet((select id from record_sheets where template_code = 'test_fridge'), '9999') $$,
  '28P01', null,
  'a manager with the wrong PIN cannot sign off');

select lives_ok(
  $$ select sign_off_sheet((select id from record_sheets where template_code = 'test_fridge'), '1234') $$,
  'a manager with the right PIN can sign off');

select isnt(
  (select signed_off_by from record_sheets where template_code = 'test_fridge'),
  null,
  'the sheet is stamped as signed off');

-- Back to Ana: the signed sheet is locked except for corrections -------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select throws_ok(
  $$ insert into record_entries (sheet_id, "values")
     select id, '{"unit":"30000000-0000-0000-0000-00000000000a","temp":2}'
     from record_sheets where template_code = 'test_fridge' $$,
  '42501', null,
  'after sign-off a normal entry is refused');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values", amends_entry_id)
     select e.sheet_id, '{"unit":"30000000-0000-0000-0000-00000000000a","temp":3}', e.id
     from record_entries e where e."values"->>'temp' = '3.5' $$,
  '23514', null,
  'a correction without a note is refused');

select lives_ok(
  $$ insert into record_entries (sheet_id, "values", amends_entry_id, note)
     select e.sheet_id, '{"unit":"30000000-0000-0000-0000-00000000000a","temp":3}', e.id, 'Typed 3.5, display said 3'
     from record_entries e where e."values"->>'temp' = '3.5' $$,
  'a correction with a note works after sign-off');

-- Act as Ben (site B only) ---------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select is_empty(
  $$ select 1 from record_entries $$,
  'Ben cannot see entries from Ana''s site');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values")
     values ((select id from record_sheets where template_code = 'test_transport'), '{"food":"x","mode":"chilled","temp_arriving":3}') $$,
  '42501', null,
  'Ben cannot add an entry to a sheet at Ana''s site');

select * from finish();
rollback;
