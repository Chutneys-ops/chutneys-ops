-- Slice 6: rosters. Managers plan each site's week, publish it, and staff
-- see their shifts. Timesheet approval compares rostered with actual hours.
--
--   1. roster_weeks: one per site per week (week_start is a Monday).
--      published_at/by when a manager publishes; changed_at when a published
--      week is edited, until it is published again.
--   2. roster_shifts: person, day, start and finish (Auckland time; a finish
--      earlier than the start is the next morning), position and note. The
--      database works out the real instants, breaks (nz_breaks) and paid
--      minutes, like timesheets. No overlapping shifts for one person at
--      ANY site (an exclusion constraint).
--   3. RLS: only managers and the owner write. Staff see only their own
--      shifts, and only in published weeks.
--   4. Functions: ensure_roster_week, publish_roster_week, copy_roster_week,
--      roster_warnings (leave, over 40 hours) and roster_coworkers ("who's
--      on with me": names and times only).
--   5. The project rules: enable_audit, enable_active_only, active_staff_only.

-- 1. Weeks ----------------------------------------------------------------------------

create table roster_weeks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  -- The Monday the week starts on (Auckland dates; weeks run Monday to Sunday).
  week_start date not null,
  published_at timestamptz,
  published_by uuid references staff (id),
  -- Set when a published week is edited; cleared when it is published again.
  changed_at timestamptz,
  created_by uuid default auth.uid() references staff (id), -- null when added by the system
  created_at timestamptz not null default now(),
  constraint roster_weeks_one_per_site unique (site_id, week_start),
  constraint roster_weeks_monday check (extract(isodow from week_start) = 1),
  constraint roster_weeks_published_together check ((published_at is null) = (published_by is null)),
  constraint roster_weeks_changed_after_publish check (changed_at is null or published_at is not null)
);

-- 2. Shifts ---------------------------------------------------------------------------

create table roster_shifts (
  id uuid primary key default gen_random_uuid(),
  roster_week_id uuid not null references roster_weeks (id),
  -- Copied from the week by the trigger, so "same site" queries are simple.
  site_id uuid not null references sites (id),
  staff_id uuid not null references staff (id),
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
  position text check (length(position) <= 40),
  note text check (length(note) <= 200),
  created_by uuid default auth.uid() references staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  -- One person can't be rostered in two places at once, at any site.
  constraint roster_shifts_no_overlap
    exclude using gist (staff_id with =, tstzrange(start_at, finish_at, '[)') with &&)
);

create index roster_shifts_week on roster_shifts (roster_week_id, work_date);
create index roster_shifts_staff_date on roster_shifts (staff_id, work_date);
create index roster_shifts_site_date on roster_shifts (site_id, work_date);

-- 3. Helpers --------------------------------------------------------------------------

-- security definer so the two tables' policies can look at each other
-- without going round in circles (RLS on one calling RLS on the other).
create or replace function roster_week_published(week_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from roster_weeks where id = week_id and published_at is not null);
$$;

-- Are YOU on this week's roster? (Only your own shifts: no person argument.)
create or replace function rostered_in_week(week_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from roster_shifts where roster_week_id = week_id and staff_id = auth.uid());
$$;

revoke execute on function roster_week_published(uuid) from public, anon;
revoke execute on function rostered_in_week(uuid) from public, anon;
grant execute on function roster_week_published(uuid) to authenticated;
grant execute on function rostered_in_week(uuid) to authenticated;

-- 4. Grants and RLS -------------------------------------------------------------------

alter table roster_weeks enable row level security;
alter table roster_shifts enable row level security;

-- Weeks are made with ensure_roster_week and published with
-- publish_roster_week, so the API only needs to read them.
revoke all on roster_weeks from anon, authenticated;
grant select on roster_weeks to authenticated;

create policy "managers see all weeks, staff their published ones" on roster_weeks
  for select using (is_manager() or (published_at is not null and rostered_in_week(id)));

-- Shifts: no grant on site_id, the times, breaks or paid minutes (the
-- trigger sets them), nor on created_by. A shift can't move to another week.
revoke all on roster_shifts from anon, authenticated;
grant select, delete on roster_shifts to authenticated;
grant insert (roster_week_id, staff_id, work_date, start_time, finish_time, position, note)
  on roster_shifts to authenticated;
grant update (staff_id, work_date, start_time, finish_time, position, note) on roster_shifts to authenticated;

create policy "managers see all shifts, staff their own published ones" on roster_shifts
  for select using (is_manager() or (staff_id = auth.uid() and roster_week_published(roster_week_id)));

create policy "managers add shifts" on roster_shifts
  for insert to authenticated with check (is_manager());

create policy "managers change shifts" on roster_shifts
  for update to authenticated using (is_manager()) with check (is_manager());

create policy "managers delete shifts" on roster_shifts
  for delete to authenticated using (is_manager());

-- 5. The rules ------------------------------------------------------------------------

create or replace function roster_shifts_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  week roster_weeks%rowtype;
  minutes integer;
  breaks record;
