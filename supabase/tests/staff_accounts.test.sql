-- Staff accounts: deactivated people see and change nothing; only the owner
-- changes roles and active status; the owner can't lock themselves out.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

-- Coverage: a new table can never be forgotten ------------------------------
-- Every RLS table in public must have the restrictive "active accounts only"
-- policy. If this fails, add `select enable_active_only('your_table');` to
-- its migration.
select is_empty(
  $$ select c.relname::text
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and not exists (
         select 1 from pg_policy p
         where p.polrelid = c.oid and p.polname = 'active accounts only' and not p.polpermissive
       ) $$,
  'Every table has the restrictive "active accounts only" policy (see enable_active_only)');

select ok(
  exists (
    select 1 from pg_policy p
    where p.polrelid = 'storage.objects'::regclass and p.polname = 'active accounts only' and not p.polpermissive
  ),
  'Storage has the "active accounts only" policy too');

-- Setup (as postgres, which skips RLS) ---------------------------------------
-- Ana (staff) and Dee (staff, will be turned off) on shift at A,
-- Mia (manager), Max (manager, will be turned off), Olly (owner).
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('e0000000-0000-0000-0000-00000000000e', 'dee@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'mia@test.local'),
  ('f0000000-0000-0000-0000-00000000000f', 'max@test.local'),
  ('d0000000-0000-0000-0000-00000000000d', 'olly@test.local'),
  ('90000000-0000-0000-0000-000000000009', 'new@test.local');
insert into staff (id, name, role, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff', 'ana@test.local'),
  ('e0000000-0000-0000-0000-00000000000e', 'Dee', 'staff', 'dee@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'Mia', 'manager', 'mia@test.local'),
  ('f0000000-0000-0000-0000-00000000000f', 'Max', 'manager', 'max@test.local'),
  ('d0000000-0000-0000-0000-00000000000d', 'Olly', 'owner', 'olly@test.local');
insert into sites (id, name, kind) values
  ('10000000-0000-0000-0000-00000000000a', 'Test truck A', 'truck');
insert into shifts (site_id, staff_id) values
  ('10000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000e'),
  ('10000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000f');
insert into record_templates (code, title, period, site_kinds, fields) values
  ('test_note', 'Test note', 'daily', '{truck}', '[{"key":"note","label":"Note","type":"text"}]');
-- Dee's own rows from before she left: she must not see them afterwards.
insert into timesheets (staff_id, site_id, work_date, start_time, finish_time) values
  ('e0000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-00000000000a', today_nz() - 3, '09:00', '13:00');
insert into leave_requests (staff_id, reason, start_date, end_date, hours, gi_symptoms) values
  ('e0000000-0000-0000-0000-00000000000e', 'sick', today_nz() - 10, today_nz() - 10, 8, false);
insert into purchases (site_id, purchased_by, supplier, description, total_incl_gst, payment_method, no_receipt_reason) values
  ('10000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000e', 'Dee shop', 'Milk', 5, 'own_money', 'Lost');
insert into storage.buckets (id, name) values ('invoices', 'invoices') on conflict (id) do nothing;
-- A session for Dee, to check turning her off signs her out.
insert into auth.sessions (id, user_id) values
  ('5e000000-0000-0000-0000-00000000000e', 'e0000000-0000-0000-0000-00000000000e');

-- Managers and staff can't change roles or active status -----------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

select throws_ok(
  $$ select set_staff_role('a0000000-0000-0000-0000-00000000000a', 'manager') $$,
  '42501', null, 'A manager cannot change roles');
select throws_ok(
  $$ select set_staff_role('c0000000-0000-0000-0000-00000000000c', 'owner') $$,
  '42501', null, 'A manager cannot make themselves owner');
select throws_ok(
  $$ select set_staff_active('a0000000-0000-0000-0000-00000000000a', false) $$,
  '42501', null, 'A manager cannot turn accounts off');
select throws_ok(
  $$ update staff set role = 'owner' where id = 'c0000000-0000-0000-0000-00000000000c' $$,
  '42501', null, 'A manager cannot update staff directly');
select throws_ok(
  $$ insert into staff (id, name, role) values ('90000000-0000-0000-0000-000000000009', 'New', 'staff') $$,
  '42501', null, 'A manager cannot add staff');
select throws_ok(
  $$ select * from staff_logins() $$,
  '42501', null, 'A manager cannot see who has joined');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select throws_ok(
  $$ select set_staff_role('a0000000-0000-0000-0000-00000000000a', 'owner') $$,
  '42501', null, 'Staff cannot change their own role');
select throws_ok(
  $$ select set_staff_active('e0000000-0000-0000-0000-00000000000e', false) $$,
  '42501', null, 'Staff cannot turn accounts off');
select throws_ok(
  $$ update staff set active = false where id = 'e0000000-0000-0000-0000-00000000000e' $$,
  '42501', null, 'Staff cannot update staff directly');
select throws_ok(
  $$ select note_invite_sent('e0000000-0000-0000-0000-00000000000e') $$,
  '42501', null, 'Staff cannot stamp invites');

-- The owner ------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);

select throws_ok(
  $$ select set_staff_role('d0000000-0000-0000-0000-00000000000d', 'manager') $$,
  '23514', null, 'The owner cannot demote themselves');
select throws_ok(
  $$ select set_staff_active('d0000000-0000-0000-0000-00000000000d', false) $$,
  '23514', null, 'The owner cannot turn off their own account');
select throws_ok(
  $$ select set_staff_role('a0000000-0000-0000-0000-00000000000a', 'boss') $$,
  '22023', null, 'Roles are staff, manager or owner');
select throws_ok(
  $$ update staff set role = 'manager' where id = 'a0000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'Even the owner changes roles only through set_staff_role');

select lives_ok(
  $$ select set_staff_role('a0000000-0000-0000-0000-00000000000a', 'manager') $$,
  'The owner can make Ana a manager');
select is(
  (select role from staff where id = 'a0000000-0000-0000-0000-00000000000a'),
  'manager', 'Ana is now a manager');

select lives_ok(
  $$ insert into staff (id, name, email, role) values ('90000000-0000-0000-0000-000000000009', 'New', 'new@test.local', 'staff') $$,
  'The owner can add a staff row (after an invite)');
select isnt(
  (select invited_at from staff where id = '90000000-0000-0000-0000-000000000009'),
  null, 'A new row gets invited_at');
select ok(
  (select active from staff where id = '90000000-0000-0000-0000-000000000009'),
  'A new row starts active');
select throws_ok(
  $$ insert into staff (id, name, email, role) values ('a0000000-0000-0000-0000-00000000000a', 'Dup', 'ANA@test.local', 'staff') $$,
  '23514', null, 'Emails are stored in lower case');
select lives_ok(
  $$ select note_invite_sent('90000000-0000-0000-0000-000000000009') $$,
  'The owner can stamp a resent invite');
select is(
  (select count(*)::int from staff_logins() where staff_id in (select id from staff where email like '%@test.local' and name in ('Ana', 'Dee', 'Mia', 'Max', 'Olly', 'New'))),
  6, 'The owner sees everyone''s login status');
select is(
  (select joined from staff_logins() where staff_id = '90000000-0000-0000-0000-000000000009'),
  false, 'Someone with no password yet has not joined');

select lives_ok(
  $$ select set_staff_active('e0000000-0000-0000-0000-00000000000e', false) $$,
  'The owner can turn off Dee');
select lives_ok(
  $$ select set_staff_active('f0000000-0000-0000-0000-00000000000f', false) $$,
  'The owner can turn off Max');
select results_eq(
  $$ select active, deactivated_at is not null, deactivated_by from staff where id = 'e0000000-0000-0000-0000-00000000000e' $$,
  $$ values (false, true, 'd0000000-0000-0000-0000-00000000000d'::uuid) $$,
  'Dee is off, with when and by whom');

reset role;
select is(
  (select count(*)::int from auth.sessions where user_id = 'e0000000-0000-0000-0000-00000000000e'),
  0, 'Turning Dee off deleted her sessions (signed out everywhere)');
set local role authenticated;

-- Dee, turned off, with a token that hasn't expired yet ------------------------------
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);

select ok(not on_shift_at('10000000-0000-0000-0000-00000000000a'), 'Dee no longer counts as on shift');
select is((select count(*)::int from sites), 0, 'Dee sees no sites');
select is(
  (select array_agg(id) from staff),
  array['e0000000-0000-0000-0000-00000000000e'::uuid],
  'Dee sees only her own staff row (so the app can say why she is signed out)');
select is((select count(*)::int from timesheets), 0, 'Dee sees none of her timesheets');
select is((select count(*)::int from leave_requests), 0, 'Dee sees none of her leave');
select is((select count(*)::int from purchases), 0, 'Dee sees none of her purchases');
select is((select count(*)::int from record_templates), 0, 'Dee sees no record templates');

select throws_ok(
  $$ insert into record_sheets (site_id, template_code) values ('10000000-0000-0000-0000-00000000000a', 'test_note') $$,
  '42501', null, 'Dee cannot add records');
select throws_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time)
     values ('10000000-0000-0000-0000-00000000000a', today_nz() - 1, '09:00', '13:00') $$,
  '42501', null, 'Dee cannot add timesheets');
