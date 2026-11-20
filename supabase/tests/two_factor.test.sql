-- Two-step sign-in (authenticator codes) is enforced by the DATABASE.
--   aal1 = signed in with a password only; aal2 = password and a code.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

-- Setup (as postgres, which skips RLS) ---------------------------------------
-- Mia: manager with an authenticator.   Max: manager who hasn't set one up.
-- Olly: owner with an authenticator.    Ana: staff, no authenticator.
-- Sam: staff who opted in (has one).
insert into auth.users (id, email) values
  ('ab000000-0000-0000-0000-000000000001', 'mia.mfa@test.local'),
  ('ab000000-0000-0000-0000-000000000002', 'max.mfa@test.local'),
  ('ab000000-0000-0000-0000-000000000003', 'olly.mfa@test.local'),
  ('ab000000-0000-0000-0000-000000000004', 'ana.mfa@test.local'),
  ('ab000000-0000-0000-0000-000000000005', 'sam.mfa@test.local');
insert into staff (id, name, role) values
  ('ab000000-0000-0000-0000-000000000001', 'Mia', 'manager'),
  ('ab000000-0000-0000-0000-000000000002', 'Max', 'manager'),
  ('ab000000-0000-0000-0000-000000000003', 'Olly', 'owner'),
  ('ab000000-0000-0000-0000-000000000004', 'Ana', 'staff'),
  ('ab000000-0000-0000-0000-000000000005', 'Sam', 'staff');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('ab100000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000001', 'Mia phone', 'totp', 'verified', now(), now(), 'x'),
  ('ab100000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000001', 'Mia tablet', 'totp', 'verified', now(), now(), 'x'),
  ('ab100000-0000-0000-0000-000000000003', 'ab000000-0000-0000-0000-000000000003', 'Olly phone', 'totp', 'verified', now(), now(), 'x'),
  ('ab100000-0000-0000-0000-000000000005', 'ab000000-0000-0000-0000-000000000005', 'Sam phone', 'totp', 'verified', now(), now(), 'x'),
  -- Started but never finished: doesn't count as having one.
  ('ab100000-0000-0000-0000-000000000006', 'ab000000-0000-0000-0000-000000000002', 'Max half', 'totp', 'unverified', now(), now(), 'x');
insert into auth.sessions (id, user_id) values
  ('ab200000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000001');

insert into sites (id, name, kind) values
  ('ab300000-0000-0000-0000-00000000000a', 'MFA truck', 'truck');
-- Ana's hours waiting for approval, and Sam's own.
insert into timesheets (id, staff_id, site_id, work_date, start_time, finish_time) values
  ('ab400000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000004',
   'ab300000-0000-0000-0000-00000000000a', today_nz() - 1, '09:00', '13:00'),
  ('ab400000-0000-0000-0000-000000000002', 'ab000000-0000-0000-0000-000000000005',
   'ab300000-0000-0000-0000-00000000000a', today_nz() - 1, '09:00', '13:00');
-- A sheet with an entry, ready to sign, and Mia's and Max's PIN (1234).
insert into record_templates (code, title, period, site_kinds, fields) values
  ('mfa_check', 'MFA check', 'daily', '{truck}', '[{"key":"done","label":"Done","type":"yes_no","required":true}]');
insert into record_sheets (id, site_id, template_code, started_by) values
  ('ab500000-0000-0000-0000-000000000001', 'ab300000-0000-0000-0000-00000000000a', 'mfa_check', 'ab000000-0000-0000-0000-000000000004');
insert into record_entries (sheet_id, "values", recorded_by) values
  ('ab500000-0000-0000-0000-000000000001', '{"done":true}', 'ab000000-0000-0000-0000-000000000004');
insert into staff_pins (staff_id, pin_hash) values
  ('ab000000-0000-0000-0000-000000000001', extensions.crypt('1234', extensions.gen_salt('bf'))),
  ('ab000000-0000-0000-0000-000000000002', extensions.crypt('1234', extensions.gen_salt('bf')));

set local role authenticated;

-- 1. Max: a manager with a password only, no authenticator yet -> staff level ----------
select set_config('request.jwt.claims', '{"sub":"ab000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}', true);

select is(mfa_status(), 'enrol', 'a manager with no authenticator is asked to set one up');
select ok(is_active(), 'aal1 manager without an authenticator still has staff-level access');
select ok(not is_manager(), 'aal1 manager is not a manager to the database');
select throws_ok(
  $$ select approve_timesheets(array['ab400000-0000-0000-0000-000000000001'::uuid]) $$,
  '42501', null, 'aal1 manager can''t approve hours');
select throws_ok(
  $$ select sign_off_sheet('ab500000-0000-0000-0000-000000000001', '1234') $$,
  '42501', null, 'aal1 manager can''t sign off records');
select is(
  (select count(*)::int from timesheets where staff_id = 'ab000000-0000-0000-0000-000000000004'), 0,
  'aal1 manager can''t see other people''s hours (no "see all")');
select is(
  (select count(*)::int from record_sheets where id = 'ab500000-0000-0000-0000-000000000001'), 0,
  'aal1 manager can''t see other sites'' records');

-- 2. Mia: manager WITH an authenticator, password only -> nothing until the code ----------
select set_config('request.jwt.claims', '{"sub":"ab000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}', true);

