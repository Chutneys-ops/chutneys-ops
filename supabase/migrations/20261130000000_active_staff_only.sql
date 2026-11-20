-- Slice 13b: nothing new can be added FOR a turned-off person.
--
-- The staff accounts migration stops a turned-off person doing anything
-- themselves. This one stops anyone else adding rows about them:
--   - timesheets (a manager's "Add hours for someone"),
--   - training records (the trainee),
--   - leave requests,
--   - site choices (shifts) and food safety records (sheets and entries).
-- Their existing rows stay; only new ones are refused.
--
--   1. require_active_staff(person, what): the one place the rule and its
--      message live.
--   2. active_staff_only(): one BEFORE INSERT trigger function, attached to
--      each table with the column that names the person.
--
-- It applies to everyone, including migrations, the seed and the SQL
-- editor: a turned-off person can't be added to anything until the owner
-- turns them back on.

-- 1. The rule ----------------------------------------------------------------------

-- Raises if person is a turned-off staff member. what: "hours", "training"...
--   - for yourself: 42501 "Your account is turned off" (same as RLS);
--   - for someone else: 23514 "Ana's account is turned off, so you can't
--     add hours for them." with hint 'staff_inactive' for the app.
-- security definer: reads staff whatever its policies say.
create or replace function require_active_staff(person uuid, what text) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  who staff%rowtype;
begin
  select * into who from staff where id = person;
  if not found or who.active then
    return;
  end if;
  if person = auth.uid() then
    raise exception 'Your account is turned off' using errcode = 'insufficient_privilege';
  end if;
  raise exception '%''s account is turned off, so you can''t add % for them. The owner can turn it back on in More > Staff.',
    who.name, what
    using errcode = 'check_violation', hint = 'staff_inactive';
end;
$$;

revoke execute on function require_active_staff(uuid, text) from public, anon;
grant execute on function require_active_staff(uuid, text) to authenticated;

-- 2. One trigger function for every table --------------------------------------------

-- tg_argv[0]: the column holding the person; tg_argv[1]: what to call the
-- rows in the message. to_jsonb(new) reads the column by name, so one
-- function works for every table.
create or replace function active_staff_only() returns trigger
language plpgsql as $$
begin
  perform require_active_staff((to_jsonb(new) ->> tg_argv[0])::uuid, tg_argv[1]);
  return new;
end;
$$;

revoke execute on function active_staff_only() from public, anon, authenticated;

-- Postgres runs BEFORE triggers in name order. "active_staff_only" sorts
-- before timesheets_before_write and record_entries_before_insert, so this
-- clear message comes first, before any other check.
create trigger active_staff_only before insert on timesheets
  for each row execute function active_staff_only('staff_id', 'hours');
create trigger active_staff_only before insert on training_records
  for each row execute function active_staff_only('trainee_id', 'training');
create trigger active_staff_only before insert on leave_requests
  for each row execute function active_staff_only('staff_id', 'leave');
create trigger active_staff_only before insert on shifts
  for each row execute function active_staff_only('staff_id', 'a site choice');
create trigger active_staff_only before insert on record_sheets
  for each row execute function active_staff_only('started_by', 'records');
create trigger active_staff_only before insert on record_entries
  for each row execute function active_staff_only('recorded_by', 'records');
