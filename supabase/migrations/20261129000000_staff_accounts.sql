-- Slice 13: staff accounts. The owner invites people by email, changes
-- roles and turns off leavers.
--
--   1. staff: email, active, invited_at, deactivated_at, deactivated_by.
--   2. is_active(): "is the signed-in person an active staff member?"
--      Added inside every helper (is_owner, is_manager, on_shift_at,
--      can_see_site, shares_site_with) and the security definer functions
--      that act for yourself (start_shift, clock_out, set_my_pin,
--      confirm_training).
--   3. "active accounts only": a RESTRICTIVE policy on every table (and on
--      storage). Many policies only say "staff_id = auth.uid()" (your own
--      leave, timesheets, purchases), so the helpers alone would still let a
--      turned-off person through. Postgres ANDs a restrictive policy with the
--      normal ones, so a deactivated login whose token hasn't expired yet
--      gets no rows and can't write anything.
--      EVERY NEW TABLE MUST CALL enable_active_only(); a pgTAP test checks.
--   4. Owner-only functions: set_staff_role, set_staff_active (never on
--      yourself, so there is always an owner), staff_logins, note_invite_sent.
--   5. Grants: nobody updates staff directly through the API; the owner adds
--      rows (after the invite) through an insert policy.
--
-- staff_pins is still not audited (secrets). staff was already audited, so
-- role and active changes appear in the audit log automatically.

-- 1. Columns -----------------------------------------------------------------------

alter table staff
  add column email text,
  add column active boolean not null default true,
  add column invited_at timestamptz,
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references staff (id);

-- Existing people: copy their login email. (New rows get it from the invite.)
update staff s
set email = lower(btrim(u.email))
from auth.users u
where u.id = s.id and s.email is null and u.email is not null;

-- Set after the update above, so existing people keep invited_at empty
-- (they were added by the seed, not invited).
alter table staff alter column invited_at set default now();

alter table staff
  add constraint staff_email_clean check (email = lower(btrim(email)) and length(email) <= 254),
  add constraint staff_name_present check (btrim(name) <> '' and length(name) <= 100),
  -- Turned off <=> there is a date it was turned off.
  add constraint staff_active_matches_date check (active = (deactivated_at is null));

-- One staff row per email. Empty emails (old test rows) don't count.
create unique index staff_email_unique on staff (email) where email is not null;

comment on column staff.active is
  'False for leavers. A deactivated person can see and change nothing (is_active() and the '
  '"active accounts only" policies). Only set_staff_active changes it.';

-- 2. Helpers ------------------------------------------------------------------------

-- security definer, like the others: reads staff whatever its policies say.
create or replace function is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and active);
$$;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and role = 'owner' and active);
$$;

create or replace function is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and role in ('manager', 'owner') and active);
$$;

