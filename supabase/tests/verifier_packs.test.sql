-- Verifier packs: the private "verifier-packs" bucket (owner reads, only the
-- server writes) and the monthly scheduler.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Setup (as postgres, which skips RLS) ---------------------------------------
-- Ana is staff, Mia a manager, Olly the owner.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'mia@test.local'),
  ('d0000000-0000-0000-0000-00000000000d', 'olly@test.local');
insert into staff (id, name, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff'),
  ('c0000000-0000-0000-0000-00000000000c', 'Mia', 'manager'),
  ('d0000000-0000-0000-0000-00000000000d', 'Olly', 'owner');

-- A stored monthly copy (the job uploads with the secret key, no owner).
insert into storage.objects (bucket_id, name) values ('verifier-packs', '2026/2026-10.pdf');

select ok(
  (select not public from storage.buckets where id = 'verifier-packs'),
  'The verifier-packs bucket exists and is private');
select is(
  (select allowed_mime_types from storage.buckets where id = 'verifier-packs'),
  array['application/pdf'], 'The bucket only takes PDFs');

-- Staff ------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select is((select count(*)::int from storage.objects where bucket_id = 'verifier-packs'), 0,
  'Staff can''t see the monthly copies');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('verifier-packs', '2026/2026-11.pdf', 'a0000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'Staff can''t upload a pack');

-- Manager ----------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

select is((select count(*)::int from storage.objects where bucket_id = 'verifier-packs'), 0,
  'Managers make packs on demand but can''t see the stored monthly copies');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('verifier-packs', '2026/2026-11.pdf', 'c0000000-0000-0000-0000-00000000000c') $$,
  '42501', null, 'Managers can''t upload a pack');

-- Owner ------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);

select is((select count(*)::int from storage.objects where bucket_id = 'verifier-packs'), 1,
  'The owner sees the monthly copies');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('verifier-packs', '2026/2026-11.pdf', 'd0000000-0000-0000-0000-00000000000d') $$,
  '42501', null, 'Even the owner can''t upload: only the server writes packs');

-- No update policy: this quietly changes nothing. (Storage itself refuses
-- direct deletes from SQL, and there's no delete policy for its API either.)
update storage.objects set name = '2026/renamed.pdf' where bucket_id = 'verifier-packs';
select is((select name from storage.objects where bucket_id = 'verifier-packs'), '2026/2026-10.pdf',
  'Nobody can rename or replace a stored copy through the API');
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd in ('DELETE', 'ALL', 'INSERT', 'UPDATE') and permissive = 'PERMISSIVE'
      and (qual like '%verifier-packs%' or with_check like '%verifier-packs%')
  ),
  'No policy lets anyone upload, change or delete packs');

-- The owner's policy is only for this bucket.
reset role;
insert into storage.buckets (id, name) values ('signatures', 'signatures') on conflict (id) do nothing;
insert into storage.objects (bucket_id, name, owner_id)
  values ('signatures', 'a0000000-0000-0000-0000-00000000000a/sig.png', 'a0000000-0000-0000-0000-00000000000a');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'verifier-packs'), 0,
  'Managers still see no packs after other buckets get files');

-- The scheduler ----------------------------------------------------------------
select throws_ok($$ select run_verifier_pack() $$, '42501', null,
  'The API can''t call run_verifier_pack');

reset role;
select is(
  (select schedule from cron.job where jobname = 'verifier-pack'),
  '30 14 * * *', 'pg_cron runs the verifier pack check every day at 14:30 UTC');
select is(
  (select command from cron.job where jobname = 'verifier-pack'),
  'select public.run_verifier_pack()', 'The job calls run_verifier_pack');
select ok(
  not has_function_privilege('anon', 'public.run_verifier_pack()', 'execute'),
  'Signed-out visitors can''t call run_verifier_pack either');

select * from finish();
rollback;
