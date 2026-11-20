-- Payslips: who sees which payslip and file, owner-only upload, publish and
-- withdraw, drafts invisible, never edited or deleted, payroll codes.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

-- Setup (as postgres, which skips RLS) ---------------------------------------
-- Ana and Ben are staff, Mia a manager, Olly the owner, Tom turned off.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'mia@test.local'),
  ('d0000000-0000-0000-0000-00000000000d', 'olly@test.local'),
  ('e0000000-0000-0000-0000-00000000000e', 'tom@test.local');
insert into staff (id, name, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', 'Ben', 'staff'),
  ('c0000000-0000-0000-0000-00000000000c', 'Mia', 'manager'),
  ('d0000000-0000-0000-0000-00000000000d', 'Olly', 'owner'),
  ('e0000000-0000-0000-0000-00000000000e', 'Tom', 'staff');
update staff set active = false, deactivated_at = now()
  where id = 'e0000000-0000-0000-0000-00000000000e';

-- The files the owner's upload would have put in the bucket (Ben's, Mia's
-- and Tom's; Ana's is uploaded below as the owner).
insert into storage.objects (bucket_id, name) values
  ('payslips', 'b0000000-0000-0000-0000-00000000000b/2026-11-20-22222222-2222-4222-8222-222222222222.pdf'),
  ('payslips', 'b0000000-0000-0000-0000-00000000000b/2026-11-20-23232323-2323-4323-8323-232323232323.pdf'),
  ('payslips', 'c0000000-0000-0000-0000-00000000000c/2026-11-20-33333333-3333-4333-8333-333333333333.pdf'),
  ('payslips', 'e0000000-0000-0000-0000-00000000000e/2026-11-20-55555555-5555-4555-8555-555555555555.pdf');

select ok((select not public from storage.buckets where id = 'payslips'), 'The payslips bucket is private');
select is(
  (select row(allowed_mime_types, file_size_limit)::text from storage.buckets where id = 'payslips'),
  row(array['application/pdf'], 2097152::bigint)::text, 'The bucket takes PDFs up to 2 MB');

-- Owner uploads ------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('payslips',
       'a0000000-0000-0000-0000-00000000000a/2026-11-20-11111111-1111-4111-8111-111111111111.pdf',
       'd0000000-0000-0000-0000-00000000000d') $$,
  'The owner uploads a payslip PDF');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('payslips', 'somewhere/else.pdf', 'd0000000-0000-0000-0000-00000000000d') $$,
  '42501', null, 'Even the owner can only upload to {staff_id}/{pay_date}-{uuid}.pdf');

select lives_ok(
  $$ insert into payslips (staff_id, pay_date, period_start, period_end, file_path) values
       ('a0000000-0000-0000-0000-00000000000a', '2026-11-20', '2026-11-09', '2026-11-15',
        'a0000000-0000-0000-0000-00000000000a/2026-11-20-11111111-1111-4111-8111-111111111111.pdf'),
       ('b0000000-0000-0000-0000-00000000000b', '2026-11-20', '2026-11-09', '2026-11-15',
        'b0000000-0000-0000-0000-00000000000b/2026-11-20-22222222-2222-4222-8222-222222222222.pdf'),
       ('c0000000-0000-0000-0000-00000000000c', '2026-11-20', '2026-11-09', '2026-11-15',
        'c0000000-0000-0000-0000-00000000000c/2026-11-20-33333333-3333-4333-8333-333333333333.pdf') $$,
  'The owner saves payslips for Ana, Ben and Mia');
select is(
  (select row(uploaded_by, source, published_at is null)::text from payslips where staff_id = 'a0000000-0000-0000-0000-00000000000a'),
  row('d0000000-0000-0000-0000-00000000000d'::uuid, 'upload', true)::text,
  'A new payslip is a draft, uploaded by the owner');
select throws_ok(
  $$ insert into payslips (staff_id, pay_date, period_start, period_end, file_path, published_at) values
       ('b0000000-0000-0000-0000-00000000000b', '2026-11-27', '2026-11-16', '2026-11-22',
        'b0000000-0000-0000-0000-00000000000b/2026-11-20-23232323-2323-4323-8323-232323232323.pdf', now()) $$,
  '42501', null, 'Nobody can save a payslip as already published');
select throws_ok(
  $$ insert into payslips (staff_id, pay_date, period_start, period_end, file_path) values
       ('a0000000-0000-0000-0000-00000000000a', '2026-11-27', '2026-11-16', '2026-11-22',
        'b0000000-0000-0000-0000-00000000000b/2026-11-20-23232323-2323-4323-8323-232323232323.pdf') $$,
  '23514', null, 'A payslip can''t point at a file in someone else''s folder');