select is(mfa_status(), 'verify', 'a manager with an authenticator is asked for the code');
select ok(not is_manager(), 'aal1 manager with an authenticator is not a manager');
select ok(not is_active(), 'with an authenticator set up, a password alone opens nothing');
select is(
  (select count(*)::int from staff where id = 'ab000000-0000-0000-0000-000000000001'), 1,
  '...except their own staff row, so the app can show the code screen');
select throws_ok(
  $$ select approve_timesheets(array['ab400000-0000-0000-0000-000000000001'::uuid]) $$,
  '42501', null, 'can''t approve hours');
select throws_ok(
  $$ select sign_off_sheet('ab500000-0000-0000-0000-000000000001', '1234') $$,
  '42501', null, 'can''t sign off records');
select is((select count(*)::int from timesheets), 0, 'sees no hours at all');

-- 3. Mia after typing the code (aal2) -> full manager --------------------------------------
select set_config('request.jwt.claims', '{"sub":"ab000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);

select is(mfa_status(), 'none', 'aal2 manager has nothing more to do');
select ok(is_manager(), 'aal2 manager is a manager');
select is(
  (select count(*)::int from timesheets where staff_id = 'ab000000-0000-0000-0000-000000000004'), 1,
  'aal2 manager sees everyone''s hours');
select is(
  approve_timesheets(array['ab400000-0000-0000-0000-000000000001'::uuid]), 1,
  'aal2 manager approves hours');
select is(
  sign_off_sheet('ab500000-0000-0000-0000-000000000001', '1234') ->> 'status', 'ok',
  'aal2 manager signs off records');
select throws_ok(
  $$ select reset_staff_mfa('ab000000-0000-0000-0000-000000000005') $$,
  '42501', null, 'a manager can''t reset anyone''s two-step sign-in');
select throws_ok(
  $$ select staff_mfa_factors() $$,
  '42501', null, 'a manager can''t list who has two-step sign-in');
select is((select count(*)::int from mfa_resets), 0, 'a manager can''t read the resets');

-- 4. Staff: Ana (no authenticator) and Sam (opted in) -----------------------------------------
select set_config('request.jwt.claims', '{"sub":"ab000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}', true);
select is(mfa_status(), 'none', 'staff without an authenticator aren''t asked for anything');
select ok(is_active(), 'staff without an authenticator work as before with a password');

select set_config('request.jwt.claims', '{"sub":"ab000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal1"}', true);
select is(mfa_status(), 'verify', 'staff who opted in are asked for the code');
select is((select count(*)::int from timesheets), 0, 'opted-in staff with a password only can''t see even their own hours');

select set_config('request.jwt.claims', '{"sub":"ab000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from timesheets), 1, 'after the code they see their own hours');
select ok(not is_manager(), 'a code doesn''t make staff a manager');

-- 5. Olly, the owner -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"ab000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}', true);
select ok(not is_owner(), 'aal1 owner is not the owner to the database');
select throws_ok(
  $$ select reset_staff_mfa('ab000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'aal1 owner can''t reset two-step sign-in');

select set_config('request.jwt.claims', '{"sub":"ab000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}', true);
select ok(is_owner(), 'aal2 owner is the owner');
select is(
  (select factors from staff_mfa_factors() where staff_id = 'ab000000-0000-0000-0000-000000000001'), 2,
  'the owner sees how many authenticators Mia has (unverified ones don''t count)');
select throws_ok(
  $$ select reset_staff_mfa('ab000000-0000-0000-0000-000000000003') $$,
  '23514', null, 'the owner can''t reset their own (see the runbook)');
select is(reset_staff_mfa('ab000000-0000-0000-0000-000000000001'), 2, 'the owner resets Mia''s authenticators');
select is(
  (select reset_by::text || ' ' || factors_removed from mfa_resets where staff_id = 'ab000000-0000-0000-0000-000000000001'),
  'ab000000-0000-0000-0000-000000000003 2',
  'the reset is recorded: who did it and how many were removed');

reset role;
select is(
  (select count(*)::int from auth.mfa_factors where user_id = 'ab000000-0000-0000-0000-000000000001'), 0,
  'Mia''s authenticators are gone');
select is(
  (select count(*)::int from auth.sessions where user_id = 'ab000000-0000-0000-0000-000000000001'), 0,
  'Mia is signed out everywhere');
select is(
  (select count(*)::int from audit_log where table_name = 'mfa_resets' and actor_id = 'ab000000-0000-0000-0000-000000000003'), 1,
  'the reset is in the audit log under the owner');

-- 6. Mia after the reset: password only -> back to "set one up", staff level ----------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ab000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}', true);
select is(mfa_status(), 'enrol', 'after a reset, the manager is asked to set up a new authenticator');
select ok(is_active() and not is_manager(), 'and has staff-level access until they do');

-- 7. Nobody signed in -------------------------------------------------------------------------------
reset role;
select ok(
  not has_function_privilege('anon', 'reset_staff_mfa(uuid)', 'execute')
  and not has_function_privilege('anon', 'mfa_status()', 'execute'),
  'signed-out callers can''t use the two-step functions');

select * from finish();
rollback;
