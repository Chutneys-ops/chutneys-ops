-- Rosters: only managers write and publish; staff see only their own shifts
-- in published weeks; breaks and paid minutes come from the database; no
-- overlaps at any site; turned-off people can't be rostered; warnings.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

-- Setup (as postgres, which skips RLS) -----------------------------------------
-- Weeks far in the future so nothing seeded gets in the way:
--   2029-12-31 (Monday, "last week") and 2030-01-07 (Monday, "this week").
-- Ana and Ben are staff, Mia a manager, Tom a staff member who has left.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'mia@test.local'),
  ('e0000000-0000-0000-0000-00000000000e', 'tom@test.local');
insert into staff (id, name, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', 'Ben', 'staff'),
  ('c0000000-0000-0000-0000-00000000000c', 'Mia', 'manager'),
  ('e0000000-0000-0000-0000-00000000000e', 'Tom', 'staff');
update staff set active = false, deactivated_at = now() where id = 'e0000000-0000-0000-0000-00000000000e';
insert into sites (id, name, kind) values
  ('10000000-0000-0000-0000-00000000000a', 'Truck A', 'truck'),
  ('10000000-0000-0000-0000-00000000000b', 'Cafe B', 'cafe');
-- Ana has approved leave on Wednesday 9 January 2030.
insert into leave_requests (staff_id, reason, start_date, end_date, hours, gi_symptoms, status, decided_by, decided_at)
values ('a0000000-0000-0000-0000-00000000000a', 'sick', '2030-01-09', '2030-01-09', 8, false,
        'approved', 'c0000000-0000-0000-0000-00000000000c', now());

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

-- Act as Mia (manager) ---------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

insert into ids values
  ('a_week', ensure_roster_week('10000000-0000-0000-0000-00000000000a', '2030-01-07')),
  ('b_week', ensure_roster_week('10000000-0000-0000-0000-00000000000b', '2030-01-07')),
  ('a_last', ensure_roster_week('10000000-0000-0000-0000-00000000000a', '2029-12-31'));

select is(
  ensure_roster_week('10000000-0000-0000-0000-00000000000a', '2030-01-07'),
  (select id from ids where name = 'a_week'),
  'ensure_roster_week returns the same week the second time');
select throws_ok(
  $$ select ensure_roster_week('10000000-0000-0000-0000-00000000000a', '2030-01-08') $$,
  '22023', 'A roster week starts on a Monday', 'A week must start on a Monday');

select lives_ok(
  $$ insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time, position)
     values ((select id from ids where name = 'a_week'), 'a0000000-0000-0000-0000-00000000000a',
             '2030-01-07', '09:00', '17:00', ' Kitchen ') $$,
  'A manager adds a shift');
select is(
  (select row(minutes_at_work, rest_breaks, meal_breaks, paid_minutes, position, site_id, created_by)::text
   from roster_shifts where staff_id = 'a0000000-0000-0000-0000-00000000000a' and work_date = '2030-01-07'),
  row(480, 2, 1, 450, 'Kitchen', '10000000-0000-0000-0000-00000000000a'::uuid,
      'c0000000-0000-0000-0000-00000000000c'::uuid)::text,
  '8 hours: 2 rest, 1 meal, 7.5 hours paid; position trimmed; site from the week; created by Mia');
select is(
  (select start_at from roster_shifts where staff_id = 'a0000000-0000-0000-0000-00000000000a' and work_date = '2030-01-07'),
  ('2030-01-07'::date + '09:00'::time) at time zone 'Pacific/Auckland',
  'start_at is 9:00 Auckland time');

select lives_ok(
  $$ insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time)
     values ((select id from ids where name = 'a_week'), 'a0000000-0000-0000-0000-00000000000a',
             '2030-01-08', '20:00', '02:00') $$,
  'A shift past midnight is fine');
select is(
  (select finish_at - start_at from roster_shifts
   where staff_id = 'a0000000-0000-0000-0000-00000000000a' and work_date = '2030-01-08'),
  interval '6 hours', 'Finish before start means the next morning');

select throws_ok(
  $$ insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time)
     values ((select id from ids where name = 'a_week'), 'b0000000-0000-0000-0000-00000000000b',
             '2030-01-14', '09:00', '12:00') $$,
  '23514', null, 'A day outside the roster week is refused');
