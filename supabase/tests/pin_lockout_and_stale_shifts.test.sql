-- PIN lockout and forgotten clock-outs.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.
-- (now() is fixed for the whole transaction, so the times below are exact.)

begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- Setup (as postgres, which skips RLS) ---------------------------------------
-- Mia is a manager. Ana forgot to clock out 15 hours ago, Ben 20 hours ago.
insert into auth.users (id, email) values
  ('a2000000-0000-0000-0000-000000000001', 'mia2@test.local'),
  ('a2000000-0000-0000-0000-000000000002', 'ana2@test.local'),
  ('a2000000-0000-0000-0000-000000000003', 'ben2@test.local');
insert into staff (id, name, role) values
  ('a2000000-0000-0000-0000-000000000001', 'Mia', 'manager'),
  ('a2000000-0000-0000-0000-000000000002', 'Ana', 'staff'),
  ('a2000000-0000-0000-0000-000000000003', 'Ben', 'staff');
insert into sites (id, name, kind) values
  ('12000000-0000-0000-0000-00000000000a', 'Safety truck A', 'truck');
insert into shifts (id, site_id, staff_id, clock_in) values
  ('42000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-00000000000a',
   'a2000000-0000-0000-0000-000000000002', now() - interval '15 hours'),
  ('42000000-0000-0000-0000-000000000003', '12000000-0000-0000-0000-00000000000a',
   'a2000000-0000-0000-0000-000000000003', now() - interval '20 hours');

insert into record_templates (code, title, period, site_kinds, fields) values
  ('safety_one', 'Safety one', 'daily', '{truck}', '[{"key":"done","label":"Done","type":"yes_no","required":true}]'),
  ('safety_two', 'Safety two', 'daily', '{truck}', '[{"key":"done","label":"Done","type":"yes_no","required":true}]'),
  -- No sheet yet: starting one can only fail because of the stale shift.
  ('safety_three', 'Safety three', 'daily', '{truck}', '[{"key":"done","label":"Done","type":"yes_no","required":true}]');

-- Two sheets with an entry each, ready to sign (inserted directly).
insert into record_sheets (id, site_id, template_code, started_by) values
  ('52000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-00000000000a', 'safety_one', 'a2000000-0000-0000-0000-000000000002'),
  ('52000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-00000000000a', 'safety_two', 'a2000000-0000-0000-0000-000000000002');
insert into record_entries (sheet_id, "values", recorded_by) values
  ('52000000-0000-0000-0000-000000000001', '{"done":true}', 'a2000000-0000-0000-0000-000000000002'),
  ('52000000-0000-0000-0000-000000000002', '{"done":true}', 'a2000000-0000-0000-0000-000000000002');

-- 1. PIN lockout, as Mia --------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
select set_my_pin('1234');

select is(sign_off_sheet('52000000-0000-0000-0000-000000000001', '0000')->>'status', 'wrong_pin', 'wrong PIN 1 is refused');
select is(
  (sign_off_sheet('52000000-0000-0000-0000-000000000001', '0000')->>'attempts_left')::int, 3,
  'wrong PIN 2 says 3 tries are left (the count was saved, not rolled back)');
select is(sign_off_sheet('52000000-0000-0000-0000-000000000001', '0000')->>'status', 'wrong_pin', 'wrong PIN 3 is refused');
select is(sign_off_sheet('52000000-0000-0000-0000-000000000001', '0000')->>'status', 'wrong_pin', 'wrong PIN 4 is refused');
select is(sign_off_sheet('52000000-0000-0000-0000-000000000001', '0000')->>'status', 'locked', 'wrong PIN 5 locks sign-off');

select is(
  sign_off_sheet('52000000-0000-0000-0000-000000000001', '1234'),
  '{"status":"locked","minutes":15}'::jsonb,
  'the right PIN during the lock is still refused, with the minutes left');

