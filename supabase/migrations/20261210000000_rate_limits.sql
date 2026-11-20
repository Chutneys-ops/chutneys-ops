-- Slice 8b, part 2: an app-level rate limiter with no paid service.
--
-- Supabase Auth already limits sign-in, password reset and invite EMAILS
-- (config.toml [auth.rate_limit]). This limits the app's own expensive or
-- sensitive actions: invites, PIN sign-off, two-step codes, uploads
-- (purchases, leave, payslips) and the scheduled routes.
--
--   rate_limits: one row per key, a fixed window and a hit count.
--   check_rate_limit(key, max_hits, window_seconds): counts one hit and
--     says whether it's allowed, and if not, how long to wait.
--
-- Keys:
--   'user:<your id>:<action>': per person. A signed-in caller can ONLY use
--     keys that start with their own id, so nobody can use up someone
--     else's allowance (that would lock them out).
--   'ip:<hash>:<action>': per network address, for requests with nobody
--     signed in (the scheduled routes). Only the server's secret key can use
--     these. The app hashes the IP first, so no raw IP address is stored
--     (or copied into the audit log).
--
-- Old rows are deleted every night (pg_cron).

create table rate_limits (
  key text primary key check (length(key) between 1 and 200),
  window_started_at timestamptz not null default now(),
  hits int not null default 0 check (hits >= 0)
);

alter table rate_limits enable row level security;

-- Nobody reads or writes it through the API; only check_rate_limit() does.
revoke all on rate_limits from anon, authenticated;

select enable_audit('rate_limits');
select enable_active_only('rate_limits');

-- Returns {"allowed": true, "remaining": 4}
--      or {"allowed": false, "retry_after_seconds": 512}.
-- A refused attempt still counts, but never makes the window longer.
create or replace function check_rate_limit(key text, max_hits int, window_seconds int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  win interval;
  h int;
  started timestamptz;
begin
  if key is null or length(key) not between 1 and 200 then
    raise exception 'A rate limit key is 1 to 200 characters' using errcode = 'invalid_parameter_value';
  end if;
  if max_hits is null or max_hits < 1 then
    raise exception 'max_hits must be at least 1' using errcode = 'invalid_parameter_value';
  end if;
  if window_seconds is null or window_seconds not between 1 and 86400 then
    raise exception 'window_seconds must be 1 to 86400 (one day)' using errcode = 'invalid_parameter_value';
  end if;
  -- A signed-in person can only count against themselves.
  if auth.uid() is not null and left(key, 42) <> 'user:' || auth.uid()::text || ':' then
    raise exception 'You can only use your own rate limit keys' using errcode = 'insufficient_privilege';
  end if;

  win := make_interval(secs => window_seconds);

  insert into rate_limits as r (key, window_started_at, hits)
  values (check_rate_limit.key, now(), 1)
  on conflict on constraint rate_limits_pkey do update
    set hits = case when r.window_started_at <= now() - win then 1 else r.hits + 1 end,
        window_started_at = case when r.window_started_at <= now() - win then now() else r.window_started_at end
  returning r.hits, r.window_started_at into h, started;

  if h > max_hits then
    return jsonb_build_object(
      'allowed', false,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (started + win - now()))))::int
    );
  end if;
  return jsonb_build_object('allowed', true, 'remaining', max_hits - h);
end;
$$;

revoke execute on function check_rate_limit(text, int, int) from public, anon;
grant execute on function check_rate_limit(text, int, int) to authenticated, service_role;

-- Nightly tidy-up: windows are at most a day long, so older rows are spent.
create or replace function prune_rate_limits() returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  delete from rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function prune_rate_limits() from public, anon, authenticated;

select cron.schedule('prune-rate-limits', '15 15 * * *', 'select public.prune_rate_limits()');
