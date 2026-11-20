-- Sick leave: grants, RLS, decide_leave, the vomiting/diarrhoea exclusion
-- (start_shift, clear_to_work) and certificate storage policies.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- Setup (as postgres, which skips RLS) ---------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'mia@test.local'),
  ('d0000000-0000-0000-0000-00000000000d', 'olly@test.local');
insert into staff (id, name, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', 'Ben', 'staff'),
  ('c0000000-0000-0000-0000-00000000000c', 'Mia', 'manager'),
  ('d0000000-0000-0000-0000-00000000000d', 'Olly', 'owner');
insert into sites (id, name, kind) values
  ('10000000-0000-0000-0000-00000000000a', 'Test truck A', 'truck');

insert into storage.buckets (id, name) values ('leave-documents', 'leave-documents') on conflict (id) do nothing;
-- Ben's certificate: Ana must not see it or use it.
insert into storage.objects (bucket_id, name, owner_id) values
  ('leave-documents', 'b0000000-0000-0000-0000-00000000000b/ben-cert.pdf', 'b0000000-0000-0000-0000-00000000000b');

-- Act as Ana -----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok(
  $$ insert into leave_requests (reason, start_date, end_date, hours, gi_symptoms, note)
     values ('sick', '2026-11-18', '2026-11-18', 8, false, 'Flu') $$,
  'Ana can request sick leave');

select is(
  (select staff_id from leave_requests where note = 'Flu'),
  'a0000000-0000-0000-0000-00000000000a'::uuid,
  'staff_id defaults to Ana');

select is((select status from leave_requests where note = 'Flu'), 'pending', 'A new request is pending');

select throws_ok(
  $$ insert into leave_requests (reason, start_date, end_date, hours, gi_symptoms, status)
     values ('sick', '2026-11-18', '2026-11-18', 8, false, 'approved') $$,
  '42501', null, 'Ana cannot set the status');

select throws_ok(
  $$ insert into leave_requests (reason, start_date, end_date, hours, gi_symptoms, decided_by, decided_at)
     values ('sick', '2026-11-18', '2026-11-18', 8, false, 'a0000000-0000-0000-0000-00000000000a', now()) $$,
  '42501', null, 'Ana cannot set decided_by or decided_at');

select throws_ok(
  $$ insert into leave_requests (reason, start_date, end_date, hours, gi_symptoms, cleared_to_work_at, cleared_by)
     values ('sick', '2026-11-18', '2026-11-18', 8, true, now(), 'a0000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'Ana cannot clear herself');

select throws_ok(
  $$ insert into leave_requests (reason, start_date, end_date, hours, gi_symptoms, staff_id)
     values ('sick', '2026-11-18', '2026-11-18', 8, false, 'b0000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'Ana cannot request leave for Ben');

select throws_ok(
  $$ insert into leave_requests (reason, start_date, end_date, hours, gi_symptoms)
     values ('sick', '2026-11-18', '2026-11-17', 8, false) $$,
  '23514', null, 'The end date cannot be before the start date');

select throws_ok(
  $$ insert into leave_requests (reason, start_date, end_date, hours, gi_symptoms)
     values ('sick', '2026-11-18', '2026-11-18', 0, false) $$,
  '23514', null, 'Hours must be more than 0');

select throws_ok(
  $$ update leave_requests set status = 'approved' where note = 'Flu' $$,
  '42501', null, 'Ana cannot approve her request by editing it');

select throws_ok(
  $$ select decide_leave((select id from leave_requests where note = 'Flu'), 'approved', null, null) $$,
  '42501', null, 'Staff cannot decide leave');

-- Certificates
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('leave-documents', 'a0000000-0000-0000-0000-00000000000a/cert.jpg', 'a0000000-0000-0000-0000-00000000000a') $$,
  'Ana can upload a certificate into her own folder');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('leave-documents', 'b0000000-0000-0000-0000-00000000000b/fake.jpg', 'a0000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'Ana cannot upload into Ben''s folder');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'leave-documents'),
  1, 'Ana cannot read Ben''s certificate');

select throws_ok(
  $$ insert into leave_requests (reason, start_date, end_date, hours, gi_symptoms, certificate_path)
     values ('sick', '2026-11-18', '2026-11-18', 8, false, 'b0000000-0000-0000-0000-00000000000b/ben-cert.pdf') $$,
  '42501', null, 'Ana cannot attach Ben''s certificate');

select lives_ok(
  $$ insert into leave_requests (reason, start_date, end_date, hours, gi_symptoms, certificate_path, note)
     values ('injured', '2026-11-19', '2026-11-20', 16, false, 'a0000000-0000-0000-0000-00000000000a/cert.jpg', 'Cut') $$,
  'Ana can attach her own certificate');

-- Food safety exclusion
select lives_ok(
  $$ select start_shift('10000000-0000-0000-0000-00000000000a') $$,
  'Ana can clock in');

select lives_ok(
  $$ insert into leave_requests (reason, start_date, end_date, hours, gi_symptoms, note)
     values ('sick', '2026-11-20', '2026-11-21', 16, true, 'Tummy') $$,
  'Ana reports vomiting or diarrhoea');

select is(
  (select count(*)::int from shifts where staff_id = auth.uid() and clock_out is null),
  0, 'Reporting vomiting or diarrhoea clocks Ana out');

select is(needs_clearance(), true, 'Ana needs clearing');

select throws_ok(
  $$ select start_shift('10000000-0000-0000-0000-00000000000a') $$,
  '42501', 'Your manager needs to clear you to return to work after illness',
  'An uncleared vomiting/diarrhoea report blocks clocking in');

-- Act as Ben -----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select lives_ok(
  $$ insert into leave_requests (reason, start_date, end_date, hours, gi_symptoms, note)
     values ('caring_for_dependant', '2026-11-18', '2026-11-18', 4, false, 'Sick kid') $$,
  'Ben can request leave');

select is(
  (select array_agg(note) from leave_requests),
  array['Sick kid'], 'Ben sees only his own requests');

select is(needs_clearance(), false, 'needs_clearance() only says whether YOU need clearing');

select throws_ok(
  $$ select clear_to_work((select id from leave_requests where note = 'Tummy')) $$,
  '42501', null, 'Staff cannot clear someone to work');

-- Act as Mia (manager) -------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

-- Only count the test people: the local database may have real test data too.
select is(
  (select count(*)::int from leave_requests
   where staff_id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b')),
  4, 'A manager sees every request');

select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'leave-documents' and (name like 'a0000000-%' or name like 'b0000000-%')),
  2, 'A manager can read every certificate');

select lives_ok(
  $$ select decide_leave((select id from leave_requests where note = 'Flu'), 'approved', 6, 'Left at 10') $$,
  'A manager can approve with adjusted hours');

select is(
  (select row(status, hours, decided_by)::text from leave_requests where note = 'Flu'),
  row('approved', 6.00::numeric(5,2), 'c0000000-0000-0000-0000-00000000000c'::uuid)::text,
  'Approved with 6 hours, decided by Mia');

select throws_ok(
  $$ select decide_leave((select id from leave_requests where note = 'Flu'), 'declined', null, 'Changed my mind') $$,
  '23514', null, 'A decision is final');

select throws_ok(
  $$ select decide_leave((select id from leave_requests where note = 'Sick kid'), 'declined', null, '  ') $$,
  '23514', null, 'Declining needs a note');

select lives_ok(
  $$ insert into leave_requests (reason, start_date, end_date, hours, gi_symptoms, note)
     values ('sick', '2026-11-18', '2026-11-18', 8, false, 'Mia sick') $$,
  'Mia can request her own leave');

select throws_ok(
  $$ select decide_leave((select id from leave_requests where note = 'Mia sick'), 'approved', null, null) $$,
  '42501', null, 'A manager cannot decide her own leave');

select throws_ok(
  $$ select clear_to_work((select id from leave_requests where note = 'Flu')) $$,
  '23514', null, 'Only vomiting or diarrhoea needs clearing');

select lives_ok(
  $$ select clear_to_work((select id from leave_requests where note = 'Tummy')) $$,
  'A manager can clear Ana to return to work');

-- Act as Olly (owner) --------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);

select lives_ok(
  $$ select decide_leave((select id from leave_requests where note = 'Mia sick'), 'approved', null, null) $$,
  'The owner can decide a manager''s leave');

-- Back to Ana ----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select is(needs_clearance(), false, 'Ana no longer needs clearing');

select lives_ok(
  $$ select start_shift('10000000-0000-0000-0000-00000000000a') $$,
  'Once cleared, Ana can clock in again');

select * from finish();
rollback;
