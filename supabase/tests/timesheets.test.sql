-- Timesheets: computed columns, grants, overlap, future, 16 hours, own vs
-- manager, notes, approval, the lock, and the illness block.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- Setup (as postgres) -----------------------------------------------------------
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

-- Act as Ana ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time)
     values ('10000000-0000-0000-0000-00000000000a', today_nz(), '09:00', '17:00') $$,
  'Ana adds her hours for today');

select is(
  (select row(minutes_at_work, rest_breaks, meal_breaks, paid_minutes, status, staff_id, created_by)::text
   from timesheets where work_date = today_nz() and start_time = '09:00'),
  row(480, 2, 1, 450, 'submitted', 'a0000000-0000-0000-0000-00000000000a'::uuid,
      'a0000000-0000-0000-0000-00000000000a'::uuid)::text,
  '8 hours: 2 rest breaks, 1 meal break, 7.5 hours paid, submitted, Ana''s');

select is(
  (select start_at from timesheets where work_date = today_nz() and start_time = '09:00'),
  (today_nz() + '09:00'::time) at time zone 'Pacific/Auckland',
  'start_at is 9:00 Auckland time on the work date');

select lives_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time)
     values ('10000000-0000-0000-0000-00000000000a', today_nz() - 1, '22:00', '02:00') $$,
  'A shift past midnight is fine');

select is(
  (select row(minutes_at_work, rest_breaks, meal_breaks, finish_at - start_at)::text
   from timesheets where work_date = today_nz() - 1),
  row(240, 1, 0, interval '4 hours')::text,
  'Finish before start means the next morning: 4 hours');

select throws_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time)
     values ('10000000-0000-0000-0000-00000000000a', today_nz(), '16:00', '18:00') $$,
  '23P01', null,
  'Overlapping hours are refused');

select throws_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time)
     values ('10000000-0000-0000-0000-00000000000a', today_nz(), '01:00', '03:00') $$,
  '23P01', null,
  'Overlap with last night''s shift (which ran to 02:00 today) is refused');

select throws_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time)
     values ('10000000-0000-0000-0000-00000000000a', today_nz() + 1, '09:00', '12:00') $$,
  '23514', 'Hours can''t be entered for a future date',
  'Future dates are refused');

select throws_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time)
     values ('10000000-0000-0000-0000-00000000000a', today_nz() - 3, '06:00', '23:00') $$,
  '23514', 'A timesheet can be at most 16 hours',
  'More than 16 hours is refused');

select lives_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time)
     values ('10000000-0000-0000-0000-00000000000a', today_nz() - 3, '06:00', '22:00') $$,
  'Exactly 16 hours is fine');

select is(
  (select row(rest_breaks, meal_breaks, paid_minutes)::text from timesheets where work_date = today_nz() - 3),
  row(4, 2, 900)::text,
  '16 hours: 4 rest, 2 meal, 15 hours paid');

select throws_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time)
     values ('10000000-0000-0000-0000-00000000000a', today_nz() - 4, '09:00', '09:00') $$,
  '23514', 'The finish time must be after the start time',
  'Finish equal to start is refused');

select throws_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time, minutes_at_work)
     values ('10000000-0000-0000-0000-00000000000a', today_nz() - 5, '09:00', '10:00', 600) $$,
  '42501', null,
  'Staff cannot write minutes_at_work');

select throws_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time, paid_minutes, rest_breaks, meal_breaks)
     values ('10000000-0000-0000-0000-00000000000a', today_nz() - 5, '09:00', '10:00', 600, 0, 0) $$,
  '42501', null,
  'Staff cannot write breaks or paid minutes');

select throws_ok(
  $$ update timesheets set paid_minutes = 999 where work_date = today_nz() $$,
  '42501', null,
  'Staff cannot change paid minutes');

select throws_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time, status)
     values ('10000000-0000-0000-0000-00000000000a', today_nz() - 5, '09:00', '10:00', 'approved') $$,
  '42501', null,
  'Staff cannot add an approved timesheet');

select throws_ok(
  $$ insert into timesheets (staff_id, site_id, work_date, start_time, finish_time)
     values ('b0000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', today_nz(), '09:00', '10:00') $$,
  '42501', null,
  'Staff cannot add hours for someone else');

select lives_ok(
  $$ update timesheets set finish_time = '17:30' where work_date = today_nz() and start_time = '09:00' $$,
  'Ana can fix her own submitted hours');

select is(
  (select row(minutes_at_work, paid_minutes)::text from timesheets where work_date = today_nz() and start_time = '09:00'),
  row(510, 480)::text,
  'Breaks and paid minutes are worked out again after the edit');

