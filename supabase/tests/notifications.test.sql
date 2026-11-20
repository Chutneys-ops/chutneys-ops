-- Notifications: push subscriptions, switches, the reminders log, opening
-- times and the scheduler.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- Setup (as postgres, which skips RLS) ---------------------------------------
-- Ana and Ben are staff, Mia is a manager, Tom's account is turned off.
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
update staff set active = false, deactivated_at = now()
  where id = 'e0000000-0000-0000-0000-00000000000e';
insert into sites (id, name, kind) values
  ('10000000-0000-0000-0000-00000000000a', 'Truck A', 'truck');

-- Ben already has a device.
insert into push_subscriptions (staff_id, endpoint, keys) values
  ('b0000000-0000-0000-0000-00000000000b', 'https://push.example/ben', '{"p256dh": "bk", "auth": "ba"}');

-- Act as Ana (staff) -----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$ select save_push_subscription('https://push.example/tablet', 'p1', 'a1', 'Chrome') $$,
  'Staff can turn notifications on for their browser');
select is(
  (select staff_id from push_subscriptions where endpoint = 'https://push.example/tablet'),
  'a0000000-0000-0000-0000-00000000000a'::uuid, 'The subscription is saved for the person signed in');
select is(
  (select keys from push_subscriptions where endpoint = 'https://push.example/tablet'),
  '{"p256dh": "p1", "auth": "a1"}'::jsonb, 'The browser keys are stored');
select lives_ok(
  $$ select save_push_subscription('https://push.example/tablet', 'p2', 'a2', 'Chrome') $$,
  'Saving the same browser again just updates it');
select is((select count(*)::int from push_subscriptions), 1, 'Staff see only their own subscriptions');
select throws_ok(
  $$ select save_push_subscription('http://not-secure.example', 'p', 'a', null) $$,
  '22023', null, 'Only https push addresses are accepted');
select throws_ok(
  $$ insert into push_subscriptions (endpoint, keys) values ('https://push.example/x', '{"p256dh":"p","auth":"a"}') $$,
  '42501', null, 'Subscriptions can only be added through save_push_subscription');
select throws_ok(
  $$ update push_subscriptions set staff_id = 'b0000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'Nobody can change a subscription through the API');

-- Delete someone else's: RLS hides it, so nothing happens.
delete from push_subscriptions where endpoint = 'https://push.example/ben';

-- Switches: your own row only.
select lives_ok(
  $$ insert into notification_prefs (roster) values (false) $$,
  'Staff can save their own notification switches');
select throws_ok(
  $$ insert into notification_prefs (staff_id, roster) values ('b0000000-0000-0000-0000-00000000000b', false) $$,
  '42501', null, 'Nobody can save switches for someone else');

-- The reminders log is written only by the reminders job.
select throws_ok(
  $$ insert into sent_notifications (staff_id, kind, for_date, dedupe_key)
     values ('a0000000-0000-0000-0000-00000000000a', 'fridge_staff', current_date, 'x') $$,
  '42501', null, 'Staff can''t write the reminders log');

-- Opening times: managers only.
select throws_ok(
  $$ select set_site_opening_time('10000000-0000-0000-0000-00000000000a', '07:00') $$,
  '42501', null, 'Staff can''t change opening times');

-- The scheduler functions aren't callable through the API.
select throws_ok($$ select run_reminders() $$, '42501', null, 'The API can''t trigger the reminders job');
select throws_ok(
  $$ select set_reminder_settings('https://x.example', repeat('s', 40)) $$,
  '42501', null, 'The API can''t change the reminders URL or secret');

-- Act as Ben: he signs in on the same tablet and turns notifications on -------------
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal2"}', true);

select is((select count(*)::int from push_subscriptions where endpoint = 'https://push.example/ben'), 1,
  'Ana could not delete Ben''s subscription');
select is((select count(*)::int from notification_prefs), 0, 'Staff can''t see other people''s switches');
select lives_ok(
  $$ select save_push_subscription('https://push.example/tablet', 'p3', 'a3', 'Chrome') $$,
  'Ben can turn notifications on for the shared tablet');

-- Act as Mia (manager) ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated","aal":"aal2"}', true);
select lives_ok(
  $$ select set_site_opening_time('10000000-0000-0000-0000-00000000000a', '07:30') $$,
  'A manager can change a site''s opening time');

-- Act as Tom (turned off) --------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-00000000000e","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$ select save_push_subscription('https://push.example/tom', 'p', 'a', null) $$,
  '42501', null, 'A turned-off account can''t turn notifications on');

-- Back to postgres (the system) to check the results ---------------------------------
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select staff_id from push_subscriptions where endpoint = 'https://push.example/tablet'),
  'b0000000-0000-0000-0000-00000000000b'::uuid, 'The shared tablet moved from Ana to Ben');
select is((select opens_at from sites where id = '10000000-0000-0000-0000-00000000000a'), '07:30'::time,
  'The opening time was saved');
insert into sites (id, name, kind) values ('10000000-0000-0000-0000-00000000000b', 'Truck B', 'truck');
select is((select opens_at from sites where id = '10000000-0000-0000-0000-00000000000b'), '09:00'::time,
  'A new site opens at 9:00 until a manager changes it');

-- One reminder per person, type and day.
insert into sent_notifications (staff_id, kind, for_date, dedupe_key)
  values ('a0000000-0000-0000-0000-00000000000a', 'fridge_staff', '2026-11-20', 'fridge_staff:2026-11-20:a');
select throws_ok(
  $$ insert into sent_notifications (staff_id, kind, for_date, dedupe_key)
     values ('a0000000-0000-0000-0000-00000000000a', 'fridge_staff', '2026-11-20', 'fridge_staff:2026-11-20:a') $$,
  '23505', null, 'The same reminder key can''t be logged twice');
select throws_ok(
  $$ insert into sent_notifications (staff_id, kind, for_date, dedupe_key)
     values ('e0000000-0000-0000-0000-00000000000e', 'fridge_staff', '2026-11-20', 'fridge_staff:2026-11-20:e') $$,
  '23514', null, 'No reminders are logged for a turned-off person, not even by the system');

-- Push addresses and keys never reach the audit log.
select is(
  (select count(*)::int from audit_log
   where table_name = 'push_subscriptions' and (new_data ? 'endpoint' or new_data ? 'keys' or old_data ? 'keys')),
  0, 'The audit log has no push addresses or keys');

select is((select count(*)::int from cron.job where jobname = 'reminders' and schedule = '*/5 * * * *'), 1,
  'The reminders job runs every 5 minutes');

select * from finish();
rollback;
