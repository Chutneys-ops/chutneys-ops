-- Slice 3: food safety records
--   1. record_templates: what each kind of record asks for (data, not code).
--   2. record_sheets: one per site + template + Auckland day.
--   3. record_entries: append-only readings, checked by a trigger.
--   4. Manager sign-off with a PIN.
--
-- Same three layers as the checklist slice:
--   GRANTs say which columns you can write, RLS says which rows,
--   and a trigger checks the values themselves.

-- 1. Templates -------------------------------------------------------------

-- fields is a JSON list. Each field looks like:
--   { "key": "temp", "label": "Temperature", "type": "number",
--     "required": true, "min": 75, "max": 5, "unit": "C",
--     "options": ["a", "b"],
--     "range_when": { "field": "mode", "ranges": { "chilled": {"max": 5}, "hot": {"min": 60} } } }
-- type is one of: text, number, time, date, select, yes_no, temp_unit.
-- range_when swaps in a different min/max depending on another field's value.
create table record_templates (
  code text primary key,
  title text not null,
  description text,
  period text not null check (period in ('daily', 'event')),
  site_kinds text[] not null default '{restaurant,cafe,truck}',
  fields jsonb not null check (jsonb_typeof(fields) = 'array'),
  sort_order int not null default 0,
  active boolean not null default true
);

alter table record_templates enable row level security;
create policy "templates readable" on record_templates
  for select using (auth.uid() is not null);
-- Templates only change through seed.sql or migrations.
revoke all on record_templates from anon, authenticated;
grant select on record_templates to authenticated;

-- 2. Sheets ----------------------------------------------------------------

create table record_sheets (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  template_code text not null references record_templates (code),
  sheet_date date not null default today_nz(),
  started_by uuid not null default auth.uid() references staff (id),
  started_at timestamptz not null default now(),
  signed_off_by uuid references staff (id),
  signed_off_at timestamptz,
  unique (site_id, template_code, sheet_date)
);

alter table record_sheets enable row level security;

-- Only site_id and template_code can be sent. The date, who started it and
-- when all come from defaults. Nobody can update a sheet directly: sign-off
-- goes through sign_off_sheet() below.
revoke all on record_sheets from anon, authenticated;
grant select on record_sheets to authenticated;
grant insert (site_id, template_code) on record_sheets to authenticated;

create policy "site sheets" on record_sheets
  for select using (can_see_site(site_id));