select throws_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, no_receipt_reason)
     values ('10000000-0000-0000-0000-00000000000a', 'X', 'Y', 5, 'cash', 'Lost') $$,
  '42501', null, 'Dee cannot add purchases');
select throws_ok(
  $$ insert into leave_requests (reason, start_date, end_date, hours, gi_symptoms)
     values ('sick', today_nz(), today_nz(), 8, false) $$,
  '42501', null, 'Dee cannot request leave');
select throws_ok(
  $$ select start_shift('10000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'Dee cannot choose a site');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('invoices', '10000000-0000-0000-0000-00000000000a/2026/11/dee.jpg', 'e0000000-0000-0000-0000-00000000000e') $$,
  '42501', null, 'Dee cannot upload files');

-- Max, a turned-off manager ------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-00000000000f","role":"authenticated"}', true);

select ok(not is_manager(), 'Max no longer counts as a manager');
select throws_ok(
  $$ select approve_timesheets(array(select id from timesheets)) $$,
  '42501', null, 'Max cannot approve hours');
select throws_ok(
  $$ select set_my_pin('1234') $$,
  '42501', null, 'Max cannot set a sign-off PIN');

-- Nobody can add anything FOR a turned-off person ---------------------------------------
-- (active_staff_only triggers). Dee and Max are off; Ana is on.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);

