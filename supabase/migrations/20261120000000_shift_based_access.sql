-- Slice 4: access by "where you are working today"
--
-- Staff move between sites, so a fixed list of sites per person (staff_sites)
-- doesn't fit. Picking a site now means clocking in: an open shift at a site
-- is what lets you work there.
--   1. Shifts: server-stamped clock in/out, one open shift per person.
--   2. Helpers: is_manager(), on_shift_at(site), and a new can_see_site().
--   3. Sites readable by every signed-in person (for the site picker).
--   4. Records: write only where you're on shift; managers view and sign anywhere.
--   5. Money (cash_ups, daily_sales) is owner only.
--   6. Colleague names follow shifts instead of staff_sites.
--   7. Record engine: yes/no fields can expect an answer; "note" is a comment.

-- 1. Shifts ------------------------------------------------------------------

alter table shifts alter column staff_id set default auth.uid();
alter table shifts add column edited_by uuid references staff (id);
alter table shifts add column edited_at timestamptz;
alter table shifts add column edit_note text;
alter table shifts add constraint shifts_clock_out_after_clock_in
  check (clock_out is null or clock_out >= clock_in);

-- At most one open shift per person. "where clock_out is null" makes it a
-- partial index: closed shifts don't count, so history is unlimited.
create unique index shifts_one_open_per_staff on shifts (staff_id) where clock_out is null;

-- Only site_id (and an optional location note for trucks) can be sent.
-- staff_id defaults to you and clock_in to now(). No update grant at all:
-- clock_out is only ever set by the functions below.
revoke all on shifts from anon, authenticated;
grant select on shifts to authenticated;
grant insert (site_id, location_note) on shifts to authenticated;

-- 2. Helpers -----------------------------------------------------------------

-- security definer, like is_owner(): they read staff and shifts with the
-- owner's rights, so RLS on those tables can't hide the rows they check.
create or replace function is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and role in ('manager', 'owner'));
$$;

create or replace function on_shift_at(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from shifts
    where staff_id = auth.uid() and site_id = target and clock_out is null
  );
$$;

