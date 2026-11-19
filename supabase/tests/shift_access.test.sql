-- Shift-based access: "where you are working today" decides what you can do.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

-- Setup (as postgres, which skips RLS) ---------------------------------------
-- Sam and Kim are staff, Max is a manager, Olu is the owner.
-- Truck A and truck B are open; truck C is closed (inactive).
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'sam@test.local'),
  ('a1000000-0000-0000-0000-000000000002', 'kim@test.local'),
  ('a1000000-0000-0000-0000-000000000003', 'max@test.local'),
  ('a1000000-0000-0000-0000-000000000004', 'olu@test.local');
insert into staff (id, name, role) values
  ('a1000000-0000-0000-0000-000000000001', 'Sam', 'staff'),
  ('a1000000-0000-0000-0000-000000000002', 'Kim', 'staff'),
  ('a1000000-0000-0000-0000-000000000003', 'Max', 'manager'),
  ('a1000000-0000-0000-0000-000000000004', 'Olu', 'owner');
insert into sites (id, name, kind, active) values
  ('11000000-0000-0000-0000-00000000000a', 'Shift truck A', 'truck', true),
  ('11000000-0000-0000-0000-00000000000b', 'Shift truck B', 'truck', true),
  ('11000000-0000-0000-0000-00000000000c', 'Shift truck C', 'truck', false);

-- Kim clocked in at B ten hours ago and forgot to clock out.
insert into shifts (id, site_id, staff_id, clock_in) values
  ('41000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-00000000000b',
   'a1000000-0000-0000-0000-000000000002', now() - interval '10 hours');

-- An opening-checks style template: "No" is a problem (expect: true).
insert into record_templates (code, title, period, site_kinds, fields) values
  ('test_checks', 'Test checks', 'daily', '{truck}', '[
     {"key":"fridges_ok","label":"Fridges at 5 C or below","type":"yes_no","required":true,"expect":true}
   ]');

-- Kim's sheet and entry at B today (inserted directly, so set who started it).
insert into record_sheets (id, site_id, template_code, started_by) values
  ('51000000-0000-0000-0000-00000000000b', '11000000-0000-0000-0000-00000000000b', 'test_checks',
   'a1000000-0000-0000-0000-000000000002');
insert into record_entries (sheet_id, "values", recorded_by) values
  ('51000000-0000-0000-0000-00000000000b', '{"fridges_ok":true}', 'a1000000-0000-0000-0000-000000000002');

-- Money rows for truck A.
insert into daily_sales (site_id, sale_date, channel, amount) values
  ('11000000-0000-0000-0000-00000000000a', '2026-11-16', 'in_store', 100.00);
insert into cash_ups (site_id, sales_total, eftpos_total, float_amount, cash_counted, submitted_by) values
  ('11000000-0000-0000-0000-00000000000a', 100.00, 60.00, 200.00, 240.00, 'a1000000-0000-0000-0000-000000000004');

-- Act as Sam (staff), not clocked in -----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ insert into record_sheets (site_id, template_code) values ('11000000-0000-0000-0000-00000000000a', 'test_checks') $$,
  '42501', null,
  'staff with no open shift cannot start a sheet');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values") values ('51000000-0000-0000-0000-00000000000b', '{"fridges_ok":true}') $$,
  '42501', null,
  'staff with no open shift cannot add an entry anywhere');

select is_empty(
  $$ select 1 from record_sheets $$,
  'staff with no open shift see no records');

select is(
  (select count(*)::int from sites where id in (
    '11000000-0000-0000-0000-00000000000a', '11000000-0000-0000-0000-00000000000b', '11000000-0000-0000-0000-00000000000c')),
  2,
  'staff can read active sites (for the picker) but not closed ones');

select is_empty(
  $$ select 1 from cash_ups union all select 1 from daily_sales $$,
  'staff cannot see money');

select is_empty(
  $$ select 1 from shifts where staff_id <> 'a1000000-0000-0000-0000-000000000001' $$,
  'staff cannot see other people''s shifts');

-- Clocking in -------------------------------------------------------------------
select throws_ok(
  $$ insert into shifts (site_id, clock_in) values ('11000000-0000-0000-0000-00000000000a', now() - interval '3 hours') $$,
  '42501', null,
  'staff cannot set clock_in');

select throws_ok(
  $$ insert into shifts (site_id, staff_id) values ('11000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'staff cannot clock someone else in');

select throws_ok(
  $$ insert into shifts (site_id) values ('11000000-0000-0000-0000-00000000000c') $$,
  '42501', null,
  'staff cannot clock in at a closed site');

select lives_ok(
  $$ insert into shifts (site_id) values ('11000000-0000-0000-0000-00000000000a') $$,
  'staff can clock in at an active site');

select throws_ok(
  $$ insert into shifts (site_id) values ('11000000-0000-0000-0000-00000000000b') $$,
  '23505', null,
  'two open shifts at once are impossible');

select throws_ok(
  $$ update shifts set clock_out = now() - interval '1 hour' $$,
  '42501', null,
  'staff cannot write clock_out themselves');

-- On shift at A --------------------------------------------------------------
select lives_ok(
  $$ insert into record_sheets (site_id, template_code) values ('11000000-0000-0000-0000-00000000000a', 'test_checks') $$,
  'staff on shift at A can start a sheet at A');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values") values ('51000000-0000-0000-0000-00000000000b', '{"fridges_ok":true}') $$,
  '42501', null,
  'staff on shift at A cannot add an entry at B');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values")
     select id, '{"fridges_ok":false}' from record_sheets where site_id = '11000000-0000-0000-0000-00000000000a' $$,
  '23514', null,
  'answering No to an expected Yes needs a corrective action');

