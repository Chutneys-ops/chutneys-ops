-- RLS tests for the opening checklist. Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end,
-- so it leaves no data behind.

begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Setup (as the postgres superuser, which skips RLS) ------------------------
-- Two staff members: Ana works on test truck A, Ben on test truck B.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'ben@test.local');
insert into staff (id, name, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', 'Ben', 'staff');
insert into sites (id, name, kind) values
  ('10000000-0000-0000-0000-00000000000a', 'Test truck A', 'truck'),
  ('10000000-0000-0000-0000-00000000000b', 'Test truck B', 'truck');
insert into staff_sites (staff_id, site_id) values
  ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b');
insert into checklist_items (id, site_kind, checklist, label) values
  ('20000000-0000-0000-0000-000000000001', 'truck', 'opening', 'Test truck item'),
  ('20000000-0000-0000-0000-000000000002', 'cafe', 'opening', 'Test cafe item');

select col_default_is('checklist_runs', 'run_date', 'today_nz()',
  'run_date defaults to the Auckland date');

-- Act as Ana -----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok(
  $$ insert into checklist_runs (site_id, checklist) values ('10000000-0000-0000-0000-00000000000a', 'opening') $$,
  'Ana can start a run at her own site');

select throws_ok(
  $$ insert into checklist_runs (site_id, checklist) values ('10000000-0000-0000-0000-00000000000b', 'opening') $$,
  '42501', null,
  'Ana cannot start a run at Ben''s site');

select throws_ok(
  $$ insert into checklist_runs (site_id, checklist, run_date) values ('10000000-0000-0000-0000-00000000000a', 'closing', '2026-01-01') $$,
  '42501', null,
  'Ana cannot choose the run date');

select is(
  (select run_date from checklist_runs where site_id = '10000000-0000-0000-0000-00000000000a'),
  today_nz(),
  'the new run is dated today in Auckland');

select throws_ok(
  $$ insert into checklist_ticks (run_id, item_id, ticked_by)
     select id, '20000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b'
     from checklist_runs where site_id = '10000000-0000-0000-0000-00000000000a' $$,
  '42501', null,
  'Ana cannot tick as Ben');

select throws_ok(
  $$ insert into checklist_ticks (run_id, item_id, ticked_by)
     select id, '20000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a'
     from checklist_runs where site_id = '10000000-0000-0000-0000-00000000000a' $$,
  '42501', null,
  'Ana cannot tick a cafe item on a truck run');

select throws_ok(
  $$ insert into checklist_ticks (run_id, item_id, ticked_by, ticked_at)
     select id, '20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', '2026-01-01'
     from checklist_runs where site_id = '10000000-0000-0000-0000-00000000000a' $$,
  '42501', null,
  'Ana cannot backdate a tick');

select lives_ok(
  $$ insert into checklist_ticks (run_id, item_id, ticked_by)
     select id, '20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a'
     from checklist_runs where site_id = '10000000-0000-0000-0000-00000000000a' $$,
  'Ana can tick an item as herself');

select throws_ok(
  $$ update checklist_runs set submitted_by = 'a0000000-0000-0000-0000-00000000000a'
     where site_id = '10000000-0000-0000-0000-00000000000a' $$,
  '23514', null,
  'Ana cannot submit while items are unticked');

-- Tick everything else on the truck list, then submit.
insert into checklist_ticks (run_id, item_id, ticked_by)
select r.id, i.id, 'a0000000-0000-0000-0000-00000000000a'
from checklist_runs r, checklist_items i
where r.site_id = '10000000-0000-0000-0000-00000000000a'
  and i.site_kind = 'truck' and i.checklist = 'opening'
  and i.id <> '20000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ update checklist_runs set submitted_by = 'b0000000-0000-0000-0000-00000000000b'
     where site_id = '10000000-0000-0000-0000-00000000000a' $$,
  '42501', null,
  'Ana cannot submit as Ben');

select lives_ok(
  $$ update checklist_runs set submitted_by = 'a0000000-0000-0000-0000-00000000000a'
     where site_id = '10000000-0000-0000-0000-00000000000a' $$,
  'Ana can submit once everything is ticked');

-- After submitting, the run is locked.
delete from checklist_ticks
where run_id = (select id from checklist_runs where site_id = '10000000-0000-0000-0000-00000000000a');

select is(
  (select count(*)::int from checklist_ticks t
   join checklist_runs r on r.id = t.run_id
   where r.site_id = '10000000-0000-0000-0000-00000000000a'),
  (select count(*)::int from checklist_items where site_kind = 'truck' and checklist = 'opening'),
  'unticking after submit removes nothing');

-- Act as Ben -----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select is_empty(
  $$ select 1 from checklist_runs where site_id = '10000000-0000-0000-0000-00000000000a' $$,
  'Ben cannot see Ana''s run');

select is_empty(
  $$ select 1 from staff where id = 'a0000000-0000-0000-0000-00000000000a' $$,
  'Ben cannot see Ana''s name (they share no site)');

select * from finish();
rollback;