-- Peek at the stored count as postgres (staff can't read staff_pins).
reset role;
select is(
  (select failed_attempts from staff_pins where staff_id = 'a2000000-0000-0000-0000-000000000001'), 5,
  'five failed attempts are stored');
select is(
  (select signed_off_at from record_sheets where id = '52000000-0000-0000-0000-000000000001'), null,
  'the sheet is still not signed');
-- Fake the 15 minutes passing.
update staff_pins set locked_until = now() - interval '1 second'
where staff_id = 'a2000000-0000-0000-0000-000000000001';
set local role authenticated;

select is(sign_off_sheet('52000000-0000-0000-0000-000000000001', '1234')->>'status', 'ok', 'after the lock expires, the right PIN signs');

reset role;
select is(
  (select row(failed_attempts, locked_until) from staff_pins where staff_id = 'a2000000-0000-0000-0000-000000000001'),
  row(0, null::timestamptz),
  'the right PIN resets the count and the lock');
select isnt(
  (select signed_off_at from record_sheets where id = '52000000-0000-0000-0000-000000000001'), null,
  'the sheet is signed');
set local role authenticated;

-- A wrong PIN, then a new PIN: set_my_pin clears the count.
select is(sign_off_sheet('52000000-0000-0000-0000-000000000002', '0000')->>'status', 'wrong_pin', 'another wrong PIN is counted');
select set_my_pin('5678');
reset role;
select is(
  (select failed_attempts from staff_pins where staff_id = 'a2000000-0000-0000-0000-000000000001'), 0,
  'set_my_pin resets the count');
set local role authenticated;

-- 2. Forgotten clock-outs, as Ana (open shift from 15 hours ago) ----------------
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}', true);

select is(on_shift_at('12000000-0000-0000-0000-00000000000a'), false,
  'a 15-hour-old open shift no longer counts as being on shift');

select throws_ok(
  $$ insert into record_sheets (site_id, template_code) values ('12000000-0000-0000-0000-00000000000a', 'safety_three') $$,
  '42501', null,
  'with only a stale shift, Ana cannot start a sheet');

select throws_ok(
  $$ insert into record_entries (sheet_id, "values") values ('52000000-0000-0000-0000-000000000002', '{"done":true}') $$,
  '42501', null,
  'with only a stale shift, Ana cannot add an entry');

select lives_ok(
  $$ select start_shift('12000000-0000-0000-0000-00000000000a') $$,
  'Ana can start a new shift');

select is(
  (select needs_review from shifts where id = '42000000-0000-0000-0000-000000000002'), true,
  'the stale shift is closed and marked needs_review');

select is(
  (select clock_out - clock_in from shifts where id = '42000000-0000-0000-0000-000000000002'), interval '0',
  'the stale shift counts zero hours (no invented time)');

select is(
  (select count(*)::int from shifts
   where staff_id = 'a2000000-0000-0000-0000-000000000002' and clock_out is null and clock_in = now()),
  1,
  'Ana has a fresh open shift');

select is(on_shift_at('12000000-0000-0000-0000-00000000000a'), true, 'and is on shift again');

select lives_ok(
  $$ insert into record_entries (sheet_id, "values") values ('52000000-0000-0000-0000-000000000002', '{"done":true}') $$,
  'now Ana can add an entry');

select lives_ok(
  $$ insert into record_sheets (site_id, template_code) values ('12000000-0000-0000-0000-00000000000a', 'safety_three') $$,
  'and the sheet that was refused earlier can now be started');

-- Ben clocks out 20 hours late: no 20-hour shift either.
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}', true);
select clock_out();
reset role;
select is(
  (select row(needs_review, clock_out = clock_in) from shifts where id = '42000000-0000-0000-0000-000000000003'),
  row(true, true),
  'clocking out a stale shift also records zero hours and needs_review');
set local role authenticated;

-- 3. Mia fixes Ana's forgotten clock-out ------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);

select throws_ok(
  $$ select fix_clock_out('42000000-0000-0000-0000-000000000002', now() - interval '7 hours', '') $$,
  '23514', null,
  'a fix needs a note');

select lives_ok(
  $$ select fix_clock_out('42000000-0000-0000-0000-000000000002', now() - interval '7 hours', 'Left at the end of the dinner rush') $$,
  'a manager sets the real clock-out time');

select is(
  (select clock_out - clock_in from shifts where id = '42000000-0000-0000-0000-000000000002'), interval '8 hours',
  'the shift now has the real 8 hours');

select is(
  (select needs_review from shifts where id = '42000000-0000-0000-0000-000000000002'), false,
  'fix_clock_out clears needs_review');

-- Staff can't run the internal helper directly.
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$ select close_stale_shift('42000000-0000-0000-0000-000000000003') $$,
  '42501', null,
  'close_stale_shift is not callable by users');

select * from finish();
rollback;
