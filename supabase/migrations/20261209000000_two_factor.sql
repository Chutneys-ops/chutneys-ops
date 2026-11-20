-- Slice 8b, part 1: two-factor sign-in (authenticator app codes, TOTP).
--
-- Supabase Auth puts how you signed in into every token:
--   aal1 = password only;
--   aal2 = password AND a 6-digit code from an authenticator app.
-- The DATABASE checks it, not just the screens, so a stolen manager password
-- can't approve, sign off or see everyone's data through the API either.
--
--   1. has_aal2(): "did this token come with a code?"
--      has_verified_factor(): "has this person set up an authenticator?"
--   2. is_owner() and is_manager() now need aal2. Every owner and manager
--      power goes through these two (policies, sign_off_sheet,
--      approve_timesheets, decide_leave, publish_payslips, the audit log...),
--      so a manager with only a password gets staff-level access.
--   3. is_active() now also says no to someone who HAS an authenticator but
--      signed in with only a password: until they type the code, they see
--      nothing but their own staff row (enough for the app to show the code
--      screen). Their own payslips and leave are protected too, so turning
--      the code on means something for staff as well as managers.
--   4. mfa_status(): what the app should ask for next (enrol, verify, nothing).
--   5. reset_staff_mfa(): the owner removes a manager's authenticator (lost
--      phone). Audited in mfa_resets. Never on yourself: owner recovery is in
--      docs/RUNBOOK.md.
--
-- Tests that act as a manager or owner must now say "aal":"aal2" in their
-- request.jwt.claims, like a real token after the code.

-- 1. Helpers ----------------------------------------------------------------------

-- Not security definer: it only reads the caller's own token.
create or replace function has_aal2() returns boolean
language sql stable set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- security definer: auth.mfa_factors isn't readable through the API.
create or replace function has_verified_factor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from auth.mfa_factors f
    where f.user_id = auth.uid() and f.status = 'verified'
  );
$$;

revoke execute on function has_aal2() from public, anon;
revoke execute on function has_verified_factor() from public, anon;
grant execute on function has_aal2() to authenticated, service_role;
grant execute on function has_verified_factor() to authenticated, service_role;

-- 2 and 3. The role helpers ------------------------------------------------------------

-- Active account, and if you've set up an authenticator, you used it.
create or replace function is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and active)
    and (has_aal2() or not has_verified_factor());
$$;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select has_aal2() and is_active()
    and exists (select 1 from staff where id = auth.uid() and role = 'owner');
$$;

create or replace function is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select has_aal2() and is_active()
    and exists (select 1 from staff where id = auth.uid() and role in ('manager', 'owner'));
$$;

-- 4. What the app asks for next ------------------------------------------------------------

-- 'enrol':  owner or manager with no authenticator yet (or after a reset);
-- 'verify': has an authenticator, signed in with only a password;
-- 'none':   nothing to do (staff who haven't opted in, or already aal2).
-- Works for aal1 tokens on purpose: it's how the app finds out.
create or replace function mfa_status() returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 'none'
    when has_verified_factor() then case when has_aal2() then 'none' else 'verify' end
    when exists (
      select 1 from staff where id = auth.uid() and active and role in ('manager', 'owner')
    ) then 'enrol'
    else 'none'
  end;
$$;

revoke execute on function mfa_status() from public, anon;
grant execute on function mfa_status() to authenticated;

-- 5. Owner resets someone's authenticator ---------------------------------------------------

create table mfa_resets (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id),
  reset_by uuid not null default auth.uid() references staff (id),
  reset_at timestamptz not null default now(),
  factors_removed int not null check (factors_removed >= 0)
);

create index mfa_resets_staff on mfa_resets (staff_id, reset_at desc);

alter table mfa_resets enable row level security;

-- Written only by reset_staff_mfa(); the owner reads them.
revoke all on mfa_resets from anon, authenticated;
grant select on mfa_resets to authenticated;

create policy "owner reads authenticator resets" on mfa_resets
  for select to authenticated using (is_owner());

select enable_audit('mfa_resets');
select enable_active_only('mfa_resets');
create trigger active_staff_only before insert on mfa_resets
  for each row execute function active_staff_only('staff_id', 'an authenticator reset');

-- Removes every authenticator the person has and signs them out everywhere.
-- Their next sign-in is password only; a manager or owner is then taken
-- straight to "set up your authenticator" again. Returns how many were removed.
create or replace function reset_staff_mfa(target_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  removed int;
begin
  if not is_owner() then
    raise exception 'Only the owner can reset two-step sign-in' using errcode = 'insufficient_privilege';
  end if;
  if target_id = auth.uid() then
    raise exception 'You can''t reset your own two-step sign-in here. See docs/RUNBOOK.md.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from staff where id = target_id) then
    raise exception 'Staff member not found' using errcode = 'invalid_parameter_value';
  end if;

  delete from auth.mfa_factors where user_id = target_id;
  get diagnostics removed = row_count;
  delete from auth.sessions where user_id = target_id;

  insert into mfa_resets (staff_id, factors_removed) values (target_id, removed);
  return removed;
end;
$$;

revoke execute on function reset_staff_mfa(uuid) from public, anon;
grant execute on function reset_staff_mfa(uuid) to authenticated;

-- Who has an authenticator, for the owner's Staff page (count of verified
-- ones, so "2 devices" can be shown). auth.mfa_factors isn't readable
-- through the API.
create or replace function staff_mfa_factors()
returns table (staff_id uuid, factors int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_owner() then
    raise exception 'Only the owner can see who has two-step sign-in' using errcode = 'insufficient_privilege';
  end if;
  return query
    select s.id, count(f.id)::int
    from staff s
    left join auth.mfa_factors f on f.user_id = s.id and f.status = 'verified'
    group by s.id;
end;
$$;

revoke execute on function staff_mfa_factors() from public, anon;
grant execute on function staff_mfa_factors() to authenticated;