select throws_ok(
  $$ insert into payslips (staff_id, pay_date, period_start, period_end, file_path) values
       ('a0000000-0000-0000-0000-00000000000a', '2026-11-27', '2026-11-16', '2026-11-22',
        'a0000000-0000-0000-0000-00000000000a/2026-11-27-99999999-9999-4999-8999-999999999999.pdf') $$,
  '23514', null, 'The PDF must be uploaded before the payslip is saved');
select throws_ok(
  $$ insert into payslips (staff_id, pay_date, period_start, period_end, file_path) values
       ('b0000000-0000-0000-0000-00000000000b', '2026-11-20', '2026-11-09', '2026-11-15',
        'b0000000-0000-0000-0000-00000000000b/2026-11-20-23232323-2323-4323-8323-232323232323.pdf') $$,
  '23505', null, 'One live payslip per person per pay run');
-- Turned-off people (final pay): payslips_leavers_private_codes.test.sql.
select throws_ok(
  $$ insert into payslips (staff_id, pay_date, period_start, period_end, file_path, source) values
       ('b0000000-0000-0000-0000-00000000000b', '2026-11-20', '2026-11-16', '2026-11-22',
        'b0000000-0000-0000-0000-00000000000b/2026-11-20-23232323-2323-4323-8323-232323232323.pdf', 'email') $$,
  '42501', null, 'Only the server (secret key) can add email payslips');

-- Drafts are invisible --------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select is((select count(*)::int from payslips), 0, 'Staff don''t see unpublished payslips, even their own');
select is((select count(*)::int from storage.objects where bucket_id = 'payslips'), 0,
  'Staff can''t see the file of an unpublished payslip');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('payslips',
       'a0000000-0000-0000-0000-00000000000a/2026-11-27-44444444-4444-4444-8444-444444444444.pdf',
       'a0000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'Staff can''t upload payslip files');
select throws_ok(
  $$ insert into payslips (staff_id, pay_date, period_start, period_end, file_path) values
       ('a0000000-0000-0000-0000-00000000000a', '2026-11-20', '2026-11-16', '2026-11-22',
        'a0000000-0000-0000-0000-00000000000a/2026-11-20-11111111-1111-4111-8111-111111111111.pdf') $$,
  '42501', null, 'Staff can''t add payslips');
select throws_ok($$ select * from publish_payslips(array(select id from payslips)) $$,
  '42501', null, 'Staff can''t publish');

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select count(*)::int from payslips), 0, 'Managers don''t see unpublished payslips either');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('payslips',
       'c0000000-0000-0000-0000-00000000000c/2026-11-27-44444444-4444-4444-8444-444444444444.pdf',
       'c0000000-0000-0000-0000-00000000000c') $$,
  '42501', null, 'Managers can''t upload payslip files');

-- Publish -------------------------------------------------------------------------------
reset role;
create temp table ids as select staff_id, id from payslips
  where staff_id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000c');
grant select on ids to authenticated;
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select throws_ok($$ select * from publish_payslips(array(select id from ids)) $$,
  '42501', null, 'Managers can''t publish');

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select is((select count(*)::int from publish_payslips(array(select id from ids))), 3,
  'The owner publishes all three');
select is((select count(*)::int from publish_payslips(array(select id from ids))), 0,
  'Publishing again changes nothing');

-- Each person sees only their own -----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select array_agg(staff_id) from payslips), array['a0000000-0000-0000-0000-00000000000a'::uuid],
  'Ana sees only her own published payslip');
select is(
  (select array_agg(name) from storage.objects where bucket_id = 'payslips'),
  array['a0000000-0000-0000-0000-00000000000a/2026-11-20-11111111-1111-4111-8111-111111111111.pdf'],
  'Ana can open only her own file');
select is((select count(*)::int from payslips where staff_id = 'b0000000-0000-0000-0000-00000000000b'), 0,
  'Ana can''t see Ben''s payslip');

select lives_ok($$ select mark_payslip_viewed((select id from ids where staff_id = 'a0000000-0000-0000-0000-00000000000a')) $$,
  'Ana opens her payslip');
select isnt((select viewed_at from payslips), null, 'Her first view is stamped');
create temp table first_view as select viewed_at from payslips;
select lives_ok($$ select mark_payslip_viewed((select id from ids where staff_id = 'a0000000-0000-0000-0000-00000000000a')) $$,
  'Opening it again is fine');
