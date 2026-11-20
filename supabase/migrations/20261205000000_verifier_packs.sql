-- Slice 8: verifier pack. Every food safety record for a date range as one
-- PDF for the Auckland Council verifier, plus a monthly copy.
--
--   1. A private Storage bucket, "verifier-packs", for the monthly copies.
--      Only the owner can read them. Only the server (secret key) writes:
--      there are no insert, update or delete policies.
--   2. run_verifier_pack(): pg_cron posts to the web app's
--      /api/cron/verifier-pack with the same secret as the reminders. It
--      reuses the reminders URL saved in Vault (set_reminder_settings), with
--      the path swapped, so there is nothing new to set up.
--   3. The schedule: every day at 14:30 UTC (2:30 or 3:30 am in Auckland).
--      The route only builds last month's pack when it isn't stored yet, so
--      it's made on the 1st, and a failed night is retried the next day.
--
-- Packs made on demand (More > Verifier pack) are never stored: they are
-- built with the manager's own session, so RLS decides what's in them.
-- No new tables, so nothing new to audit.

-- 1. Bucket -----------------------------------------------------------------------------

-- Also in supabase/config.toml (local). Created here as well, so the hosted
-- project gets it from `supabase db push` without a manual step.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verifier-packs', 'verifier-packs', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy "verifier packs: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'verifier-packs' and is_owner());

-- 2. The job --------------------------------------------------------------------------------

create or replace function run_verifier_pack() returns bigint
language plpgsql security definer set search_path = public as $$
declare
  reminders text;
  target text;
  secret text;
begin
  select decrypted_secret into reminders from vault.decrypted_secrets where name = 'reminders_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret';
  if reminders is null or secret is null then
    raise notice 'Scheduled jobs are not set up yet: run set_reminder_settings(url, secret).';
    return null;
  end if;
  -- https://example.com/api/cron/reminders -> https://example.com/api/cron/verifier-pack
  target := regexp_replace(reminders, '/api/cron/reminders/?$', '/api/cron/verifier-pack');
  if target = reminders then
    raise notice 'The saved URL doesn''t end in /api/cron/reminders, so the verifier pack URL can''t be worked out.';
    return null;
  end if;
  -- A month of every site can take a while to draw; the route keeps going
  -- even if pg_net stops waiting for the reply.
  return net.http_post(
    url := target,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke execute on function run_verifier_pack() from public, anon, authenticated;

-- 3. Schedule -------------------------------------------------------------------------------

-- Daily, not "on the 1st", because pg_cron runs in UTC: the 1st in Auckland
-- starts on the last day of the month in UTC. The route decides.
select cron.schedule('verifier-pack', '30 14 * * *', 'select public.run_verifier_pack()');
