-- The app's rate limiter: check_rate_limit(key, max_hits, window_seconds).
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.
-- now() is fixed for the whole transaction, so "time passing" is faked by
-- moving window_started_at back (as postgres).

begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('ac000000-0000-0000-0000-000000000001', 'ana.rl@test.local'),
  ('ac000000-0000-0000-0000-000000000002', 'ben.rl@test.local');
insert into staff (id, name, role) values
  ('ac000000-0000-0000-0000-000000000001', 'Ana', 'staff'),
  ('ac000000-0000-0000-0000-000000000002', 'Ben', 'staff');

-- 1. The window: 3 hits allowed per 60 seconds, as Ana ------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ac000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}', true);

select is(
  check_rate_limit('user:ac000000-0000-0000-0000-000000000001:test', 3, 60),
  '{"allowed": true, "remaining": 2}'::jsonb, 'hit 1 of 3 is allowed');
select is(
  check_rate_limit('user:ac000000-0000-0000-0000-000000000001:test', 3, 60) ->> 'remaining', '1', 'hit 2 is allowed, 1 left');
select is(
  check_rate_limit('user:ac000000-0000-0000-0000-000000000001:test', 3, 60) ->> 'remaining', '0', 'hit 3 is allowed, 0 left');
select is(
  check_rate_limit('user:ac000000-0000-0000-0000-000000000001:test', 3, 60),
  '{"allowed": false, "retry_after_seconds": 60}'::jsonb, 'hit 4 is refused, try again in 60 seconds');
select is(
  check_rate_limit('user:ac000000-0000-0000-0000-000000000001:test', 3, 60) ->> 'allowed', 'false',
  'still refused');
select is(
  check_rate_limit('user:ac000000-0000-0000-0000-000000000001:other', 3, 60) ->> 'allowed', 'true',
  'a different action has its own allowance');

-- 2. Partway through, then the reset ----------------------------------------------------
reset role;
update rate_limits set window_started_at = now() - interval '45 seconds'
where key = 'user:ac000000-0000-0000-0000-000000000001:test';
select is(
  (select hits from rate_limits where key = 'user:ac000000-0000-0000-0000-000000000001:test'), 5,
  'refused attempts are counted too');
set local role authenticated;
select is(
  check_rate_limit('user:ac000000-0000-0000-0000-000000000001:test', 3, 60) ->> 'retry_after_seconds', '15',
  '45 seconds in, the wait is 15 seconds (refusals don''t make the window longer)');

reset role;
update rate_limits set window_started_at = now() - interval '61 seconds'
where key = 'user:ac000000-0000-0000-0000-000000000001:test';
set local role authenticated;
select is(
  check_rate_limit('user:ac000000-0000-0000-0000-000000000001:test', 3, 60),
  '{"allowed": true, "remaining": 2}'::jsonb, 'after the window, the count starts again');

-- 3. Per person: Ana can't use (or use up) Ben's allowance ---------------------------------
select throws_ok(
  $$ select check_rate_limit('user:ac000000-0000-0000-0000-000000000002:test', 3, 60) $$,
  '42501', null, 'a person can''t count against someone else''s key');
select throws_ok(
  $$ select check_rate_limit('ip:abc123:cron', 3, 60) $$,
  '42501', null, 'a person can''t use per-IP keys');
select throws_ok(
  $$ select check_rate_limit('user:ac000000-0000-0000-0000-000000000001', 3, 60) $$,
  '42501', null, 'the key must have an action after the id');

select set_config('request.jwt.claims', '{"sub":"ac000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}', true);
select is(
  check_rate_limit('user:ac000000-0000-0000-0000-000000000002:test', 3, 60) ->> 'remaining', '2',
  'Ben''s allowance is his own, untouched by Ana''s');
select throws_ok($$ select count(*) from rate_limits $$, '42501', null, 'nobody can read the table directly');

-- 4. Per IP: only the server's secret key (service_role) -------------------------------------
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  check_rate_limit('ip:abc123:cron', 2, 300) ->> 'allowed', 'true', 'the server counts per-IP keys');
select is(check_rate_limit('ip:abc123:cron', 2, 300) ->> 'allowed', 'true', 'second hit from that IP allowed');
select is(check_rate_limit('ip:abc123:cron', 2, 300) ->> 'allowed', 'false', 'third hit from that IP refused');
select is(check_rate_limit('ip:def456:cron', 2, 300) ->> 'allowed', 'true', 'another IP is counted separately');

-- 5. Signed-out callers --------------------------------------------------------------------------
reset role;
select ok(
  not has_function_privilege('anon', 'check_rate_limit(text, int, int)', 'execute'),
  'signed-out callers can''t call the limiter');

select * from finish();
rollback;