-- Same name as before, so every existing policy that calls it switches to
-- the new rule at once. It no longer looks at staff_sites.
create or replace function can_see_site(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_manager() or on_shift_at(target);
$$;

comment on table staff_sites is
  'Not used for access since the shift-based access migration: staff move between sites, '
  'so access comes from an open shift (on_shift_at). Kept for history; may be dropped later.';

-- Shift policies: see your own, managers see all. Insert your own shift at
-- an active site. The unique index above refuses a second open shift.
drop policy "site shifts" on shifts;
create policy "own shifts or manager" on shifts
  for select using (staff_id = auth.uid() or is_manager());
create policy "clock in at active sites" on shifts
  for insert to authenticated
  with check (
    staff_id = auth.uid()
    and exists (select 1 from sites s where s.id = shifts.site_id and s.active)
  );

-- Change site in one step: close any open shift, open one at the new site.
-- Both use the same now(), so there's no gap and no overlap.
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
  -- Already working here (double tap): keep the shift you have.
  if found and current_shift.site_id = start_shift.site_id then
    return current_shift.id;
  end if;
  if found then
    update shifts set clock_out = now() where id = current_shift.id;
  end if;

  insert into shifts (site_id, staff_id) values (start_shift.site_id, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function clock_out() returns void
language plpgsql security definer set search_path = public as $$
begin
  update shifts set clock_out = now()
  where staff_id = auth.uid() and clock_out is null;
end;
$$;

-- A manager fixes someone's forgotten clock-out. The note and editor are
-- kept on the row, so payroll can see what was changed and why.
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
  set clock_out = new_clock_out, edited_by = auth.uid(), edited_at = now(), edit_note = btrim(note)
  where id = s.id;
end;
$$;

revoke execute on function start_shift(uuid) from public, anon;
revoke execute on function clock_out() from public, anon;
revoke execute on function fix_clock_out(uuid, timestamptz, text) from public, anon;
grant execute on function start_shift(uuid) to authenticated;
grant execute on function clock_out() to authenticated;
grant execute on function fix_clock_out(uuid, timestamptz, text) to authenticated;

-- 3. Sites -------------------------------------------------------------------

-- The site picker lists every active site, so any signed-in person can read
-- those. Managers and the owner also see closed (inactive) sites.
drop policy "see own sites" on sites;
create policy "signed-in see active sites" on sites
  for select using (auth.uid() is not null and active);
create policy "managers see all sites" on sites
  for select using (is_manager());

-- 4. Records -----------------------------------------------------------------

-- Viewing still uses can_see_site (managers everywhere, staff where on
-- shift). Writing needs an open shift at that site, for managers too.
drop policy "start sheets at own sites" on record_sheets;
create policy "start sheets where on shift" on record_sheets
  for insert to authenticated
  with check (
    on_shift_at(site_id)
    and sheet_date = today_nz()
    and started_by = auth.uid()
    and exists (
      select 1
      from record_templates t
      join sites s on s.id = record_sheets.site_id
      where t.code = record_sheets.template_code
        and t.active
        and s.kind = any (t.site_kinds)
    )
  );

drop policy "add entries at own sites" on record_entries;
create policy "add entries where on shift" on record_entries
  for insert to authenticated
  with check (
    recorded_by = auth.uid()
    and exists (
      select 1 from record_sheets sh
      where sh.id = record_entries.sheet_id and on_shift_at(sh.site_id)
    )
  );

comment on column record_entries.note is
  'Optional comment on any entry, shown as "Comments". Required for corrections.';

-- Sign-off: managers and owners at any site. The PIN check is unchanged.
create or replace function sign_off_sheet(sheet_id uuid, pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  sh record_sheets%rowtype;
  stored text;
begin
  if not is_manager() then
    raise exception 'Only managers and owners can sign off records' using errcode = 'insufficient_privilege';
  end if;

  select * into sh from record_sheets s where s.id = sign_off_sheet.sheet_id;
  if not found then
    raise exception 'Sheet not found' using errcode = 'invalid_parameter_value';
  end if;

  select pin_hash into stored from staff_pins where staff_id = auth.uid();
  if stored is null then
    raise exception 'Set your PIN in Settings first' using errcode = 'invalid_parameter_value';
  end if;
  if pin is null or crypt(pin, stored) is distinct from stored then
    raise exception 'Wrong PIN' using errcode = 'invalid_password';
  end if;

  if sh.signed_off_at is not null then
    return;
  end if;
  if not exists (select 1 from record_entries e where e.sheet_id = sh.id) then
    raise exception 'Nothing to sign off yet' using errcode = 'check_violation';
  end if;

  update record_sheets
  set signed_off_by = auth.uid(), signed_off_at = now()
  where id = sh.id;
end;
$$;

-- 5. Money is owner only -----------------------------------------------------

drop policy "site cash ups" on cash_ups;
create policy "owner cash ups" on cash_ups for select using (is_owner());
-- daily_sales already has "owner sales" using is_owner(); nothing to change.

-- 6. Colleague names -----------------------------------------------------------

-- "Recorded by Ana" needs Ana's name. Staff can see:
--   - managers and owners (they sign off sheets),
--   - anyone with a shift in the last 2 days at the site they're on shift at
--     now (everyone who could have written today's or yesterday's entries).
-- Managers and owners see everyone.
create or replace function shares_site_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_manager()
    or exists (select 1 from staff where id = other and role in ('manager', 'owner'))
    or exists (
      select 1
      from shifts mine
      join shifts theirs on theirs.site_id = mine.site_id
      where mine.staff_id = auth.uid()
        and mine.clock_out is null
        and theirs.staff_id = other
        and theirs.clock_in > now() - interval '2 days'
    );
$$;

-- 7. Record engine -------------------------------------------------------------

-- Same trigger as the records migration, with two changes:
--   - a yes_no field with "expect": true/false flags the other answer as out
--     of range (so "No" on an opening check needs a corrective action);
--   - messages say "comment" for the note.
create or replace function record_entries_before_insert() returns trigger
language plpgsql as $$
declare
  sh record_sheets%rowtype;
  tpl record_templates%rowtype;
  target record_entries%rowtype;
  base jsonb := '{}';
  merged jsonb;
  f jsonb;
  k text;
  v jsonb;
  num numeric;
  lo numeric;
  hi numeric;
  rng jsonb;
  is_amend boolean := new.amends_entry_id is not null;
  is_cont boolean := new.continues_entry_id is not null;
  skip_required boolean := false;
  flagged boolean := false;
begin
  select * into sh from record_sheets where id = new.sheet_id;
  if not found then
    raise exception 'You can''t add records to this sheet' using errcode = 'insufficient_privilege';
  end if;
  select * into tpl from record_templates where code = sh.template_code;

  if is_amend then
    select * into target from record_entries where id = new.amends_entry_id;
    if not found or target.sheet_id <> new.sheet_id then
      raise exception 'You can only correct an entry on the same sheet' using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.note), '') = '' then
      raise exception 'A correction needs a comment saying what was wrong' using errcode = 'check_violation';
    end if;
    if target.continues_entry_id is not null then
      skip_required := true;
      select "values" into base from record_entries where id = target.continues_entry_id;
    end if;
  elsif is_cont then
    select * into target from record_entries where id = new.continues_entry_id;
    if not found or target.sheet_id <> new.sheet_id
       or target.continues_entry_id is not null or target.amends_entry_id is not null then
      raise exception 'A follow-up reading must belong to an original entry on the same sheet'
        using errcode = 'check_violation';
    end if;
    if sh.signed_off_at is not null then
      raise exception 'This sheet is signed off: add a correction instead' using errcode = 'insufficient_privilege';
    end if;
    if sh.sheet_date < today_nz() - 1 then
      raise exception 'Too late to add a reading to this record' using errcode = 'insufficient_privilege';
    end if;
    skip_required := true;
    base := target."values";
  else
    if sh.signed_off_at is not null then
      raise exception 'This sheet is signed off: add a correction instead' using errcode = 'insufficient_privilege';
    end if;
    if sh.sheet_date <> today_nz() then
      raise exception 'New entries can only go on today''s sheet' using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new."values" is null or jsonb_typeof(new."values") <> 'object' then
    raise exception 'Values must be a JSON object' using errcode = 'check_violation';
  end if;

  for k in select jsonb_object_keys(new."values") loop
    if not exists (select 1 from jsonb_array_elements(tpl.fields) e where e->>'key' = k) then
      raise exception 'Unknown field: %', k using errcode = 'check_violation';
    end if;
  end loop;

  if skip_required and not exists (
    select 1 from jsonb_each(new."values") e
    where e.value <> 'null'::jsonb and not (jsonb_typeof(e.value) = 'string' and btrim(e.value #>> '{}') = '')
  ) then
    raise exception 'Add at least one reading' using errcode = 'check_violation';
  end if;

  merged := base || new."values";

  for f in select * from jsonb_array_elements(tpl.fields) loop
    k := f->>'key';
    v := new."values"->k;

    if v is null or v = 'null'::jsonb or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
      if coalesce((f->>'required')::boolean, false) and not skip_required then
        raise exception '% is required', f->>'label' using errcode = 'check_violation';
      end if;
      continue;
    end if;

    case f->>'type'
      when 'number' then
        if jsonb_typeof(v) <> 'number' then
          raise exception '% must be a number', f->>'label' using errcode = 'check_violation';
        end if;
        num := (v #>> '{}')::numeric;
        lo := (f->>'min')::numeric;
        hi := (f->>'max')::numeric;
        if f ? 'range_when' then
          rng := f->'range_when'->'ranges'->(merged->>(f->'range_when'->>'field'));
          if rng is not null then
            lo := coalesce((rng->>'min')::numeric, lo);
            hi := coalesce((rng->>'max')::numeric, hi);
          end if;
        end if;
        if (lo is not null and num < lo) or (hi is not null and num > hi) then
          flagged := true;
        end if;
      when 'time' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
          raise exception '% must be a time like 14:30', f->>'label' using errcode = 'check_violation';
        end if;
      when 'date' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception '% must be a date like 2026-11-19', f->>'label' using errcode = 'check_violation';
        end if;
        begin
          perform (v #>> '{}')::date;
        exception when others then
          raise exception '% is not a real date', f->>'label' using errcode = 'check_violation';
        end;
      when 'select' then
        if jsonb_typeof(v) <> 'string' or not ((f->'options') ? (v #>> '{}')) then
          raise exception '% must be one of the listed options', f->>'label' using errcode = 'check_violation';
        end if;
      when 'yes_no' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception '% must be yes or no', f->>'label' using errcode = 'check_violation';
        end if;
        -- e.g. "expect": true on "Fridges at 5 C or below": a No is a problem.
        if f ? 'expect' and v <> (f->'expect') then
          flagged := true;
        end if;
      when 'temp_unit' then
        if jsonb_typeof(v) <> 'string'
           or (v #>> '{}') !~ '^[0-9a-fA-F-]{36}$'
           or not exists (
             select 1 from temp_units u where u.id = (v #>> '{}')::uuid and u.site_id = sh.site_id
           ) then
          raise exception '% must be a unit at this site', f->>'label' using errcode = 'check_violation';
        end if;
      when 'text' then
        if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 500 then
          raise exception '% must be text of 500 characters or less', f->>'label' using errcode = 'check_violation';
        end if;
      else
        raise exception 'Unknown field type % in template %', f->>'type', tpl.code using errcode = 'check_violation';
    end case;
  end loop;

  new.out_of_range := flagged;
  if flagged and coalesce(btrim(new.corrective_action), '') = '' then
    raise exception 'Out of range: say what you did about it (corrective action)' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