select throws_ok(
  $$ insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time)
     values ((select id from ids where name = 'a_week'), 'b0000000-0000-0000-0000-00000000000b',
             '2030-01-07', '05:00', '22:00') $$,
  '23514', 'A shift can be at most 16 hours', 'More than 16 hours is refused');

-- Overlaps, at any site.
select throws_ok(
  $$ insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time)
     values ((select id from ids where name = 'b_week'), 'a0000000-0000-0000-0000-00000000000a',
             '2030-01-07', '16:00', '20:00') $$,
  '23P01', null, 'Ana can''t be rostered at Cafe B while she''s on at Truck A');
select throws_ok(
  $$ insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time)
     values ((select id from ids where name = 'b_week'), 'a0000000-0000-0000-0000-00000000000a',
             '2030-01-09', '01:00', '03:00') $$,
  '23P01', null, 'Overlap with a shift that ran past midnight is refused too');
select lives_ok(
  $$ insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time)
     values ((select id from ids where name = 'b_week'), 'a0000000-0000-0000-0000-00000000000a',
             '2030-01-07', '17:00', '21:00') $$,
  'Back to back at another site is fine');

-- Turned-off person.
select throws_ok(
  $$ insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time)
     values ((select id from ids where name = 'a_week'), 'e0000000-0000-0000-0000-00000000000e',
             '2030-01-10', '09:00', '12:00') $$,
  '23514', null, 'A turned-off person can''t be rostered');

-- Breaks and paid minutes can't be written.
select throws_ok(
  $$ insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time, paid_minutes)
     values ((select id from ids where name = 'a_week'), 'b0000000-0000-0000-0000-00000000000b',
             '2030-01-10', '09:00', '12:00', 999) $$,
  '42501', null, 'paid_minutes can''t be sent on insert');
select throws_ok(
  $$ update roster_shifts set paid_minutes = 999, rest_breaks = 0 $$,
  '42501', null, 'Breaks and paid minutes can''t be updated');
select throws_ok(
  $$ update roster_shifts set site_id = '10000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'A shift''s site can''t be updated (it comes from the week)');

-- Ben at Truck A Monday, and at Cafe B on Thursday (another site).
insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time, position)
values
  ((select id from ids where name = 'a_week'), 'b0000000-0000-0000-0000-00000000000b', '2030-01-07', '11:00', '15:00', 'Front'),
  ((select id from ids where name = 'b_week'), 'b0000000-0000-0000-0000-00000000000b', '2030-01-10', '08:00', '12:00', 'Barista'),
  -- Ana on Wednesday, while she's on leave (a warning, not a block).
  ((select id from ids where name = 'a_week'), 'a0000000-0000-0000-0000-00000000000a', '2030-01-09', '09:00', '13:00', null);

select is(
  (select array_agg(kind || ':' || staff_name order by kind, staff_name)::text
   from roster_warnings((select id from ids where name = 'a_week'))),
  '{leave:Ana}', 'Ana on leave on Wednesday gives a leave warning; nobody is over 40 hours yet');

-- Ana: 7.5 + 5.5 + 4 + 4 (Cafe B) = 21 paid hours so far. Add 4 x 8 hours at
-- Truck A (7.5 paid each) = 51 hours.
insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time)
select (select id from ids where name = 'a_week'), 'a0000000-0000-0000-0000-00000000000a', d, '14:00', '22:00'
from unnest(array['2030-01-10', '2030-01-11', '2030-01-12', '2030-01-13']::date[]) as d;
select is(
  (select paid_minutes from roster_warnings((select id from ids where name = 'a_week')) where kind = 'over_hours'),
  3060, 'Over 40 hours warns, counting every site (7.5 + 5.5 + 4 + 4 at Cafe B + 4 x 7.5 = 51 hours)');

-- Staff can't see an unpublished week ------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select is((select count(*)::int from roster_shifts), 0, 'Ana sees no shifts while nothing is published');
select is((select count(*)::int from roster_weeks), 0, 'Ana sees no unpublished weeks');
select is((select count(*)::int from roster_coworkers('2030-01-07', '2030-01-13')), 0,
  'Nobody "on with" Ana while the week is unpublished');

-- Staff can't edit or publish.
select throws_ok(
  $$ insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time)
     values ((select id from ids where name = 'a_week'), 'a0000000-0000-0000-0000-00000000000a',
             '2030-01-07', '06:00', '08:00') $$,
  '42501', null, 'Staff can''t add shifts');
