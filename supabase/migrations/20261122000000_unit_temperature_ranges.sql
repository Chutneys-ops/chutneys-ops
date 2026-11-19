-- Each temperature unit carries its own limits (temp_units.min_c / max_c):
-- a fridge is 0 to 5 C, a freezer -25 to -15 C. Before this, the fridge
-- template's fixed "max": 5 meant a failing freezer at -5 C was never flagged.
--
-- New template option for number fields: "range_from": "<key of a temp_unit field>".
-- The trigger then reads the chosen unit's min_c and max_c. Each one that is
-- set replaces the template's min/max; a blank one falls back to the template,
-- so a unit with no limits set still gets the template's default check.
--
-- The rest of the trigger is unchanged from 20261120000000_shift_based_access.sql.

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
  unit_id_text text;
  unit_lo numeric;
  unit_hi numeric;
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
        -- "range_from": "unit": use the chosen unit's own limits. The regex
        -- check stops a bad id from crashing the cast; the temp_unit field
        -- itself reports a bad or wrong-site unit with a clear message.
        if f ? 'range_from' then
          unit_id_text := merged->>(f->>'range_from');
          if unit_id_text ~ '^[0-9a-fA-F-]{36}$' then
            select u.min_c, u.max_c into unit_lo, unit_hi
            from temp_units u
            where u.id = unit_id_text::uuid and u.site_id = sh.site_id;
            if found then
              lo := coalesce(unit_lo, lo);
              hi := coalesce(unit_hi, hi);
            end if;
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
