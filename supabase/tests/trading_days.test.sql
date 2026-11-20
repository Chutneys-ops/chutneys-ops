-- Trading days per site (sites.trading_days): the default, the check, and
-- set_site_trading_days (managers and the owner only).
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Setup (as postgres, which skips RLS) ---------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'mia@test.local'),
  ('d0000000-0000-0000-0000-00000000000d', 'olly@test.local');
insert into staff (id, name, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff'),
  ('c0000000-0000-0000-0000-00000000000c', 'Mia', 'manager'),
  ('d0000000-0000-0000-0000-00000000000d', 'Olly', 'owner');
insert into sites (id, name, kind) values
  ('10000000-0000-0000-0000-00000000000a', 'Truck A', 'truck');

select is(
  (select trading_days from sites where id = '10000000-0000-0000-0000-00000000000a'),
  '{1,2,3,4,5,6,7}'::smallint[], 'A new site trades every day');

-- The check, even for postgres (the SQL editor) ---------------------------------
select throws_ok(
  $$ update sites set trading_days = '{}' where id = '10000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'A site must trade at least one day');
select throws_ok(
  $$ update sites set trading_days = '{1,1}' where id = '10000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'No day twice');
select throws_ok(
  $$ update sites set trading_days = '{0,8}' where id = '10000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'Only 1 (Monday) to 7 (Sunday)');
select throws_ok(
  $$ update sites set trading_days = '{1,null}' where id = '10000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'No blank days');

-- Staff --------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal2"}', true);

select throws_ok(
  $$ select set_site_trading_days('10000000-0000-0000-0000-00000000000a', '{1,2,3}') $$,
  '42501', null, 'Staff can''t change trading days');

-- Manager ------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$ select set_site_trading_days('10000000-0000-0000-0000-00000000000a', '{5,1,3,1}') $$,
  'A manager can change trading days');
select is(
  (select trading_days from sites where id = '10000000-0000-0000-0000-00000000000a'),
  '{1,3,5}'::smallint[], 'Days are stored sorted, each once');
select throws_ok(
  $$ select set_site_trading_days('10000000-0000-0000-0000-00000000000a', '{}') $$,
  '22023', 'Choose at least one trading day', 'At least one day');
select throws_ok(
  $$ select set_site_trading_days('10000000-0000-0000-0000-00000000000a', '{7,8}') $$,
  '22023', null, 'Days must be 1 to 7');
select throws_ok(
  $$ select set_site_trading_days('20000000-0000-0000-0000-00000000000b', '{1}') $$,
  '22023', 'Site not found', 'Unknown site');

-- No update policy on sites: a direct update changes nothing.
update sites set trading_days = '{6,7}' where id = '10000000-0000-0000-0000-00000000000a';
select is(
  (select trading_days from sites where id = '10000000-0000-0000-0000-00000000000a'),
  '{1,3,5}'::smallint[], 'Trading days can''t be changed directly through the API');

-- Owner --------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal2"}', true);
select lives_ok(
  $$ select set_site_trading_days('10000000-0000-0000-0000-00000000000a', '{6,7}') $$,
  'The owner can change trading days');

reset role;
select ok(
  not has_function_privilege('anon', 'public.set_site_trading_days(uuid, smallint[])', 'execute'),
  'Signed-out visitors can''t call set_site_trading_days');

select * from finish();
rollback;
