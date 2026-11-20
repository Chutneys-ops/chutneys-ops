-- Slice 9: audit log. Who changed what, and when, on every business table.
--
--   1. audit_log: one row per insert, update or delete. Append-only.
--   2. audit_row(): one trigger function for every table. It records the
--      person (auth.uid(), also inside security definer functions such as
--      mark_reimbursed), their role, the row, and for updates only the
--      columns that changed. Secrets (any column with hash, password, secret
--      or token in its name) are stripped before anything is stored.
--   3. enable_audit(table): attach the trigger in one line. EVERY NEW
--      BUSINESS TABLE MUST CALL IT in its migration; a pgTAP test fails if
--      one is forgotten.
--   4. Owner-only reading. Nobody can insert, update or delete through the
--      API, not even the owner.
--
-- Audited: every table in public except
--   - staff_pins: PIN hashes and lockout counters are secrets;
--   - audit_log itself (auditing the audit log would loop).

-- 1. Table -------------------------------------------------------------------------

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,     -- auth.uid(); null for the system (migrations, seed, SQL editor)
  actor_role text,   -- staff / manager / owner, or 'system'
  table_name text not null,
  row_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb,
  changed_fields text[]
);

create index audit_log_table_at on audit_log (table_name, at desc);
create index audit_log_actor_at on audit_log (actor_id, at desc);

-- 2. Grants and RLS ----------------------------------------------------------------

alter table audit_log enable row level security;
revoke all on audit_log from anon, authenticated;
-- Select only; the policy below limits it to the owner. Rows are written by
-- audit_row(), which runs as the table owner, so no insert grant is needed.
grant select on audit_log to authenticated;

create policy "owner reads the audit log" on audit_log for select using (is_owner());

-- Append-only, even for code that skips the grants (the SQL editor,
-- security definer functions). To prune old rows one day, disable this
-- trigger on purpose in a migration.
create or replace function audit_log_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'The audit log can''t be changed or deleted' using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function audit_log_append_only();

create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function audit_log_append_only();

-- 3. The trigger function ----------------------------------------------------------

-- Remove anything that looks like a secret: pin_hash, password, api_token...
create or replace function audit_redact(data jsonb) returns jsonb
language sql immutable as $$
  select case
    when data is null then null
    else coalesce(
      (select jsonb_object_agg(key, value)
       from jsonb_each(data)
       where key !~* '(hash|password|secret|token)'),
      '{}'::jsonb
    )
  end;
$$;

create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_json jsonb := case when tg_op in ('UPDATE', 'DELETE') then audit_redact(to_jsonb(old)) end;
  new_json jsonb := case when tg_op in ('INSERT', 'UPDATE') then audit_redact(to_jsonb(new)) end;
  row_json jsonb := coalesce(new_json, old_json);
  changed text[];
  pk text;
  who uuid := auth.uid();
  who_role text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into changed
    from jsonb_each(new_json) n
    where n.value is distinct from old_json -> n.key;
    -- Nothing really changed (e.g. the seed re-run): no audit row.
    if changed is null then
      return null;
    end if;
  end if;

  -- The row's primary key as text; "a,b" for a two-column key.
  select string_agg(row_json ->> a.attname, ',' order by k.ord) into pk
  from pg_index i
  cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
  where i.indrelid = tg_relid and i.indisprimary;

  select role into who_role from staff where id = who;

  insert into audit_log (actor_id, actor_role, table_name, row_id, action, old_data, new_data, changed_fields)
  values (
    who,
    coalesce(who_role, 'system'),
    tg_table_name,
    coalesce(pk, ''),
    lower(tg_op),
    old_json,
    new_json,
    changed
  );
  return null; -- AFTER trigger: the return value is ignored
end;
$$;

-- Attach the audit trigger to a table. Safe to call twice.
create or replace function enable_audit(target regclass) returns void
language plpgsql as $$
begin
  execute format('drop trigger if exists audit_row on %s', target);
  execute format(
    'create trigger audit_row after insert or update or delete on %s for each row execute function audit_row()',
    target
  );
end;
$$;

-- Only migrations (as postgres) attach triggers; the API can't call these.
revoke execute on function enable_audit(regclass) from public, anon, authenticated;
revoke execute on function audit_row() from public, anon, authenticated;

-- 4. Attach it ------------------------------------------------------------------------

select enable_audit('staff');
select enable_audit('staff_sites');
select enable_audit('sites');
select enable_audit('shifts');
select enable_audit('record_templates');
select enable_audit('record_sheets');
select enable_audit('record_entries');
select enable_audit('temp_units');
select enable_audit('temp_readings');
select enable_audit('purchases');
select enable_audit('leave_requests');
select enable_audit('training_records');
select enable_audit('cash_ups');
select enable_audit('daily_sales');
select enable_audit('alerts');
-- The old checklist tables: no longer used by the app, but they hold records.
select enable_audit('checklist_items');
select enable_audit('checklist_runs');
select enable_audit('checklist_ticks');