select lives_ok(
  $$ insert into record_entries (sheet_id, "values", corrective_action, note)
     select id, '{"fridges_ok":false}', 'Moved stock to fridge 2', 'Seal on fridge 1 is torn'
     from record_sheets where site_id = '11000000-0000-0000-0000-00000000000a' $$,
  'with a corrective action (and an optional comment) it is saved');

select is(
  (select out_of_range from record_entries where note = 'Seal on fridge 1 is torn'),
  true,
  'the No answer is flagged out of range');

-- Changing site --------------------------------------------------------------
select lives_ok(
  $$ select start_shift('11000000-0000-0000-0000-00000000000b') $$,
  'start_shift moves staff to another site');

select is(
  (select site_id from shifts where staff_id = 'a1000000-0000-0000-0000-000000000001' and clock_out is null),
  '11000000-0000-0000-0000-00000000000b'::uuid,
  'the open shift is now at B');

select isnt(
  (select clock_out from shifts where staff_id = 'a1000000-0000-0000-0000-000000000001'
     and site_id = '11000000-0000-0000-0000-00000000000a'),
  null,
  'the shift at A was clocked out');

select is_empty(
  $$ select 1 from record_sheets where site_id = '11000000-0000-0000-0000-00000000000a' $$,
  'after moving, A''s records are no longer visible');

select is(
  (select count(*)::int from record_sheets where site_id = '11000000-0000-0000-0000-00000000000b'),
  1,
  'B''s records are visible');

select is(
  (select name from staff where id = 'a1000000-0000-0000-0000-000000000002'),
  'Kim',
  'staff can see the name of a colleague on shift at the same site');

select throws_ok(
  $$ select fix_clock_out('41000000-0000-0000-0000-000000000001', now() - interval '2 hours', 'Forgot') $$,
  '42501', null,
  'staff cannot fix a shift');

select lives_ok($$ select clock_out() $$, 'staff can clock out');

select is_empty(
  $$ select 1 from shifts where staff_id = 'a1000000-0000-0000-0000-000000000001' and clock_out is null $$,
  'after clock_out there is no open shift');

-- Act as Max (manager), not clocked in ---------------------------------------
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select is(
  (select count(*)::int from record_sheets where site_id in (
    '11000000-0000-0000-0000-00000000000a', '11000000-0000-0000-0000-00000000000b')),
  2,
  'a manager sees records at every site');

select is_empty($$ select 1 from cash_ups $$, 'a manager cannot see cash-ups');
select is_empty($$ select 1 from daily_sales $$, 'a manager cannot see daily sales');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values") values ('51000000-0000-0000-0000-00000000000b', '{"fridges_ok":true}') $$,
  '42501', null,
  'a manager who is not on shift cannot add entries');

select isnt_empty(
  $$ select 1 from sites where id = '11000000-0000-0000-0000-00000000000c' $$,
  'a manager can see closed sites');

select isnt_empty(
  $$ select 1 from shifts where staff_id = 'a1000000-0000-0000-0000-000000000002' $$,
  'a manager sees everyone''s shifts');

select throws_ok(
  $$ select fix_clock_out('41000000-0000-0000-0000-000000000001', now() - interval '2 hours', ' ') $$,
  '23514', null,
  'fixing a clock-out needs a note');

select throws_ok(
  $$ select fix_clock_out('41000000-0000-0000-0000-000000000001', now() + interval '1 hour', 'Forgot') $$,
  '23514', null,
  'a fixed clock-out cannot be in the future');

select lives_ok(
  $$ select fix_clock_out('41000000-0000-0000-0000-000000000001', now() - interval '2 hours', 'Forgot to clock out, left at 6') $$,
  'a manager can fix a forgotten clock-out');

select is(
  (select edited_by from shifts where id = '41000000-0000-0000-0000-000000000001'),
  'a1000000-0000-0000-0000-000000000003'::uuid,
  'the fix records who made it');

-- Act as Olu (owner) ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

select isnt_empty($$ select 1 from cash_ups $$, 'the owner sees cash-ups');
select isnt_empty($$ select 1 from daily_sales $$, 'the owner sees daily sales');
select is(
  (select count(*)::int from record_sheets where site_id in (
    '11000000-0000-0000-0000-00000000000a', '11000000-0000-0000-0000-00000000000b')),
  2,
  'the owner sees records at every site');
select isnt_empty(
  $$ select 1 from shifts where staff_id = 'a1000000-0000-0000-0000-000000000001' $$,
  'the owner sees everyone''s shifts');

select * from finish();
rollback;
