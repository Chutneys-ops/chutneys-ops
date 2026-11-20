-- Slice 10: hand-entered timesheets with automatic NZ breaks.
--
-- Hours now come from timesheets people fill in, not from clocking in and
-- out. "Choose site" (start_shift / shifts / on_shift_at) stays: it still
-- decides which site's records you can add today, but it no longer means
-- hours. Old shift rows are kept for history.
--
--   1. nz_breaks(minutes): rest and meal breaks from the Employment NZ table.
--   2. timesheets: date, start and finish (Auckland time; a finish earlier
--      than the start is the next morning). The database works out the real
--      start/finish instants, minutes at work, breaks and paid minutes.
--   3. Rules: no future dates, at most 16 hours, no overlaps (an exclusion
--      constraint, so two saves at once can't both slip through), staff
--      edit their own only while submitted, managers act for others with a
--      note, approved rows are locked except for a manager with a note.
--   4. approve_timesheets(ids): managers and the owner, never their own
--      (except the owner).
--   5. Illness: someone with an uncleared vomiting/diarrhoea report can't
--      enter their own hours for days after it started.
--   6. Audited.

-- For "same person AND overlapping time" in one exclusion constraint.
create extension if not exists btree_gist with schema extensions;

-- 1. Breaks ------------------------------------------------------------------------

-- Employment NZ (rest breaks 10 minutes paid, meal breaks 30 minutes unpaid):
--   under 2h: 0/0   2-4h: 1/0   >4-6h: 1/1   >6-10h: 2/1
--   >10-12h: 3/1    >12-14h: 3/2   >14-16h: 4/2
-- Mirrored in web/lib/breaks.ts; supabase/tests/nz_breaks.test.sql holds the
-- shared cases both are tested against.
create or replace function nz_breaks(minutes_at_work integer, out rest_breaks integer, out meal_breaks integer)
language sql immutable as $$
  select
    case
      when m < 120 then 0
      when m <= 360 then 1
      when m <= 600 then 2
      when m <= 840 then 3
      else 4
    end,
    case
      when m <= 240 then 0
      when m <= 720 then 1
      else 2
    end
  from (select coalesce(minutes_at_work, 0) as m) as x;
$$;

-- 2. Table ---------------------------------------------------------------------------

create table timesheets (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null default auth.uid() references staff (id),
  site_id uuid not null references sites (id),
  work_date date not null,
  start_time time not null,
  finish_time time not null,
  -- Set by the trigger below; nobody can write these.
  start_at timestamptz not null,
  finish_at timestamptz not null,
  minutes_at_work integer not null,
  rest_breaks integer not null,
  meal_breaks integer not null,
  paid_minutes integer not null,
  status text not null default 'submitted' check (status in ('submitted', 'approved')),
  approved_by uuid references staff (id),
  approved_at timestamptz,
  created_by uuid default auth.uid() references staff (id), -- null when added by the system
  edited_by uuid references staff (id),
  edit_note text check (length(edit_note) <= 300),
  created_at timestamptz not null default now(),
  constraint timesheets_approved_together check ((status = 'approved') = (approved_at is not null)),
  -- One person can't be in two places at once.
  constraint timesheets_no_overlap
    exclude using gist (staff_id with =, tstzrange(start_at, finish_at, '[)') with &&)
);

create index timesheets_staff_date on timesheets (staff_id, work_date);
create index timesheets_date_site on timesheets (work_date, site_id);
create index timesheets_to_approve on timesheets (work_date) where status = 'submitted';

-- 3. Grants and RLS -----------------------------------------------------------------------

alter table timesheets enable row level security;
revoke all on timesheets from anon, authenticated;
grant select, delete on timesheets to authenticated;
grant insert (staff_id, site_id, work_date, start_time, finish_time, edit_note) on timesheets to authenticated;
-- No staff_id: a timesheet can't be moved to another person.
grant update (site_id, work_date, start_time, finish_time, edit_note) on timesheets to authenticated;

create policy "own timesheets or manager" on timesheets
  for select using (staff_id = auth.uid() or is_manager());

create policy "add own timesheets, managers for anyone" on timesheets
  for insert to authenticated
  with check (staff_id = auth.uid() or is_manager());

-- The trigger adds the finer rules (approved rows, notes) with clear messages.
create policy "edit own timesheets, managers any" on timesheets
  for update to authenticated
  using (staff_id = auth.uid() or is_manager())
  with check (staff_id = auth.uid() or is_manager());

-- Only while submitted: an approved timesheet is never deleted.
create policy "delete submitted timesheets" on timesheets
  for delete to authenticated
  using (status = 'submitted' and (staff_id = auth.uid() or is_manager()));

-- 4. The rules -------------------------------------------------------------------------------

create or replace function timesheets_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  minutes integer;
  breaks record;
  content_changed boolean;
begin
  -- Times: Auckland wall clock -> real instants (handles daylight saving).
  -- A finish earlier than the start is the next morning.
  if new.finish_time = new.start_time then
    raise exception 'The finish time must be after the start time' using errcode = 'check_violation';
  end if;
  new.start_at := (new.work_date + new.start_time) at time zone 'Pacific/Auckland';
  new.finish_at := ((new.work_date + case when new.finish_time < new.start_time then 1 else 0 end) + new.finish_time)
    at time zone 'Pacific/Auckland';

  minutes := round(extract(epoch from new.finish_at - new.start_at) / 60);
  if minutes > 16 * 60 then
    raise exception 'A timesheet can be at most 16 hours' using errcode = 'check_violation';
  end if;
  if new.work_date > today_nz() then
    raise exception 'Hours can''t be entered for a future date' using errcode = 'check_violation';
  end if;

  select * into breaks from nz_breaks(minutes);
  new.minutes_at_work := minutes;
  new.rest_breaks := breaks.rest_breaks;
  new.meal_breaks := breaks.meal_breaks;
  new.paid_minutes := minutes - 30 * breaks.meal_breaks; -- meal breaks are unpaid

  -- The system (migrations, seed, SQL editor) skips the people rules.
  if me is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := me;
    new.status := 'submitted';
    new.approved_by := null;
    new.approved_at := null;
    new.edited_by := null;
    if new.staff_id <> me then
      if not is_manager() then
        raise exception 'You can only add your own hours' using errcode = 'insufficient_privilege';
      end if;
      if coalesce(btrim(new.edit_note), '') = '' then
        raise exception 'Add a note saying why you''re adding hours for someone else' using errcode = 'check_violation';
      end if;
    end if;
  else
    -- approve_timesheets only changes the status: no edit rules for that.
    content_changed := (new.site_id, new.work_date, new.start_time, new.finish_time, new.edit_note)
      is distinct from (old.site_id, old.work_date, old.start_time, old.finish_time, old.edit_note);
    if content_changed then
      if old.status = 'approved' and not is_manager() then
        raise exception 'This timesheet is approved. Ask a manager to change it.' using errcode = 'insufficient_privilege';
      end if;
      -- A manager changing someone else's timesheet, or any approved one.
      if old.staff_id <> me or old.status = 'approved' then
        if not is_manager() then
          raise exception 'You can only change your own hours' using errcode = 'insufficient_privilege';
        end if;
        if coalesce(btrim(new.edit_note), '') = '' or new.edit_note is not distinct from old.edit_note then
          raise exception 'Add a note saying what you changed and why' using errcode = 'check_violation';
        end if;
        new.edited_by := me;
      end if;
    end if;
  end if;

  -- Food safety: after reporting vomiting or diarrhoea, you can't enter your
  -- own hours for later days until a manager clears you. (The day it
  -- started is fine: you may have worked that morning.) A manager can still
  -- enter them with a note, because hours worked must be paid.
  if new.staff_id = me and exists (
    select 1 from leave_requests
    where staff_id = me and gi_symptoms and cleared_to_work_at is null and start_date < new.work_date
  ) then
    raise exception 'Your manager needs to clear you to return to work after illness'
      using errcode = 'insufficient_privilege', hint = 'needs_clearance';
  end if;

  return new;
end;
$$;

create trigger timesheets_before_write
  before insert or update on timesheets
  for each row execute function timesheets_before_write();

-- Approve several at once (e.g. a week at a site). Skips your own (unless
-- you're the owner) and anything already approved. Returns how many it approved.
create or replace function approve_timesheets(ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not is_manager() then
    raise exception 'Only a manager or the owner can approve hours' using errcode = 'insufficient_privilege';
  end if;
  update timesheets
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = any(ids)
    and status = 'submitted'
    and (staff_id <> auth.uid() or is_owner());
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function approve_timesheets(uuid[]) from public, anon;
grant execute on function approve_timesheets(uuid[]) to authenticated;

-- 5. Audit ------------------------------------------------------------------------------------

select enable_audit('timesheets');