select throws_ok(
  $$ insert into timesheets (staff_id, site_id, work_date, start_time, finish_time, edit_note)
     values ('e0000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-00000000000a', today_nz() - 1, '09:00', '13:00', 'Last shift') $$,
  '23514',
  'Dee''s account is turned off, so you can''t add hours for them. The owner can turn it back on in More > Staff.',
  'The owner cannot add hours for a turned-off person');
select lives_ok(
  $$ insert into timesheets (staff_id, site_id, work_date, start_time, finish_time, edit_note)
     values ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', today_nz() - 1, '09:00', '13:00', 'Forgot') $$,
  'The owner can still add hours for someone active');
select throws_ok(
  $$ insert into training_records (topic, trainee_id) values ('allergens', 'f0000000-0000-0000-0000-00000000000f') $$,
  '23514',
  'Max''s account is turned off, so you can''t add training for them. The owner can turn it back on in More > Staff.',
  'The owner cannot record training for a turned-off manager');

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

select throws_ok(
  $$ insert into timesheets (staff_id, site_id, work_date, start_time, finish_time, edit_note)
     values ('e0000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-00000000000a', today_nz() - 1, '09:00', '13:00', 'Last shift') $$,
  '23514', null, 'A manager cannot add hours for a turned-off person');
select throws_ok(
  $$ insert into training_records (topic, trainee_id) values ('allergens', 'e0000000-0000-0000-0000-00000000000e') $$,
  '23514',
  'Dee''s account is turned off, so you can''t add training for them. The owner can turn it back on in More > Staff.',
  'A manager cannot record training for a turned-off person');
select lives_ok(
  $$ insert into training_records (topic, trainee_id) values ('allergens', 'a0000000-0000-0000-0000-00000000000a') $$,
  'A manager can still record training for someone active');

select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select throws_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time)
     values ('10000000-0000-0000-0000-00000000000a', today_nz() - 1, '09:00', '13:00') $$,
  '42501', 'Your account is turned off', 'Dee herself is told her account is turned off');

-- Not even the system (migrations, the seed, the SQL editor).
reset role;
select set_config('request.jwt.claims', '', true); -- no signed-in person
select throws_ok(
  $$ insert into leave_requests (staff_id, reason, start_date, end_date, hours, gi_symptoms)
     values ('e0000000-0000-0000-0000-00000000000e', 'sick', today_nz(), today_nz(), 8, false) $$,
  '23514',
  'Dee''s account is turned off, so you can''t add leave for them. The owner can turn it back on in More > Staff.',
  'Nobody can add leave for a turned-off person');
select throws_ok(
  $$ insert into shifts (site_id, staff_id) values ('10000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000f') $$,
  '23514',
  'Max''s account is turned off, so you can''t add a site choice for them. The owner can turn it back on in More > Staff.',
  'Nobody can add a site choice for a turned-off person');
select throws_ok(
  $$ insert into record_sheets (site_id, template_code, sheet_date, started_by)
     values ('10000000-0000-0000-0000-00000000000a', 'test_note', today_nz(), 'e0000000-0000-0000-0000-00000000000e') $$,
  '23514', null, 'Nobody can start a record sheet as a turned-off person');
insert into record_sheets (id, site_id, template_code, sheet_date, started_by)
  values ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'test_note', today_nz(),
          'a0000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ insert into record_entries (sheet_id, "values", recorded_by)
     values ('40000000-0000-0000-0000-00000000000a', '{"note":"x"}', 'e0000000-0000-0000-0000-00000000000e') $$,
  '23514',
  'Dee''s account is turned off, so you can''t add records for them. The owner can turn it back on in More > Staff.',
  'Nobody can add a record entry as a turned-off person');
select is(
  (select count(*)::int from timesheets where staff_id = 'e0000000-0000-0000-0000-00000000000e'),
  1, 'Dee''s existing timesheet is kept');
set local role authenticated;

-- Turning back on ------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select lives_ok(
  $$ select set_staff_active('e0000000-0000-0000-0000-00000000000e', true) $$,
  'The owner can turn Dee back on');
select results_eq(
  $$ select active, deactivated_at, deactivated_by from staff where id = 'e0000000-0000-0000-0000-00000000000e' $$,
  $$ values (true, null::timestamptz, null::uuid) $$,
  'Turning back on clears the date and who did it');

select lives_ok(
  $$ insert into timesheets (staff_id, site_id, work_date, start_time, finish_time, edit_note)
     values ('e0000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-00000000000a', today_nz() - 1, '09:00', '13:00', 'Back') $$,
  'Once turned back on, hours can be added for Dee again');

select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select is((select count(*)::int from timesheets), 2, 'Dee sees her timesheets again');

select * from finish();
rollback;
