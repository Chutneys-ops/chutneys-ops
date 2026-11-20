-- Notice board: once anyone has acknowledged a notice, its title and body
-- are locked. Settings, archiving and notices without acknowledgements stay
-- editable.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Setup (as postgres) ----------------------------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'mia@test.local'),
  ('e0000000-0000-0000-0000-00000000000e', 'oli@test.local');
insert into staff (id, name, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff'),
  ('c0000000-0000-0000-0000-00000000000c', 'Mia', 'manager'),
  ('e0000000-0000-0000-0000-00000000000e', 'Oli', 'owner');

-- Mia posts three notices for everyone.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
insert into notices (title, body, needs_ack) values
  ('Confirmed', 'Wear gloves', true),
  ('Read only', 'Not confirmed yet', true),
  ('Plain', 'No acknowledgement needed', false);

-- Ana acknowledges "Confirmed", and only reads "Read only" and "Plain".
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into notice_reads (notice_id) select id from notices where title in ('Confirmed', 'Read only', 'Plain');
update notice_reads set acknowledged_at = now()
where notice_id = (select id from notices where title = 'Confirmed');

-- Back to Mia ----------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

select throws_ok(
  $$ update notices set title = 'Wear gloves always' where title = 'Confirmed' $$,
  '23514', 'People have already confirmed this notice. Archive it and post a new one.',
  'The title of an acknowledged notice can''t be edited');
select throws_ok(
  $$ update notices set body = 'Wear gloves always' where title = 'Confirmed' $$,
  '23514', 'People have already confirmed this notice. Archive it and post a new one.',
  'The body of an acknowledged notice can''t be edited');
select throws_ok(
  $$ update notices set needs_ack = false, body = 'Changed' where title = 'Confirmed' $$,
  '23514', null,
  'Turning needs_ack off in the same edit doesn''t unlock the wording');

select lives_ok(
  $$ update notices set pinned = true where title = 'Confirmed' $$,
  'An acknowledged notice can still be pinned');
select lives_ok(
  $$ update notices set expires_at = now() + interval '7 days' where title = 'Confirmed' $$,
  'An acknowledged notice can still get an expiry date');
select lives_ok(
  $$ update notices set title = 'Confirmed', body = 'Wear gloves', pinned = false where title = 'Confirmed' $$,
  'Sending the same title and body back (as the edit form does) is fine');
select lives_ok(
  $$ update notices set needs_ack = false where title = 'Confirmed' $$,
  'needs_ack itself can still be turned off');
select throws_ok(
  $$ update notices set body = 'Changed after turning needs_ack off' where title = 'Confirmed' $$,
  '23514', null,
  'Once acknowledged, the wording stays locked even after needs_ack is turned off');

select lives_ok(
  $$ update notices set body = 'Reworded before anyone confirmed' where title = 'Read only' $$,
  'A needs_ack notice that was only read (not acknowledged) can still be edited');
select lives_ok(
  $$ update notices set title = 'Plain, reworded', body = 'Still plain' where title = 'Plain' $$,
  'A notice without needs_ack can still be edited after being read');

select lives_ok(
  $$ update notices set archived_at = now() where title = 'Confirmed' $$,
  'An acknowledged notice can be archived');

-- The owner and the SQL editor are held to it too. (A fresh notice, since
-- "Confirmed" is archived now.)
reset role;
insert into notices (title, body, needs_ack, posted_by) values
  ('Owner test', 'Original', true, 'c0000000-0000-0000-0000-00000000000c');
insert into notice_reads (notice_id, staff_id)
  select id, 'a0000000-0000-0000-0000-00000000000a' from notices where title = 'Owner test';
update notice_reads set acknowledged_at = now()
where notice_id = (select id from notices where title = 'Owner test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select throws_ok(
  $$ update notices set body = 'Owner edit' where title = 'Owner test' $$,
  '23514', null, 'The owner can''t edit an acknowledged notice either');

reset role;
select throws_ok(
  $$ update notices set body = 'SQL editor edit' where title = 'Owner test' $$,
  '23514', null, 'Not even outside the API');

select * from finish();
rollback;
