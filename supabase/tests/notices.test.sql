-- Notice board: who posts, who sees what, reads and acknowledgements.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- Setup (as postgres, which skips RLS) ---------------------------------------
-- The local database may already hold seeded notices, so the checks below
-- only count notices posted by Mia, the manager made here.
-- Ana (staff) chose Truck A 3 days ago and Truck B 40 days ago (too long ago).
-- Ben (staff) chose the Cafe today. Mia is a manager.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'mia@test.local');
insert into staff (id, name, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', 'Ben', 'staff'),
  ('c0000000-0000-0000-0000-00000000000c', 'Mia', 'manager');
insert into sites (id, name, kind) values
  ('10000000-0000-0000-0000-00000000000a', 'Truck A', 'truck'),
  ('10000000-0000-0000-0000-00000000000b', 'Truck B', 'truck'),
  ('10000000-0000-0000-0000-00000000000c', 'Cafe C', 'cafe');
insert into shifts (site_id, staff_id, clock_in, clock_out) values
  ('10000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', now() - interval '3 days', now() - interval '3 days' + interval '8 hours'),
  ('10000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a', now() - interval '40 days', now() - interval '40 days' + interval '8 hours'),
  ('10000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-00000000000b', now(), null);

-- Act as Mia (manager) -------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

select lives_ok(
  $$ insert into notices (title, body) values ('Everyone', 'For all staff') $$,
  'A manager can post a notice for everyone');
select is(
  (select posted_by from notices where title = 'Everyone'),
  'c0000000-0000-0000-0000-00000000000c'::uuid, 'posted_by is the manager');
select lives_ok(
  $$ insert into notices (title, body, site_ids, needs_ack) values
       ('Truck A only', 'New gas bottles', array['10000000-0000-0000-0000-00000000000a'::uuid], true),
       ('Truck B only', 'Old truck', array['10000000-0000-0000-0000-00000000000b'::uuid], false),
       ('Cafe only', 'Cafe meeting', array['10000000-0000-0000-0000-00000000000c'::uuid], false),
       ('To archive', 'Will be archived', null, false) $$,
  'A manager can post notices for sites');
select throws_ok(
  $$ insert into notices (title, body, site_ids) values ('Bad site', 'x', array['10000000-0000-0000-0000-0000000000ff'::uuid]) $$,
  '23514', null, 'A notice can''t be for a site that doesn''t exist');
select throws_ok(
  $$ insert into notices (title, body, site_ids) values ('No sites', 'x', '{}') $$,
  '23514', null, 'An empty site list is refused (null means everyone)');
select throws_ok(
  $$ insert into notices (title, body) values (repeat('x', 121), 'x') $$,
  '23514', null, 'Titles are at most 120 characters');
select throws_ok(
  $$ insert into notices (title, body) values ('Long', repeat('x', 2001)) $$,
  '23514', null, 'Bodies are at most 2000 characters');
select throws_ok(
  $$ insert into notices (title, body, posted_by) values ('Fake', 'x', 'a0000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'Nobody can post as someone else');

select lives_ok(
  $$ update notices set body = 'New gas bottles in the back locker' where title = 'Truck A only' $$,
  'A manager can edit a notice');
select isnt(
  (select edited_at from notices where title = 'Truck A only'),
  null, 'Editing stamps edited_at');
select is(
  (select edited_at from notices where title = 'Everyone'),
  null, 'Notices that weren''t edited have no edited_at');

select lives_ok(
  $$ update notices set archived_at = '2000-01-01' where title = 'To archive' $$,
  'A manager can archive a notice');
select ok(
  (select archived_at > now() - interval '1 minute' from notices where title = 'To archive'),
  'The archive time comes from the database clock, not the browser');
select throws_ok(
  $$ update notices set archived_at = null where title = 'To archive' $$,
  '42501', 'This notice is archived and can''t be changed', 'Archiving is final');
select throws_ok(
  $$ delete from notices where title = 'Everyone' $$,
  '42501', null, 'Nobody deletes notices, not even managers');

-- An expired notice (as postgres, so it can be posted in the past).
reset role;
insert into notices (title, body, posted_by, posted_at, expires_at) values
  ('Expired', 'Old news', 'c0000000-0000-0000-0000-00000000000c', now() - interval '2 days', now() - interval '1 day');
set local role authenticated;

select is(
  (select count(*)::int from notices where posted_by = 'c0000000-0000-0000-0000-00000000000c'),
  6, 'Managers see every notice, archived and expired too');

-- Act as Ana (staff) ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select is(
  (select array_agg(title order by title) from notices where posted_by = 'c0000000-0000-0000-0000-00000000000c'),
  array['Everyone', 'Truck A only'],
  'Ana sees notices for everyone and for Truck A (chosen 3 days ago), not Truck B (40 days ago), the cafe, expired or archived ones');

select throws_ok(
  $$ insert into notices (title, body) values ('Staff post', 'x') $$,
  '42501', null, 'Staff can''t post notices');

update notices set title = 'Hacked' where title = 'Everyone';
reset role;
select is(
  (select count(*)::int from notices where title = 'Hacked'),
  0, 'Staff can''t edit notices');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

-- Reads
select lives_ok(
  $$ insert into notice_reads (notice_id) select id from notices where title = 'Truck A only' $$,
  'Ana marks a notice read');
select is(
  (select staff_id from notice_reads),
  'a0000000-0000-0000-0000-00000000000a'::uuid, 'The read is Ana''s');
select throws_ok(
  $$ insert into notice_reads (notice_id, staff_id)
     select id, 'b0000000-0000-0000-0000-00000000000b' from notices where title = 'Everyone' $$,
  '42501', null, 'Ana can''t mark a read for Ben');

-- The cafe notice is invisible to Ana: look its id up as postgres.
reset role;
create temp table cafe_notice as select id from notices where title = 'Cafe only';
grant select on cafe_notice to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select throws_ok(
  $$ insert into notice_reads (notice_id) select id from cafe_notice $$,
  '42501', null, 'Ana can''t mark a notice read that isn''t for her');

select lives_ok(
  $$ update notice_reads set acknowledged_at = '2000-01-01'
     where notice_id = (select id from notices where title = 'Truck A only') $$,
  'Ana acknowledges the Truck A notice');
select ok(
  (select acknowledged_at > now() - interval '1 minute' from notice_reads),
  'The acknowledgement time comes from the database clock');
select throws_ok(
  $$ update notice_reads set acknowledged_at = null $$,
  '42501', 'An acknowledgement can''t be undone or changed', 'Ana can''t undo her acknowledgement');

select throws_ok(
  $$ delete from notice_reads $$,
  '42501', null, 'Staff can''t delete reads');

-- Act as Ben -----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select is(
  (select array_agg(title order by title) from notices where posted_by = 'c0000000-0000-0000-0000-00000000000c'),
  array['Cafe only', 'Everyone'], 'Ben sees the cafe notice and the one for everyone');
select is(
  (select count(*)::int from notice_reads),
  0, 'Ben doesn''t see Ana''s reads');

-- Even the SQL editor can't undo an acknowledgement.
reset role;
select throws_ok(
  $$ update notice_reads set acknowledged_at = null where staff_id = 'a0000000-0000-0000-0000-00000000000a' $$,
  '42501', 'An acknowledgement can''t be undone or changed', 'An acknowledgement can''t be undone even outside the API');

select * from finish();
rollback;