create or replace function on_shift_at(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_active() and exists (
    select 1 from shifts
    where staff_id = auth.uid()
      and site_id = target
      and clock_out is null
      and clock_in > stale_shift_cutoff()
  );
$$;

-- is_manager() and on_shift_at() already check; saying it here too keeps
-- the rule visible where people look for it.
create or replace function can_see_site(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_active() and (is_manager() or on_shift_at(target));
$$;

create or replace function shares_site_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_active() and (
    is_manager()
    or exists (select 1 from staff where id = other and role in ('manager', 'owner'))
    or exists (
      select 1
      from shifts mine
      join shifts theirs on theirs.site_id = mine.site_id
      where mine.staff_id = auth.uid()
        and mine.clock_out is null
        and theirs.staff_id = other
        and theirs.clock_in > now() - interval '2 days'
    )
  );
$$;

-- Security definer functions skip RLS, so the ones that act for "you" check
-- is_active() themselves. (The manager-only ones already call is_manager().)

-- start_shift from the sick leave migration; "is a staff row" -> "is active".
create or replace function start_shift(site_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  current_shift shifts%rowtype;
  new_id uuid;
begin
  if not is_active() then
    raise exception 'Only active staff can choose a site' using errcode = 'insufficient_privilege';
  end if;
  -- Food safety: vomiting or diarrhoea reported and not cleared yet.
  if needs_clearance() then
    raise exception 'Your manager needs to clear you to return to work after illness'
      using errcode = 'insufficient_privilege', hint = 'needs_clearance';
  end if;
  if not exists (select 1 from sites s where s.id = start_shift.site_id and s.active) then
    raise exception 'That site doesn''t exist or is closed' using errcode = 'invalid_parameter_value';
  end if;

  select * into current_shift from shifts where staff_id = auth.uid() and clock_out is null;
  if found then
    if current_shift.clock_in <= stale_shift_cutoff() then
      perform close_stale_shift(current_shift.id);
    elsif current_shift.site_id = start_shift.site_id then
      return current_shift.id; -- already working here (double tap)
    else
      update shifts set clock_out = now() where id = current_shift.id;
    end if;
  end if;

  insert into shifts (site_id, staff_id) values (start_shift.site_id, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function clock_out() returns void
language plpgsql security definer set search_path = public as $$
declare
  current_shift shifts%rowtype;
begin
  if not is_active() then
    raise exception 'Your account is turned off' using errcode = 'insufficient_privilege';
  end if;
  select * into current_shift from shifts where staff_id = auth.uid() and clock_out is null;
  if not found then
    return;
  end if;
  if current_shift.clock_in <= stale_shift_cutoff() then
    perform close_stale_shift(current_shift.id);
  else
    update shifts set clock_out = now() where id = current_shift.id;
  end if;
end;
$$;

-- From the PIN lockout migration; the role check now uses is_manager(),
-- which includes "active".
create or replace function set_my_pin(pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_manager() then
    raise exception 'Only managers and owners have a sign-off PIN' using errcode = 'insufficient_privilege';
  end if;
  if pin is null or pin !~ '^[0-9]{4}$' then
    raise exception 'The PIN must be 4 digits' using errcode = 'invalid_parameter_value';
  end if;

  insert into staff_pins (staff_id, pin_hash, updated_at, failed_attempts, locked_until)
  values (auth.uid(), crypt(pin, gen_salt('bf')), now(), 0, null)
  on conflict (staff_id) do update
    set pin_hash = excluded.pin_hash,
        updated_at = excluded.updated_at,
        failed_attempts = 0,
        locked_until = null;
end;
$$;

create or replace function confirm_training(record_id uuid, signature_path text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r training_records%rowtype;
begin
  if not is_active() then
    raise exception 'Your account is turned off' using errcode = 'insufficient_privilege';
  end if;
  select * into r from training_records where id = record_id for update;
  if not found or r.trainee_id <> auth.uid() then
    raise exception 'You can only confirm your own training' using errcode = 'insufficient_privilege';
  end if;
  if r.trainee_signed_at is not null then
    return;
  end if;
  if signature_path is not null and not signature_belongs(signature_path) then
    raise exception 'That signature isn''t yours' using errcode = 'insufficient_privilege';
  end if;

  update training_records
  set trainee_signed_at = now(), trainee_signature_path = signature_path
  where id = r.id;
end;
$$;

-- 3. "Active accounts only" on every table --------------------------------------------

-- Attach the restrictive policy in one line. Safe to call twice.
-- "as restrictive": rows must pass this AND at least one normal policy.
-- "to authenticated": only logins are affected; migrations, the seed and
-- the SQL editor (postgres) and the secret key (service_role) skip RLS.
create or replace function enable_active_only(target regclass) returns void
language plpgsql as $$
begin
  execute format('drop policy if exists "active accounts only" on %s', target);
  execute format(
    'create policy "active accounts only" on %s as restrictive for all to authenticated '
    'using (is_active()) with check (is_active())',
    target
  );
end;
$$;

revoke execute on function enable_active_only(regclass) from public, anon, authenticated;

select enable_active_only('sites');
select enable_active_only('staff_sites');
select enable_active_only('shifts');
select enable_active_only('record_templates');
select enable_active_only('record_sheets');
select enable_active_only('record_entries');
select enable_active_only('temp_units');
select enable_active_only('temp_readings');
select enable_active_only('staff_pins');
select enable_active_only('purchases');
select enable_active_only('leave_requests');
select enable_active_only('training_records');
select enable_active_only('timesheets');
select enable_active_only('cash_ups');
select enable_active_only('daily_sales');
select enable_active_only('alerts');
select enable_active_only('audit_log');
select enable_active_only('checklist_items');
select enable_active_only('checklist_runs');
select enable_active_only('checklist_ticks');

-- staff is the one exception: a turned-off person can still read their own
-- row, so the app can tell them why they're being signed out. They still
-- can't write anything.
drop policy if exists "active accounts only" on staff;
create policy "active accounts only" on staff
  as restrictive for all to authenticated
  using (is_active() or id = auth.uid())
  with check (is_active());

-- Storage: invoices, certificates and signatures.
drop policy if exists "active accounts only" on storage.objects;
create policy "active accounts only" on storage.objects
  as restrictive for all to authenticated
  using (public.is_active())
  with check (public.is_active());

-- 4. Owner-only staff functions ---------------------------------------------------------

-- Parameter names aren't "id" and "role" because those are column names:
-- inside plpgsql, "role" would be ambiguous.
create or replace function set_staff_role(target_id uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then
    raise exception 'Only the owner can change roles' using errcode = 'insufficient_privilege';
  end if;
  if new_role is null or new_role not in ('staff', 'manager', 'owner') then
    raise exception 'Choose staff, manager or owner' using errcode = 'invalid_parameter_value';
  end if;
  -- There must always be an owner: you can't demote yourself. (You can make
  -- someone else an owner first; then they can change your role.)
  if target_id = auth.uid() and new_role <> 'owner' then
    raise exception 'You can''t change your own role. There must always be an owner.'
      using errcode = 'check_violation';
  end if;

  update staff set role = new_role where id = target_id;
  if not found then
    raise exception 'Staff member not found' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- Turning someone off also deletes their sessions (signed out everywhere:
-- their refresh tokens stop working). The web app also bans the login
-- through the Auth admin API, so they can't sign in again.
create or replace function set_staff_active(target_id uuid, make_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then
    raise exception 'Only the owner can turn accounts on or off' using errcode = 'insufficient_privilege';
  end if;
  if make_active is null then
    raise exception 'Say whether the account is on or off' using errcode = 'invalid_parameter_value';
  end if;
  if target_id = auth.uid() and not make_active then
    raise exception 'You can''t turn off your own account. There must always be an owner.'
      using errcode = 'check_violation';
  end if;

  update staff
  set active = make_active,
      -- Already off: keep the first date and who did it.
      deactivated_at = case when make_active then null else coalesce(deactivated_at, now()) end,
      deactivated_by = case when make_active then null else coalesce(deactivated_by, auth.uid()) end
  where id = target_id;
  if not found then
    raise exception 'Staff member not found' using errcode = 'invalid_parameter_value';
  end if;

  if not make_active then
    delete from auth.sessions where user_id = target_id;
  end if;
end;
$$;

-- Who has set a password yet ("joined")? Invited people have a login with no
-- password until they use the link. auth.users isn't readable through the
-- API, so the owner's Staff page asks this function.
create or replace function staff_logins()
returns table (staff_id uuid, joined boolean, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_owner() then
    raise exception 'Only the owner can see logins' using errcode = 'insufficient_privilege';
  end if;
  return query
    select s.id, coalesce(u.encrypted_password, '') <> '', u.last_sign_in_at
    from staff s
    left join auth.users u on u.id = s.id;
end;
$$;

-- "Resend invite" stamps the time it was sent.
create or replace function note_invite_sent(target_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then
    raise exception 'Only the owner can invite staff' using errcode = 'insufficient_privilege';
  end if;
  update staff set invited_at = now() where id = target_id;
  if not found then
    raise exception 'Staff member not found' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

revoke execute on function set_staff_role(uuid, text) from public, anon;
revoke execute on function set_staff_active(uuid, boolean) from public, anon;
revoke execute on function staff_logins() from public, anon;
revoke execute on function note_invite_sent(uuid) from public, anon;
grant execute on function set_staff_role(uuid, text) to authenticated;
grant execute on function set_staff_active(uuid, boolean) to authenticated;
grant execute on function staff_logins() to authenticated;
grant execute on function note_invite_sent(uuid) to authenticated;

-- 5. Grants on staff -------------------------------------------------------------------------

-- Before: Supabase's default grants let the API try any write; RLS had no
-- write policies, so nothing happened. Now it's explicit:
--   - read: as before (yourself, colleagues, the owner sees all);
--   - add: the owner only, and only these four columns (active defaults to
--     true, invited_at to now());
--   - change: only through the functions above. No update or delete grants.
revoke all on staff from anon, authenticated;
grant select on staff to authenticated;
grant insert (id, name, email, role) on staff to authenticated;

create policy "owner adds staff" on staff
  for insert to authenticated
  with check (is_owner());