-- Start today's sheet at your own site, for a template that applies to it.
create policy "start sheets at own sites" on record_sheets
  for insert to authenticated
  with check (
    can_see_site(site_id)
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

-- 3. Entries ---------------------------------------------------------------

-- "values" is a reserved word in SQL, so it is always written in quotes here.
create table record_entries (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references record_sheets (id),
  "values" jsonb not null default '{}',
  out_of_range boolean not null default false,
  corrective_action text,
  recorded_by uuid not null default auth.uid() references staff (id),
  recorded_at timestamptz not null default now(),
  -- A correction of an earlier entry (needs a note).
  amends_entry_id uuid references record_entries (id),
  -- A later reading for the same dish or batch (cooling, batter).
  continues_entry_id uuid references record_entries (id),
  note text,
  check (amends_entry_id is null or continues_entry_id is null)
);

create index record_entries_sheet_id_idx on record_entries (sheet_id);

alter table record_entries enable row level security;

-- recorded_by, recorded_at and out_of_range are not in this list, so the
-- browser can't fake who, when, or whether it was in range.
-- No update or delete grants at all: entries are permanent.
revoke all on record_entries from anon, authenticated;
grant select on record_entries to authenticated;
grant insert (sheet_id, "values", corrective_action, amends_entry_id, continues_entry_id, note)
  on record_entries to authenticated;

create policy "site entries" on record_entries
  for select using (
    exists (select 1 from record_sheets sh where sh.id = sheet_id and can_see_site(sh.site_id))
  );

create policy "add entries at own sites" on record_entries
  for insert to authenticated
  with check (
    recorded_by = auth.uid()
    and exists (
      select 1 from record_sheets sh
      where sh.id = record_entries.sheet_id and can_see_site(sh.site_id)
    )
  );

-- The trigger: decides what kind of entry this is, checks the values
-- against the template, and sets out_of_range itself.
create or replace function record_entries_before_insert() returns trigger
language plpgsql as $$
declare
  sh record_sheets%rowtype;
  tpl record_templates%rowtype;
  target record_entries%rowtype;
  base jsonb := '{}';        -- values of the original entry, for continuations
  merged jsonb;              -- base + new values, for range_when lookups
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
  -- RLS hides sheets at other sites, so "not found" means "not yours".
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
      raise exception 'A correction needs a note saying what was wrong' using errcode = 'check_violation';
    end if;
    -- Correcting a follow-up reading: it doesn't need the first entry's fields again.
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

  -- Refuse keys the template doesn't know about.
  for k in select jsonb_object_keys(new."values") loop
    if not exists (select 1 from jsonb_array_elements(tpl.fields) e where e->>'key' = k) then
      raise exception 'Unknown field: %', k using errcode = 'check_violation';
    end if;
  end loop;

  -- A follow-up with nothing in it is pointless.
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

    -- Missing, null or blank all count as "not filled in".
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
        -- e.g. transport: chilled must arrive at 5 or below, hot at 60 or above.
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

create trigger record_entries_check
  before insert on record_entries
  for each row execute function record_entries_before_insert();

-- 4. PINs and sign-off -----------------------------------------------------

-- Only hashes are stored (bcrypt via pgcrypto's crypt()). No policies and no
-- grants: nobody can read this table through the API. The two functions
-- below are the only way in.
create table staff_pins (
  staff_id uuid primary key references staff (id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

alter table staff_pins enable row level security;
revoke all on staff_pins from anon, authenticated;

-- pgcrypto lives in the "extensions" schema on Supabase, hence the search_path.
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

  insert into staff_pins (staff_id, pin_hash, updated_at)
  values (auth.uid(), crypt(pin, gen_salt('bf')), now())
  on conflict (staff_id) do update
    set pin_hash = excluded.pin_hash, updated_at = excluded.updated_at;
end;
$$;

-- security definer: it runs with the owner's rights so it can update the
-- sheet (nobody else can), so it must check everything itself first.
create or replace function sign_off_sheet(sheet_id uuid, pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  me staff%rowtype;
  sh record_sheets%rowtype;
  stored text;
begin
  select * into me from staff where id = auth.uid();
  if not found or me.role not in ('manager', 'owner') then
    raise exception 'Only managers and owners can sign off records' using errcode = 'insufficient_privilege';
  end if;

  select * into sh from record_sheets s where s.id = sign_off_sheet.sheet_id;
  if not found or not can_see_site(sh.site_id) then
    raise exception 'You can''t sign off records for this site' using errcode = 'insufficient_privilege';
  end if;

  select pin_hash into stored from staff_pins where staff_id = me.id;
  if stored is null then
    raise exception 'Set your PIN in Settings first' using errcode = 'invalid_parameter_value';
  end if;
  -- crypt(pin, stored) re-hashes the PIN with the salt saved inside stored.
  if pin is null or crypt(pin, stored) is distinct from stored then
    raise exception 'Wrong PIN' using errcode = 'invalid_password';
  end if;

  if sh.signed_off_at is not null then
    return; -- Already signed (double tap): nothing to do.
  end if;
  if not exists (select 1 from record_entries e where e.sheet_id = sh.id) then
    raise exception 'Nothing to sign off yet' using errcode = 'check_violation';
  end if;

  update record_sheets
  set signed_off_by = me.id, signed_off_at = now()
  where id = sh.id;
end;
$$;

revoke execute on function set_my_pin(text) from public, anon;
revoke execute on function sign_off_sheet(uuid, text) from public, anon;
grant execute on function set_my_pin(text) to authenticated;
grant execute on function sign_off_sheet(uuid, text) to authenticated;
