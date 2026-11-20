-- Slice 7: phone notifications (Web Push) and scheduled reminders.
--
--   1. push_subscriptions: one row per browser or phone that turned
--      notifications on. Staff see and remove only their own.
--      save_push_subscription() adds one; if that browser was someone
--      else's (a shared tablet), it moves to the person signed in now.
--   2. notification_prefs: four on/off switches per person (notices, roster,
--      reminders, approvals). No row means everything on.
--   3. sent_notifications: a log of reminders sent, with a unique key per
--      person, type and day, so a reminder is never sent twice.
--   4. sites.opens_at (default 9:00) and set_site_opening_time(), for the
--      "opening checks not done" reminder.
--   5. The scheduler: pg_cron runs run_reminders() every 5 minutes. It posts
--      to the web app's /api/cron/reminders with a secret header (pg_net).
--      The URL and the secret live in Supabase Vault, set once per
--      environment with set_reminder_settings() (README > Notifications),
--      so neither is in this file. Not set yet: it quietly does nothing.
--   6. Audit: endpoint and keys are stripped from the audit log.
--   7. The project rules: enable_audit, enable_active_only, active_staff_only.
--
-- Sending happens in the web app (web/lib/push.ts) with the secret key,
-- because it needs other people's subscriptions and the VAPID private key.

-- 1. Push subscriptions ----------------------------------------------------------------

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null default auth.uid() references staff (id),
  -- The push service's address for this browser. Unique: one browser
  -- belongs to one person at a time.
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  -- {"p256dh": "...", "auth": "..."}: the browser's keys for encrypting messages.
  keys jsonb not null check (
    jsonb_typeof(keys) = 'object'
    and coalesce(length(keys ->> 'p256dh'), 0) between 1 and 200
    and coalesce(length(keys ->> 'auth'), 0) between 1 and 100
  ),
  user_agent text check (length(user_agent) <= 500),
  created_at timestamptz not null default now(),
  -- Stamped at most once a day when a push is accepted, to keep the audit
  -- log small.
  last_used_at timestamptz
);

create index push_subscriptions_staff on push_subscriptions (staff_id);

alter table push_subscriptions enable row level security;