begin
  -- RLS already refuses staff; this gives the same answer with a clear message.
  if me is not null and not is_manager() then
    raise exception 'Only a manager or the owner can change the roster' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' and new.roster_week_id is distinct from old.roster_week_id then
    raise exception 'A shift can''t move to another week. Delete it and add it again.'
      using errcode = 'check_violation';
  end if;

  select * into week from roster_weeks where id = new.roster_week_id;
  if not found then
    raise exception 'Roster week not found' using errcode = 'foreign_key_violation';
  end if;
  if new.work_date < week.week_start or new.work_date > week.week_start + 6 then
    raise exception 'The day must be inside the roster week (% to %)', week.week_start, week.week_start + 6
      using errcode = 'check_violation';
  end if;
  new.site_id := week.site_id;

  -- Times: Auckland wall clock -> real instants (handles daylight saving).
  -- A finish earlier than the start is the next morning. Same as timesheets.
  if new.finish_time = new.start_time then
    raise exception 'The finish time must be after the start time' using errcode = 'check_violation';
  end if;
  new.start_at := (new.work_date + new.start_time) at time zone 'Pacific/Auckland';
  new.finish_at := ((new.work_date + case when new.finish_time < new.start_time then 1 else 0 end) + new.finish_time)
    at time zone 'Pacific/Auckland';

  minutes := round(extract(epoch from new.finish_at - new.start_at) / 60);
  if minutes > 16 * 60 then
    raise exception 'A shift can be at most 16 hours' using errcode = 'check_violation';
  end if;

  select * into breaks from nz_breaks(minutes);
  new.minutes_at_work := minutes;
  new.rest_breaks := breaks.rest_breaks;
  new.meal_breaks := breaks.meal_breaks;
  new.paid_minutes := minutes - 30 * breaks.meal_breaks; -- meal breaks are unpaid

  new.position := nullif(btrim(new.position), '');
  new.note := nullif(btrim(new.note), '');

  if tg_op = 'INSERT' then
    new.created_by := coalesce(me, new.created_by);
    new.created_at := now();
    new.updated_at := null;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger roster_shifts_before_write
  before insert or update on roster_shifts
  for each row execute function roster_shifts_before_write();

-- Any change to a published week marks it "changed since published".
-- security definer: nobody has an update grant on roster_weeks.
create or replace function roster_shifts_mark_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update roster_weeks
  set changed_at = now()
  where id = case when tg_op = 'DELETE' then old.roster_week_id else new.roster_week_id end
    and published_at is not null;
  return null;
end;
$$;

create trigger roster_shifts_mark_changed
  after insert or update or delete on roster_shifts
  for each row execute function roster_shifts_mark_changed();

revoke execute on function roster_shifts_before_write() from public, anon, authenticated;
revoke execute on function roster_shifts_mark_changed() from public, anon, authenticated;

-- Who published, and when, come from the database. Only publish_roster_week
-- sets them, and the week's site and Monday never change.
create or replace function roster_weeks_before_update() returns trigger
language plpgsql as $$
begin
  if (new.site_id, new.week_start, new.created_by, new.created_at)
     is distinct from (old.site_id, old.week_start, old.created_by, old.created_at) then
    raise exception 'A roster week''s site and dates can''t change' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger roster_weeks_before_update
  before update on roster_weeks
  for each row execute function roster_weeks_before_update();

-- 6. Functions for the page -------------------------------------------------------------

