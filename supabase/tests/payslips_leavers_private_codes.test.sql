-- Payslips part 2: the owner can give a turned-off person their final
-- payslip (and download it), nobody else can; payroll codes are readable
-- only by the owner and the person themselves.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- Setup (as postgres, which skips RLS) ---------------------------------------
-- Ana is staff, Mia a manager, Olly the owner, Tom a leaver (turned off).
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'mia@test.local'),
  ('d0000000-0000-0000-0000-00000000000d', 'olly@test.local'),
  ('e0000000-0000-0000-0000-00000000000e', 'tom@test.local');
insert into staff (id, name, role, payroll_code) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff', 'E101'),
  ('c0000000-0000-0000-0000-00000000000c', 'Mia', 'manager', 'E102'),
  ('d0000000-0000-0000-0000-00000000000d', 'Olly', 'owner', 'E100'),
  ('e0000000-0000-0000-0000-00000000000e', 'Tom', 'staff', 'E199');
update staff set active = false, deactivated_at = now()
  where id = 'e0000000-0000-0000-0000-00000000000e';

-- Tom's final payslip and a second file the owner's upload put in the bucket.
insert into storage.objects (bucket_id, name) values
  ('payslips', 'e0000000-0000-0000-0000-00000000000e/2026-11-20-55555555-5555-4555-8555-555555555555.pdf'),
  ('payslips', 'e0000000-0000-0000-0000-00000000000e/2026-11-20-56565656-5656-4656-8656-565656565656.pdf');

-- Leavers: the system (no owner) is still refused ---------------------------------
select throws_ok(
  $$ insert into payslips (staff_id, pay_date, period_start, period_end, file_path, source) values
       ('e0000000-0000-0000-0000-00000000000e', '2026-11-20', '2026-11-09', '2026-11-15',
        'e0000000-0000-0000-0000-00000000000e/2026-11-20-56565656-5656-4656-8656-565656565656.pdf', 'email') $$,
  '23514', null, 'Without the owner (an email, the SQL editor), a turned-off person still gets no payslip');

-- Leavers: the owner can ------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$ insert into payslips (staff_id, pay_date, period_start, period_end, file_path) values
       ('e0000000-0000-0000-0000-00000000000e', '2026-11-20', '2026-11-09', '2026-11-15',
        'e0000000-0000-0000-0000-00000000000e/2026-11-20-55555555-5555-4555-8555-555555555555.pdf') $$,
  'The owner uploads a turned-off person''s final payslip');
select is(
  (select count(*)::int from publish_payslips(array(select id from payslips where staff_id = 'e0000000-0000-0000-0000-00000000000e'))),
  1, 'The owner publishes it');
select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'payslips' and name = 'e0000000-0000-0000-0000-00000000000e/2026-11-20-55555555-5555-4555-8555-555555555555.pdf'),
  1, 'The owner can read the file, so they can download it and send it on');

-- Tom (turned off, token not yet expired) still sees nothing.
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-00000000000e","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from payslips), 0, 'The turned-off person can''t see their payslip in the app');
select is((select count(*)::int from storage.objects where bucket_id = 'payslips'), 0,
  'The turned-off person can''t open the file either');

-- A manager can't use the leaver exemption (or upload at all).
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$ insert into payslips (staff_id, pay_date, period_start, period_end, file_path) values
       ('e0000000-0000-0000-0000-00000000000e', '2026-11-27', '2026-11-16', '2026-11-22',
        'e0000000-0000-0000-0000-00000000000e/2026-11-20-56565656-5656-4656-8656-565656565656.pdf') $$,
  '23514', null, 'A manager can''t add payslips for a turned-off person');
select is((select count(*)::int from storage.objects where bucket_id = 'payslips'), 0,
  'A manager can''t download a leaver''s payslip');

-- Payroll codes: staff ----------------------------------------------------------------------
reset role;
select ok(not has_column_privilege('authenticated', 'public.staff', 'payroll_code', 'select'),
  'Logged-in users have no select privilege on staff.payroll_code');
select ok(has_column_privilege('authenticated', 'public.staff', 'name', 'select'),
  'The other staff columns are still readable');
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$ select payroll_code from staff $$, '42501', null,
  'Staff can''t read payroll codes from the staff table');
select throws_ok($$ select * from staff $$, '42501', null,
  'select * on staff is refused too (it includes payroll_code)');
select lives_ok($$ select id, name, role, email, active from staff $$,
  'Staff still read the other columns');
select is(
  (select array_agg(row(staff_id, payroll_code)::text) from staff_payroll_codes()),
  array[row('a0000000-0000-0000-0000-00000000000a'::uuid, 'E101')::text],
  'Staff see only their own payroll code');

-- Payroll codes: manager -------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$ select payroll_code from staff $$, '42501', null,
  'Managers can''t read payroll codes from the staff table');
select is(
  (select array_agg(payroll_code) from staff_payroll_codes()),
  array['E102'], 'Managers see only their own payroll code, not their staff''s');

-- Payroll codes: turned off ------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-00000000000e","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from staff_payroll_codes()), 0,
  'A turned-off person can''t read even their own code');

-- Payroll codes: owner -----------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal2"}', true);
select is(
  (select array_agg(payroll_code order by payroll_code) from staff_payroll_codes()
   where staff_id in ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000c',
                      'd0000000-0000-0000-0000-00000000000d', 'e0000000-0000-0000-0000-00000000000e')),
  array['E100', 'E101', 'E102', 'E199'], 'The owner sees everyone''s payroll code, leavers included');
select throws_ok($$ select payroll_code from staff $$, '42501', null,
  'Even the owner reads codes through staff_payroll_codes(), not the table');

-- The server's secret key (a future email webhook) sees them all.
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok((select count(*)::int from staff_payroll_codes()) >= 4, 'The secret key sees every payroll code');

-- Signed out: nothing.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from staff_payroll_codes() $$, '42501', null,
  'Signed-out visitors can''t call staff_payroll_codes');

-- The owner can still set codes (set_staff_payroll_code runs as the table owner).
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal2"}', true);
select lives_ok($$ select set_staff_payroll_code('a0000000-0000-0000-0000-00000000000a', 'E111') $$,
  'The owner still changes payroll codes');

select * from finish();
rollback;