-- Adding goes through save_push_subscription() (it may need to take a
-- browser over from someone else, which RLS can't see). Staff read and
-- delete their own; no updates through the API.
revoke all on push_subscriptions from anon, authenticated;
grant select, delete on push_subscriptions to authenticated;

create policy "own push subscriptions" on push_subscriptions
  for select using (staff_id = auth.uid());
create policy "remove own push subscriptions" on push_subscriptions
  for delete to authenticated using (staff_id = auth.uid());

-- Turn notifications on for this browser. A browser's endpoint belongs to
-- whoever is signed in on it now: if Ana turned them on on the truck's
-- tablet and Ben does too, Ana's row goes and Ben's comes in.
create or replace function save_push_subscription(endpoint text, p256dh text, auth_key text, user_agent text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if not is_active() then
    raise exception 'Your account is turned off' using errcode = 'insufficient_privilege';
  end if;
  if endpoint is null or endpoint !~ '^https://' then
    raise exception 'That isn''t a push address' using errcode = 'invalid_parameter_value';
  end if;

  delete from push_subscriptions s
  where s.endpoint = save_push_subscription.endpoint and s.staff_id <> auth.uid();

  insert into push_subscriptions (staff_id, endpoint, keys, user_agent)
  values (
    auth.uid(),
    save_push_subscription.endpoint,
    jsonb_build_object('p256dh', p256dh, 'auth', auth_key),
    left(save_push_subscription.user_agent, 500)
  )
  on conflict on constraint push_subscriptions_endpoint_key do update
    set keys = excluded.keys, user_agent = excluded.user_agent
  returning id into new_id;
  return new_id;
end;
$$;

revoke execute on function save_push_subscription(text, text, text, text) from public, anon;
grant execute on function save_push_subscription(text, text, text, text) to authenticated;

-- 2. Preferences -------------------------------------------------------------------------

create table notification_prefs (
  staff_id uuid primary key default auth.uid() references staff (id),
  notices boolean not null default true,    -- new notices
  roster boolean not null default true,     -- roster published or changed, shift tomorrow
  reminders boolean not null default true,  -- fridge temperatures, opening checks
  approvals boolean not null default true,  -- leave decided; managers: things waiting
  updated_at timestamptz not null default now()
);

alter table notification_prefs enable row level security;

-- staff_id defaults to you and can't be sent, so you only ever write your own.
revoke all on notification_prefs from anon, authenticated;
grant select on notification_prefs to authenticated;
grant insert (notices, roster, reminders, approvals) on notification_prefs to authenticated;
grant update (notices, roster, reminders, approvals) on notification_prefs to authenticated;

create policy "own notification settings" on notification_prefs
  for select using (staff_id = auth.uid());
create policy "add own notification settings" on notification_prefs
  for insert to authenticated with check (staff_id = auth.uid());
create policy "change own notification settings" on notification_prefs
  for update to authenticated using (staff_id = auth.uid()) with check (staff_id = auth.uid());

create or replace function notification_prefs_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger notification_prefs_touch
  before update on notification_prefs
  for each row execute function notification_prefs_touch();

-- 3. Sent reminders ------------------------------------------------------------------------

-- Written only by the reminders job (secret key). dedupe_key is
-- "<type>:<Auckland date>:<person>" (web/lib/reminders.ts, reminderKey):
-- the job claims the key BEFORE sending, so two runs at once can't both send.
create table sent_notifications (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id),
  kind text not null check (kind in ('fridge_staff', 'fridge_manager', 'opening_checks', 'approvals_digest', 'shift_tomorrow')),
  for_date date not null,
  dedupe_key text not null unique,
  sent_at timestamptz not null default now()
);

create index sent_notifications_date on sent_notifications (for_date);

alter table sent_notifications enable row level security;
revoke all on sent_notifications from anon, authenticated;
grant select on sent_notifications to authenticated;

create policy "own sent reminders" on sent_notifications
  for select using (staff_id = auth.uid());

-- 4. Opening times -----------------------------------------------------------------------------

alter table sites add column opens_at time not null default '09:00';

comment on column sites.opens_at is
  'When the site usually opens (Auckland time). Opening checks not done 30 minutes after this send a reminder.';

create or replace function set_site_opening_time(site uuid, opens time) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_manager() then
    raise exception 'Only a manager or the owner can change opening times' using errcode = 'insufficient_privilege';
  end if;
  if opens is null then
    raise exception 'Choose an opening time' using errcode = 'invalid_parameter_value';
  end if;
  update sites set opens_at = opens where id = site;
  if not found then
    raise exception 'Site not found' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

revoke execute on function set_site_opening_time(uuid, time) from public, anon;
grant execute on function set_site_opening_time(uuid, time) to authenticated;

-- 5. The scheduler -------------------------------------------------------------------------------

-- pg_cron (the timer) and pg_net (HTTP from inside Postgres) are both on
-- Supabase's free plan, hosted and local.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Save the reminders URL and secret in Vault (encrypted at rest). Run once
-- per environment from the SQL editor or psql; see README. Only postgres
-- can call it.
create or replace function set_reminder_settings(url text, secret text) returns void
language plpgsql security definer set search_path = public as $$
declare
  existing uuid;
begin
  if url is null or url !~ '^https?://' then
    raise exception 'The URL must start with http:// or https://' using errcode = 'invalid_parameter_value';
  end if;
  if secret is null or length(secret) < 32 then
    raise exception 'The secret must be at least 32 characters' using errcode = 'invalid_parameter_value';
  end if;

  select id into existing from vault.secrets where name = 'reminders_url';
  if existing is null then
    perform vault.create_secret(url, 'reminders_url', 'Where pg_cron posts the reminders check');
  else
    perform vault.update_secret(existing, url);
  end if;

  select id into existing from vault.secrets where name = 'cron_secret';
  if existing is null then
    perform vault.create_secret(secret, 'cron_secret', 'CRON_SECRET of the web app');
  else
    perform vault.update_secret(existing, secret);
  end if;
end;
$$;

-- Called by pg_cron. Posts to the web app, which works out and sends the
-- reminders. pg_net sends in the background after this returns; replies are
-- kept for a few hours in net._http_response (handy when something fails).
create or replace function run_reminders() returns bigint
language plpgsql security definer set search_path = public as $$
declare
  target text;
  secret text;
begin
  select decrypted_secret into target from vault.decrypted_secrets where name = 'reminders_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret';
  if target is null or secret is null then
    raise notice 'Reminders are not set up yet: run set_reminder_settings(url, secret).';
    return null;
  end if;
  return net.http_post(
    url := target,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke execute on function set_reminder_settings(text, text) from public, anon, authenticated;
revoke execute on function run_reminders() from public, anon, authenticated;

-- Every 5 minutes. Each reminder has its own time window and is sent once
-- (sent_notifications), so running often only makes them more punctual.
-- cron.schedule with a name replaces the job if it already exists.
select cron.schedule('reminders', '*/5 * * * *', 'select public.run_reminders()');

-- 6. Audit ------------------------------------------------------------------------------------------

-- Same as before, plus endpoint and keys: a push address and its keys let
-- anyone with the VAPID key message that phone, so they stay out of the log.
create or replace function audit_redact(data jsonb) returns jsonb
language sql immutable as $$
  select case
    when data is null then null
    else coalesce(
      (select jsonb_object_agg(key, value)
       from jsonb_each(data)
       where key !~* '(hash|password|secret|token)' and key not in ('endpoint', 'keys')),
      '{}'::jsonb
    )
  end;
$$;

-- 7. Project rules ----------------------------------------------------------------------------------

select enable_audit('push_subscriptions');
select enable_audit('notification_prefs');
select enable_audit('sent_notifications');
select enable_active_only('push_subscriptions');
select enable_active_only('notification_prefs');
select enable_active_only('sent_notifications');

create trigger active_staff_only before insert on push_subscriptions
  for each row execute function active_staff_only('staff_id', 'notifications');
create trigger active_staff_only before insert on notification_prefs
  for each row execute function active_staff_only('staff_id', 'notification settings');
create trigger active_staff_only before insert on sent_notifications
  for each row execute function active_staff_only('staff_id', 'reminders');