select throws_ok(
  $$ select approve_timesheets(array(select id from timesheets)) $$,
  '42501', null,
  'Staff cannot approve hours');

-- Act as Mia (manager) ------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated","aal":"aal2"}', true);

select is(
  (select count(*)::int from timesheets where staff_id = 'a0000000-0000-0000-0000-00000000000a'),
  3, 'A manager sees everyone''s timesheets');

select throws_ok(
  $$ insert into timesheets (staff_id, site_id, work_date, start_time, finish_time)
     values ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', today_nz() - 6, '10:00', '14:00') $$,
  '23514', 'Add a note saying why you''re adding hours for someone else',
  'Adding hours for someone needs a note');

select lives_ok(
  $$ insert into timesheets (staff_id, site_id, work_date, start_time, finish_time, edit_note)
     values ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', today_nz() - 6, '10:00', '14:00', 'Paper timesheet') $$,
  'A manager can add hours for Ana with a note');

select throws_ok(
  $$ update timesheets set start_time = '09:15' where work_date = today_nz() and staff_id = 'a0000000-0000-0000-0000-00000000000a' $$,
  '23514', 'Add a note saying what you changed and why',
  'A manager editing Ana''s hours needs a note');

select lives_ok(
  $$ update timesheets set start_time = '09:15', edit_note = 'Started late'
     where work_date = today_nz() and staff_id = 'a0000000-0000-0000-0000-00000000000a' $$,
  'A manager can edit Ana''s hours with a note');

select is(
  (select edited_by from timesheets where work_date = today_nz() and staff_id = 'a0000000-0000-0000-0000-00000000000a'),
  'c0000000-0000-0000-0000-00000000000c'::uuid,
  'edited_by is Mia');

select lives_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time)
     values ('10000000-0000-0000-0000-00000000000a', today_nz(), '08:00', '12:00') $$,
  'Mia adds her own hours');

select is(
  approve_timesheets(array(select id from timesheets
                           where staff_id in ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000c'))),
  4,
  'Approve all approves Ana''s 4 timesheets and skips Mia''s own');

select is(
  (select status from timesheets where staff_id = 'c0000000-0000-0000-0000-00000000000c'),
  'submitted',
  'Mia''s own hours are still waiting');

-- Back to Ana: approved rows are locked ----------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal2"}', true);

select throws_ok(
  $$ update timesheets set finish_time = '18:00' where work_date = today_nz() $$,
  '42501', 'This timesheet is approved. Ask a manager to change it.',
  'Ana cannot change an approved timesheet');

delete from timesheets where work_date = today_nz();
select is(
  (select count(*)::int from timesheets where work_date = today_nz()),
  1,
  'Ana cannot delete an approved timesheet');

-- Mia: approved rows change only with a new note ---------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated","aal":"aal2"}', true);

select throws_ok(
  $$ update timesheets set finish_time = '18:00'
     where work_date = today_nz() and staff_id = 'a0000000-0000-0000-0000-00000000000a' $$,
  '23514', 'Add a note saying what you changed and why',
  'Changing an approved timesheet needs a new note (the old one doesn''t count)');

select lives_ok(
  $$ update timesheets set finish_time = '18:00', edit_note = 'Stayed for a catering order'
     where work_date = today_nz() and staff_id = 'a0000000-0000-0000-0000-00000000000a' $$,
  'A manager can change an approved timesheet with a note');

-- Illness block --------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
insert into leave_requests (staff_id, reason, start_date, end_date, hours, gi_symptoms)
values ('b0000000-0000-0000-0000-00000000000b', 'sick', today_nz() - 1, today_nz() - 1, 8, true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal2"}', true);

select throws_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time)
     values ('10000000-0000-0000-0000-00000000000a', today_nz(), '09:00', '12:00') $$,
  '42501', 'Your manager needs to clear you to return to work after illness',
  'Not cleared after vomiting or diarrhoea: no hours for later days');

select lives_ok(
  $$ insert into timesheets (site_id, work_date, start_time, finish_time)
     values ('10000000-0000-0000-0000-00000000000a', today_nz() - 1, '07:00', '09:00') $$,
  'Hours on the day the illness started are fine');

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated","aal":"aal2"}', true);
select lives_ok(
  $$ insert into timesheets (staff_id, site_id, work_date, start_time, finish_time, edit_note)
     values ('b0000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', today_nz(), '09:00', '12:00',
             'Worked before reporting it') $$,
  'A manager can still record those hours with a note');

select * from finish();
rollback;