select is((select viewed_at from payslips), (select viewed_at from first_view), 'Only the first view counts');
select lives_ok($$ select mark_payslip_viewed((select id from ids where staff_id = 'b0000000-0000-0000-0000-00000000000b')) $$,
  'Marking someone else''s as viewed quietly does nothing');

select throws_ok($$ update payslips set file_path = 'x' $$, '42501', null, 'Staff can''t change a payslip');
select throws_ok($$ delete from payslips $$, '42501', null, 'Staff can''t delete a payslip');
select throws_ok($$ select withdraw_payslip((select id from ids where staff_id = 'a0000000-0000-0000-0000-00000000000a'), 'mine') $$,
  '42501', null, 'Staff can''t withdraw');

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select array_agg(staff_id) from payslips), array['c0000000-0000-0000-0000-00000000000c'::uuid],
  'A manager sees only her own payslip, not her staff''s');
select is((select count(*)::int from storage.objects where bucket_id = 'payslips' and name not like 'c0000000%'), 0,
  'A manager can''t open anyone else''s file');
select throws_ok($$ select withdraw_payslip((select id from ids where staff_id = 'b0000000-0000-0000-0000-00000000000b'), 'oops') $$,
  '42501', null, 'Managers can''t withdraw');

-- Withdraw --------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select is((select count(*)::int from payslips where staff_id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000c')), 3, 'The owner sees every payslip');
select is((select count(*)::int from storage.objects where bucket_id = 'payslips'
             and split_part(name, '/', 1) in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b',
                                              'c0000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-00000000000e')),
  5, 'The owner sees every file');
select lives_ok($$ select mark_payslip_viewed((select id from ids where staff_id = 'b0000000-0000-0000-0000-00000000000b')) $$,
  'The owner opens Ben''s payslip');
select is((select viewed_at from payslips where staff_id = 'b0000000-0000-0000-0000-00000000000b'), null,
  'The owner opening it doesn''t count as Ben seeing it');
select throws_ok($$ select withdraw_payslip((select id from ids where staff_id = 'b0000000-0000-0000-0000-00000000000b'), '  ') $$,
  '22023', null, 'Withdrawing needs a reason');
select lives_ok($$ select withdraw_payslip((select id from ids where staff_id = 'b0000000-0000-0000-0000-00000000000b'), 'Wrong hours') $$,
  'The owner withdraws Ben''s payslip');
select lives_ok(
  $$ insert into payslips (staff_id, pay_date, period_start, period_end, file_path) values
       ('b0000000-0000-0000-0000-00000000000b', '2026-11-20', '2026-11-09', '2026-11-15',
        'b0000000-0000-0000-0000-00000000000b/2026-11-20-23232323-2323-4323-8323-232323232323.pdf') $$,
  'A corrected payslip can be uploaded for the same run once the old one is withdrawn');
select is((select count(*)::int from publish_payslips(array(select id from ids))), 0,
  'A withdrawn payslip can''t be published again');

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from payslips), 0, 'Ben no longer sees the withdrawn payslip (the correction is a draft)');
select is((select count(*)::int from storage.objects where bucket_id = 'payslips'), 0, 'Ben can''t open the withdrawn file');

-- Kept, never edited or deleted (even as postgres) ----------------------------------------------
reset role;
select is(
  (select withdrawn_reason from payslips where id = (select id from ids where staff_id = 'b0000000-0000-0000-0000-00000000000b')),
  'Wrong hours', 'The withdrawn payslip is kept, with its reason');
select throws_ok($$ delete from payslips $$, '42501', null, 'Nobody deletes payslips, even in the SQL editor');
select throws_ok(
  $$ update payslips set published_at = null where staff_id = 'a0000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'A published payslip can''t be unpublished');
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd in ('DELETE', 'UPDATE', 'ALL')
      and (qual like '%payslips%' or with_check like '%payslips%')
  ),
  'No policy lets anyone replace or delete a payslip file');

-- Payroll codes ----------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select throws_ok($$ select set_staff_payroll_code('a0000000-0000-0000-0000-00000000000a', 'E1') $$,
  '42501', null, 'Only the owner sets payroll codes');

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select lives_ok($$ select set_staff_payroll_code('a0000000-0000-0000-0000-00000000000a', ' e012 ') $$,
  'The owner sets Ana''s payroll code');
select throws_ok($$ select set_staff_payroll_code('b0000000-0000-0000-0000-00000000000b', 'E012') $$,
  '23514', 'Ana already has payroll code E012', 'Payroll codes are unique, ignoring case');

select * from finish();
rollback;
