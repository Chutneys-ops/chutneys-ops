-- Slice 5: safety fixes before real staff use the app
--   1. PIN lockout: 5 wrong PINs lock sign-off for 15 minutes.
--   2. Forgotten clock-outs: a shift open for more than 14 hours no longer
--      counts, and is closed with zero hours for a manager to fix.

-- 1. PIN lockout ---------------------------------------------------------------

alter table staff_pins
  add column failed_attempts int not null default 0,
  add column locked_until timestamptz;

-- THE KEY LESSON OF THIS SLICE:
-- RAISE EXCEPTION undoes everything the function has done so far. If a
-- wrong PIN did "update failed_attempts ... ; raise exception 'Wrong PIN'",
-- the raise would roll the update back and the counter would never move.
-- So a wrong PIN (and a lock) RETURN a status instead of raising: returning
-- normally keeps the update. Errors that don't need to save anything (not a
-- manager, no PIN set, nothing to sign) still raise.
--
-- The return type changes from void to jsonb, which "create or replace"
-- can't do, so the function is dropped and created again. Dropping it also
-- drops its grants, so they are given again at the end.
drop function sign_off_sheet(uuid, text);

create function sign_off_sheet(sheet_id uuid, pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  max_attempts constant int := 5;
  lock_for constant interval := interval '15 minutes';
  sh record_sheets%rowtype;
  p staff_pins%rowtype;
  attempts int;
begin
  if not is_manager() then
    raise exception 'Only managers and owners can sign off records' using errcode = 'insufficient_privilege';
  end if;

  select * into sh from record_sheets s where s.id = sign_off_sheet.sheet_id;
  if not found then
    raise exception 'Sheet not found' using errcode = 'invalid_parameter_value';
  end if;
  if sh.signed_off_at is not null then
    return jsonb_build_object('status', 'ok'); -- already signed (double tap)
  end if;
  if not exists (select 1 from record_entries e where e.sheet_id = sh.id) then
    raise exception 'Nothing to sign off yet' using errcode = 'check_violation';
  end if;

  select * into p from staff_pins where staff_id = auth.uid();
  if not found then
    raise exception 'Set your PIN in Settings first' using errcode = 'invalid_parameter_value';
  end if;

  -- A lock that has run out starts a fresh count.
  if p.locked_until is not null and p.locked_until <= now() then
    update staff_pins set failed_attempts = 0, locked_until = null where staff_id = p.staff_id;
    p.failed_attempts := 0;
    p.locked_until := null;
  end if;

  -- Still locked: refuse even the right PIN. No raise, nothing to undo.
  if p.locked_until is not null then
    return jsonb_build_object(
      'status', 'locked',
      'minutes', ceil(extract(epoch from (p.locked_until - now())) / 60)::int
    );
  end if;

  -- Wrong PIN: count it and RETURN, so the new count is kept.
  if pin is null or crypt(pin, p.pin_hash) is distinct from p.pin_hash then
    attempts := p.failed_attempts + 1;
    if attempts >= max_attempts then
      update staff_pins
      set failed_attempts = attempts, locked_until = now() + lock_for
      where staff_id = p.staff_id;
      return jsonb_build_object('status', 'locked', 'minutes', extract(epoch from lock_for)::int / 60);
    end if;
    update staff_pins set failed_attempts = attempts where staff_id = p.staff_id;
    return jsonb_build_object('status', 'wrong_pin', 'attempts_left', max_attempts - attempts);
  end if;

  -- Right PIN: clear the count, then sign.
  update staff_pins set failed_attempts = 0, locked_until = null where staff_id = p.staff_id;
  update record_sheets
  set signed_off_by = auth.uid(), signed_off_at = now()
  where id = sh.id;
  return jsonb_build_object('status', 'ok');
end;
$$;

revoke execute on function sign_off_sheet(uuid, text) from public, anon;
grant execute on function sign_off_sheet(uuid, text) to authenticated;

-- Setting a new PIN also clears any count or lock.
create or replace function set_my_pin(pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (
    select 1 from staff where id = auth.uid() and role in ('manager', 'owner')
  ) then
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

-- 2. Forgotten clock-outs --------------------------------------------------------

-- Closed by the app because nobody clocked out: zero hours until a manager
-- sets the real time with fix_clock_out.
alter table shifts add column needs_review boolean not null default false;

-- One place for "how old can an open shift be and still count".
-- Open shifts that started before this are stale.
create or replace function stale_shift_cutoff() returns timestamptz
language sql stable as $$
  select now() - interval '14 hours';
$$;

create or replace function on_shift_at(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from shifts
    where staff_id = auth.uid()
      and site_id = target
      and clock_out is null
      and clock_in > stale_shift_cutoff()
  );
$$;

-- Close a stale shift without inventing hours: clock_out = clock_in.
create or replace function close_stale_shift(shift_id uuid) returns void
language sql security definer set search_path = public as $$
  update shifts
  set clock_out = clock_in, needs_review = true
  where id = shift_id and clock_out is null;
$$;
-- Only start_shift and clock_out call it (they run as the owner).
revoke execute on function close_stale_shift(uuid) from public, anon, authenticated;

create or replace function start_shift(site_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  current_shift shifts%rowtype;
  new_id uuid;
begin
  if not exists (select 1 from staff where id = auth.uid()) then
    raise exception 'Only staff can clock in' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from sites s where s.id = start_shift.site_id and s.active) then
    raise exception 'That site doesn''t exist or is closed' using errcode = 'invalid_parameter_value';
  end if;

  select * into current_shift from shifts where staff_id = auth.uid() and clock_out is null;
  if found then
    if current_shift.clock_in <= stale_shift_cutoff() then
      -- Forgotten clock-out: close it with zero hours for a manager to fix.
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

-- Clocking out 20 hours later must not record 20 hours either.
create or replace function clock_out() returns void
language plpgsql security definer set search_path = public as $$
declare
  current_shift shifts%rowtype;
begin
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

-- Same checks as before; a fix now also clears needs_review.
create or replace function fix_clock_out(shift_id uuid, new_clock_out timestamptz, note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s shifts%rowtype;
begin
  if not is_manager() then
    raise exception 'Only managers and owners can fix shifts' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(note), '') = '' then
    raise exception 'Say why the clock-out was changed' using errcode = 'check_violation';
  end if;
  select * into s from shifts where id = fix_clock_out.shift_id;
  if not found then
    raise exception 'Shift not found' using errcode = 'invalid_parameter_value';
  end if;
  if new_clock_out is null or new_clock_out < s.clock_in or new_clock_out > now() then
    raise exception 'The clock-out must be after the clock-in and not in the future'
      using errcode = 'check_violation';
  end if;

  update shifts
  set clock_out = new_clock_out,
      needs_review = false,
      edited_by = auth.uid(),
      edited_at = now(),
      edit_note = btrim(note)
  where id = s.id;
end;
$$;