-- The week row for a site and Monday, made if it isn't there yet.
create or replace function ensure_roster_week(site uuid, monday date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  week_id uuid;
begin
  if not is_manager() then
    raise exception 'Only a manager or the owner can change the roster' using errcode = 'insufficient_privilege';
  end if;
  if extract(isodow from monday) <> 1 then
    raise exception 'A roster week starts on a Monday' using errcode = 'invalid_parameter_value';
  end if;
  insert into roster_weeks (site_id, week_start) values (site, monday)
  on conflict (site_id, week_start) do nothing;
  select id into week_id from roster_weeks where site_id = site and week_start = monday;
  return week_id;
end;
$$;

-- Publish (or re-publish) a week: stamps the time and the person, and
-- clears "changed since published". Returns whether it had been published
-- before, so the app knows which notification to send.
create or replace function publish_roster_week(week_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  week roster_weeks%rowtype;
begin
  if not is_manager() then
    raise exception 'Only a manager or the owner can publish the roster' using errcode = 'insufficient_privilege';
  end if;
  select * into week from roster_weeks where id = week_id for update;
  if not found then
    raise exception 'Roster week not found' using errcode = 'invalid_parameter_value';
  end if;
  update roster_weeks
  set published_at = now(), published_by = auth.uid(), changed_at = null
  where id = week_id;
  return jsonb_build_object('republished', week.published_at is not null);
end;
$$;

-- "Copy last week": every shift from the same site's previous week, a week
-- later. Shifts that would overlap one the person already has (at any
-- site), or for someone whose account is turned off, are skipped. Safe to
-- run twice: the second run skips everything.
create or replace function copy_roster_week(site uuid, monday date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  target_id uuid;
  s roster_shifts%rowtype;
  copied integer := 0;
  skipped integer := 0;
begin
  target_id := ensure_roster_week(site, monday); -- checks the role and the Monday
  for s in
    select rs.* from roster_shifts rs
    join roster_weeks w on w.id = rs.roster_week_id
    where w.site_id = site and w.week_start = monday - 7
    order by rs.work_date, rs.start_time
  loop
    begin
      insert into roster_shifts (roster_week_id, staff_id, work_date, start_time, finish_time, position, note)
      values (target_id, s.staff_id, s.work_date + 7, s.start_time, s.finish_time, s.position, s.note);
      copied := copied + 1;
    exception
      when exclusion_violation or check_violation then
        skipped := skipped + 1;
    end;
  end loop;
  return jsonb_build_object('week_id', target_id, 'copied', copied, 'skipped', skipped);
end;
$$;

-- Warnings for a week (they never block saving):
--   leave:      the person has approved leave that day;
--   over_hours: the person has more than 40 paid hours rostered that week,
--               counting every site (web/lib/roster.ts has the same 40,
--               OVER_HOURS_LIMIT; its test reads this line).
create or replace function roster_warnings(week_id uuid)
returns table (kind text, staff_id uuid, staff_name text, work_date date, shift_id uuid, paid_minutes integer)
language plpgsql stable security definer set search_path = public as $$
declare
  week roster_weeks%rowtype;
  over_hours_limit constant integer := 40;
begin
  if not is_manager() then
    raise exception 'Only a manager or the owner can see roster warnings' using errcode = 'insufficient_privilege';
  end if;
  select * into week from roster_weeks where id = week_id;
  if not found then
    return;
  end if;

  return query
    select 'leave'::text, rs.staff_id, st.name, rs.work_date, rs.id, rs.paid_minutes
    from roster_shifts rs
    join staff st on st.id = rs.staff_id
    where rs.roster_week_id = week_id
      and exists (
        select 1 from leave_requests l
        where l.staff_id = rs.staff_id
          and l.status = 'approved'
          and rs.work_date between l.start_date and l.end_date
      );

  return query
    select 'over_hours'::text, rs.staff_id, st.name, null::date, null::uuid, sum(rs.paid_minutes)::integer
    from roster_shifts rs
    join staff st on st.id = rs.staff_id
    where rs.work_date between week.week_start and week.week_start + 6
      and rs.staff_id in (select x.staff_id from roster_shifts x where x.roster_week_id = week_id)
    group by rs.staff_id, st.name
    having sum(rs.paid_minutes) > over_hours_limit * 60;
end;
$$;

-- "Who's on with me": for each of YOUR shifts in published weeks between
-- the two dates, the other people rostered at the same site that day.
-- Names and times only. security definer because staff can't otherwise read
-- their colleagues' shifts or names. At most about two months at a time.
create or replace function roster_coworkers(from_date date, to_date date)
returns table (my_shift_id uuid, name text, start_time time, finish_time time)
language sql stable security definer set search_path = public as $$
  select mine.id, st.name, other.start_time, other.finish_time
  from roster_shifts mine
  join roster_weeks w on w.id = mine.roster_week_id and w.published_at is not null
  join roster_shifts other
    on other.roster_week_id = mine.roster_week_id
   and other.work_date = mine.work_date
   and other.id <> mine.id
  join staff st on st.id = other.staff_id and st.active
  where is_active()
    and mine.staff_id = auth.uid()
    and mine.work_date between from_date and to_date
    and to_date - from_date <= 62
  order by mine.id, other.start_at;
$$;

revoke execute on function ensure_roster_week(uuid, date) from public, anon;
revoke execute on function publish_roster_week(uuid) from public, anon;
revoke execute on function copy_roster_week(uuid, date) from public, anon;
revoke execute on function roster_warnings(uuid) from public, anon;
revoke execute on function roster_coworkers(date, date) from public, anon;
grant execute on function ensure_roster_week(uuid, date) to authenticated;
grant execute on function publish_roster_week(uuid) to authenticated;
grant execute on function copy_roster_week(uuid, date) to authenticated;
grant execute on function roster_warnings(uuid) to authenticated;
grant execute on function roster_coworkers(date, date) to authenticated;

-- 7. Project rules ------------------------------------------------------------------------

select enable_audit('roster_weeks');
select enable_audit('roster_shifts');
select enable_active_only('roster_weeks');
select enable_active_only('roster_shifts');

-- Nobody can be rostered while their account is turned off (also when a
-- shift is handed to someone else). "active_staff_only" sorts before
-- "roster_shifts_before_write", so its clear message comes first.
create trigger active_staff_only before insert or update of staff_id on roster_shifts
  for each row execute function active_staff_only('staff_id', 'shifts on the roster');
create trigger active_staff_only before insert on roster_weeks
  for each row execute function active_staff_only('created_by', 'roster weeks');
