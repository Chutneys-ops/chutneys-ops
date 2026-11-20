-- Training records: who can create, confirm_training, the lock, RLS and
-- signature storage policies.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- Setup (as postgres, which skips RLS) ---------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'mia@test.local');
insert into staff (id, name, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', 'Ben', 'staff'),
  ('c0000000-0000-0000-0000-00000000000c', 'Mia', 'manager');

insert into storage.buckets (id, name) values ('signatures', 'signatures') on conflict (id) do nothing;
insert into storage.objects (bucket_id, name, owner_id) values
  ('signatures', 'a0000000-0000-0000-0000-00000000000a/sig.png', 'a0000000-0000-0000-0000-00000000000a'),
  ('signatures', 'b0000000-0000-0000-0000-00000000000b/sig.png', 'b0000000-0000-0000-0000-00000000000b');

-- Act as Ana (staff) ---------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select throws_ok(
  $$ insert into training_records (topic, trainee_id) values ('allergens', 'b0000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'Staff cannot create training records');

-- Act as Mia (manager) -------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

select lives_ok(
  $$ insert into training_records (topic, trainee_id, notes) values ('allergens', 'a0000000-0000-0000-0000-00000000000a', 'Ana allergens') $$,
  'A manager can record training for Ana');

select is(
  (select row(trainer_id, trained_on, trainer_signed_at is not null)::text from training_records where notes = 'Ana allergens'),
  row('c0000000-0000-0000-0000-00000000000c'::uuid, today_nz(), true)::text,
  'Trainer, date and trainer signature are filled in by the database');

select lives_ok(
  $$ insert into training_records (topic, trainee_id, notes) values ('cleaning', 'b0000000-0000-0000-0000-00000000000b', 'Ben cleaning') $$,
  'A manager can record training for Ben');

select throws_ok(
  $$ insert into training_records (topic, trainee_id, trainer_signed_at) values ('cleaning', 'a0000000-0000-0000-0000-00000000000a', '2020-01-01') $$,
  '42501', null, 'Nobody can set trainer_signed_at');

select throws_ok(
  $$ insert into training_records (topic, trainee_id, trainee_signed_at) values ('cleaning', 'a0000000-0000-0000-0000-00000000000a', now()) $$,
  '42501', null, 'A manager cannot sign for the trainee');

select throws_ok(
  $$ insert into training_records (topic, trainee_id, trained_on) values ('cleaning', 'a0000000-0000-0000-0000-00000000000a', today_nz() + 1) $$,
  '42501', null, 'Training cannot be dated in the future');

select throws_ok(
  $$ insert into training_records (topic, trainee_id) values ('other', 'a0000000-0000-0000-0000-00000000000a') $$,
  '23514', null, 'Topic "other" needs a detail');

select throws_ok(
  $$ insert into training_records (topic, trainee_id) values ('induction', 'c0000000-0000-0000-0000-00000000000c') $$,
  '23514', null, 'A manager cannot record training for herself');

-- Act as Ana -----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select is(
  (select array_agg(notes) from training_records),
  array['Ana allergens'], 'Ana sees only her own training');

select throws_ok(
  $$ select confirm_training((select id from training_records where notes = 'Ana allergens'),
                             'b0000000-0000-0000-0000-00000000000b/sig.png') $$,
  '42501', null, 'Ana cannot use Ben''s signature');

select throws_ok(
  $$ update training_records set trainer_signed_at = now() where notes = 'Ana allergens' $$,
  '42501', null, 'Ana cannot change trainer_signed_at');

select lives_ok(
  $$ select confirm_training((select id from training_records where notes = 'Ana allergens'),
                             'a0000000-0000-0000-0000-00000000000a/sig.png') $$,
  'Ana confirms her training with her drawn signature');

select isnt(
  (select trainee_signed_at from training_records where notes = 'Ana allergens'),
  null, 'trainee_signed_at is stamped');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'signatures'),
  1, 'Ana sees only her own signature file');

-- Confirming again: nothing changes.
create temp table first_sign as
  select trainee_signed_at, trainee_signature_path from training_records where notes = 'Ana allergens';
select lives_ok(
  $$ select confirm_training((select id from training_records where notes = 'Ana allergens'), null) $$,
  'Confirming twice is not an error');
select is(
  (select row(trainee_signed_at, trainee_signature_path)::text from training_records where notes = 'Ana allergens'),
  (select row(trainee_signed_at, trainee_signature_path)::text from first_sign),
  'Confirming twice changes nothing');

-- Act as Ben -----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select throws_ok(
  $$ select confirm_training('00000000-0000-0000-0000-000000000000'::uuid, null) $$,
  '42501', null, 'Confirming a record that isn''t yours fails');

-- Ben can't even see Ana's record, so look its id up as postgres.
reset role;
create temp table ana_record as select id from training_records where notes = 'Ana allergens';
grant select on ana_record to authenticated;
set local role authenticated;

select throws_ok(
  $$ select confirm_training((select id from ana_record), null) $$,
  '42501', null, 'Ben cannot confirm Ana''s training');

-- The lock holds even for code that skips the grants (here: postgres).
reset role;
select throws_ok(
  $$ update training_records set notes = 'changed' where notes = 'Ana allergens' $$,
  '42501', 'This training record is signed by both and can''t be changed',
  'A record signed by both can''t be changed');

select throws_ok(
  $$ update training_records set topic = 'induction' where notes = 'Ben cleaning' $$,
  '42501', 'Only the trainee''s confirmation can be added to a training record',
  'Before signing, only the trainee''s confirmation can be added');

select * from finish();
rollback;