select throws_ok(
  $$ select publish_roster_week((select id from ids where name = 'a_week')) $$,
  '42501', null, 'Staff can''t publish');
select throws_ok(
  $$ select ensure_roster_week('10000000-0000-0000-0000-00000000000a', '2030-01-14') $$,
  '42501', null, 'Staff can''t make roster weeks');
select throws_ok(
  $$ select roster_warnings((select id from ids where name = 'a_week')) $$,
  '42501', null, 'Staff can''t see roster warnings');

-- Publish (Mia) ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

select is(
  publish_roster_week((select id from ids where name = 'a_week')),
  '{"republished": false}'::jsonb, 'Mia publishes Truck A''s week');
select is(
  (select row(published_by, published_at = now(), changed_at)::text from roster_weeks
   where id = (select id from ids where name = 'a_week')),
  row('c0000000-0000-0000-0000-00000000000c'::uuid, true, null::timestamptz)::text,
  'Publishing stamps the time and the person');

-- Staff see their own published shifts only -----------------------------------------
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select is(
  (select array_agg(work_date::text order by work_date) from roster_shifts),
  '{2030-01-07}',
  'Ben sees his Truck A shift, not Ana''s, and not his shift in Cafe B''s unpublished week');
select is((select count(*)::int from roster_weeks), 1, 'Ben sees only the published week he is on');
select is(
  (select array_agg(name || ' ' || start_time::text || '-' || finish_time::text order by start_time)
   from roster_coworkers('2030-01-07', '2030-01-13')),
  '{"Ana 09:00:00-17:00:00"}',
  'Ben sees who is on with him at Truck A on Monday (names and times only)');
select is(
  (select count(*)::int from roster_shifts where site_id = '10000000-0000-0000-0000-00000000000b'),
  0, 'Ben can''t see the other site''s roster');
select is_empty(
  $$ update roster_shifts set position = 'Boss' returning id $$,
  'Ben can''t change his own shift');
select is_empty(
  $$ delete from roster_shifts returning id $$,
  'Ben can''t delete shifts');

-- Editing a published week marks it changed ----------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

update roster_shifts set finish_time = '16:00'
where staff_id = 'b0000000-0000-0000-0000-00000000000b' and work_date = '2030-01-07';
select isnt(
  (select changed_at from roster_weeks where id = (select id from ids where name = 'a_week')),
  null, 'Editing a published week marks it changed since published');
select is(
  (select changed_at from roster_weeks where id = (select id from ids where name = 'b_week')),
  null, 'An unpublished week is never "changed since published"');
select is(
  publish_roster_week((select id from ids where name = 'a_week')),
  '{"republished": true}'::jsonb, 'Re-publishing says so');
select is(
  (select changed_at from roster_weeks where id = (select id from ids where name = 'a_week')),
  null, 'Re-publishing clears "changed since published"');
select throws_ok(
  $$ update roster_shifts set staff_id = 'e0000000-0000-0000-0000-00000000000e'
     where staff_id = 'b0000000-0000-0000-0000-00000000000b' and work_date = '2030-01-07' $$,
  '23514', null, 'A shift can''t be handed to a turned-off person');

-- Copy last week ---------------------------------------------------------------------
-- Last week: Ben Monday 31 Dec (copies to 7 Jan, overlapping his shift
-- there, so skipped) and Ben Tuesday 1 Jan (copies to 8 Jan).
insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time, position)
values
  ((select id from ids where name = 'a_last'), 'b0000000-0000-0000-0000-00000000000b', '2029-12-31', '11:00', '15:00', 'Front'),
  ((select id from ids where name = 'a_last'), 'b0000000-0000-0000-0000-00000000000b', '2030-01-01', '07:00', '11:00', 'Front');
select is(
  copy_roster_week('10000000-0000-0000-0000-00000000000a', '2030-01-07') - 'week_id',
  '{"copied": 1, "skipped": 1}'::jsonb, 'Copy last week copies one shift and skips the overlapping one');
select is(
  copy_roster_week('10000000-0000-0000-0000-00000000000a', '2030-01-07') - 'week_id',
  '{"copied": 0, "skipped": 2}'::jsonb, 'Copying again adds nothing');

select * from finish();
rollback;
