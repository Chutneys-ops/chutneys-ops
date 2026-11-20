-- Slice 5: notice board. Managers and the owner post announcements; staff
-- read them, and confirm "I've read and understood this" on important ones.
--
--   1. notices: title, body, audience (everyone, or a list of sites),
--      pinned, needs_ack, optional expiry. Edited and archived, never deleted.
--   2. notice_reads: one row per person per notice. read_at when they opened
--      it; acknowledged_at when they confirmed it. Acknowledging is final.
--   3. my_recent_site_ids(): the sites you chose in the last 30 days. A site
--      notice reaches staff who worked there recently, wherever they are today.
--   4. RLS: staff see live notices for everyone or for their recent sites;
--      managers and the owner see everything (archived and expired too).
--   5. Triggers: edited_at stamping, archive is final, acknowledgement is
--      final, nobody deletes.
--   6. The project rules: enable_audit, enable_active_only, active_staff_only.

-- 1. Notices ------------------------------------------------------------------------

create table notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  -- null = everyone. Otherwise the sites it is for (at least one).
  site_ids uuid[],
  pinned boolean not null default false,
  needs_ack boolean not null default false,
  posted_by uuid not null default auth.uid() references staff (id),
  posted_at timestamptz not null default now(),
  expires_at timestamptz,
  edited_at timestamptz,
  archived_at timestamptz,
  constraint notices_title_length check (btrim(title) <> '' and length(title) <= 120),
  constraint notices_body_length check (btrim(body) <> '' and length(body) <= 2000),
  constraint notices_sites_not_empty check (site_ids is null or cardinality(site_ids) > 0),
  constraint notices_expires_after_posting check (expires_at is null or expires_at > posted_at)
);

create index notices_posted_at on notices (posted_at desc);

-- 2. Reads --------------------------------------------------------------------------

create table notice_reads (
  notice_id uuid not null references notices (id),
  staff_id uuid not null default auth.uid() references staff (id),
  read_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  primary key (notice_id, staff_id)
);

-- 3. Helper ---------------------------------------------------------------------------

-- The sites you chose ("Choose site") in the last 30 days. security definer
-- like the other helpers, so the notices policy doesn't depend on the
-- shifts policies. web/lib/notices.ts has the same 30 (RECENT_SITE_DAYS) for
-- the managers' "Read by 12 of 18"; its test reads this line, so change both.
create or replace function my_recent_site_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct site_id), '{}')
  from shifts
  where is_active()
    and staff_id = auth.uid()
    and clock_in > now() - interval '30 days';
$$;

revoke execute on function my_recent_site_ids() from public, anon;
grant execute on function my_recent_site_ids() to authenticated;

-- 4. Grants and RLS -------------------------------------------------------------------

alter table notices enable row level security;
alter table notice_reads enable row level security;

-- Only these columns can be sent. posted_by defaults to you and posted_at to
-- now(); edited_at is stamped by the trigger below. No delete grant at all.
revoke all on notices from anon, authenticated;
grant select on notices to authenticated;
grant insert (title, body, site_ids, pinned, needs_ack, expires_at) on notices to authenticated;
grant update (title, body, site_ids, pinned, needs_ack, expires_at, archived_at) on notices to authenticated;

-- Staff: live notices for everyone or for a site they chose recently.
-- "&&" means "the two arrays share at least one element".
create policy "see notices for you, managers see all" on notices
  for select using (
    is_manager()
    or (
      archived_at is null
      and (expires_at is null or expires_at > now())
      and (site_ids is null or site_ids && my_recent_site_ids())
    )
  );

create policy "managers post notices" on notices
  for insert to authenticated
  with check (is_manager() and posted_by = auth.uid());

-- Any manager can edit or archive any notice (they cover for each other).
create policy "managers edit notices" on notices
  for update to authenticated
  using (is_manager())
  with check (is_manager());

-- Reads: you add only your own (staff_id defaults to you and can't be
-- sent), and only for a notice you can see. The subquery runs under your
-- own RLS, so a notice you can't see doesn't exist for it.
revoke all on notice_reads from anon, authenticated;
grant select on notice_reads to authenticated;
grant insert (notice_id) on notice_reads to authenticated;
grant update (acknowledged_at) on notice_reads to authenticated;

create policy "own reads, managers see all" on notice_reads
  for select using (staff_id = auth.uid() or is_manager());

create policy "mark your own reads" on notice_reads
  for insert to authenticated
  with check (
    staff_id = auth.uid()
    and exists (select 1 from notices n where n.id = notice_reads.notice_id)
  );

create policy "acknowledge your own reads" on notice_reads
  for update to authenticated
  using (staff_id = auth.uid())
  with check (staff_id = auth.uid());

-- 5. Triggers -------------------------------------------------------------------------

-- Every site in site_ids must exist. (An array can't have a foreign key.)
create or replace function notices_check_sites() returns trigger
language plpgsql as $$
begin
  if new.site_ids is not null and exists (
    select 1 from unnest(new.site_ids) as s(id)
    where not exists (select 1 from sites where sites.id = s.id)
  ) then
    raise exception 'One of the chosen sites doesn''t exist' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger notices_check_sites
  before insert or update of site_ids on notices
  for each row execute function notices_check_sites();

-- Updates: archiving is final; a content change stamps edited_at; who
-- posted it and when never change. Runs for everyone, including the SQL
-- editor, like the training lock.
create or replace function notices_before_update() returns trigger
language plpgsql as $$
begin
  if old.archived_at is not null then
    raise exception 'This notice is archived and can''t be changed' using errcode = 'insufficient_privilege';
  end if;
  if new.posted_by is distinct from old.posted_by or new.posted_at is distinct from old.posted_at then
    raise exception 'Who posted a notice, and when, can''t be changed' using errcode = 'insufficient_privilege';
  end if;

  -- Archive time comes from the database clock, not the browser.
  if new.archived_at is not null then
    new.archived_at := now();
  end if;

  if (new.title, new.body, new.site_ids, new.pinned, new.needs_ack, new.expires_at)
     is distinct from
     (old.title, old.body, old.site_ids, old.pinned, old.needs_ack, old.expires_at) then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

create trigger notices_before_update
  before update on notices
  for each row execute function notices_before_update();

-- Reads: only acknowledged_at can change, once, from empty to now().
create or replace function notice_reads_before_update() returns trigger
language plpgsql as $$
begin
  if (new.notice_id, new.staff_id, new.read_at) is distinct from (old.notice_id, old.staff_id, old.read_at) then
    raise exception 'Only the acknowledgement can be added to a read' using errcode = 'insufficient_privilege';
  end if;
  if old.acknowledged_at is not null then
    if new.acknowledged_at is distinct from old.acknowledged_at then
      raise exception 'An acknowledgement can''t be undone or changed' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if new.acknowledged_at is not null then
    if not exists (select 1 from notices where id = new.notice_id and needs_ack) then
      raise exception 'This notice doesn''t ask for acknowledgement' using errcode = 'check_violation';
    end if;
    new.acknowledged_at := now();
  end if;
  return new;
end;
$$;

create trigger notice_reads_before_update
  before update on notice_reads
  for each row execute function notice_reads_before_update();

-- A new read can't arrive already acknowledged (only the update does that).
-- insert has no grant on acknowledged_at; this covers the SQL editor too.
create or replace function notice_reads_before_insert() returns trigger
language plpgsql as $$
begin
  new.read_at := now();
  new.acknowledged_at := null;
  return new;
end;
$$;

create trigger notice_reads_before_insert
  before insert on notice_reads
  for each row execute function notice_reads_before_insert();

-- Nobody deletes, not even from the SQL editor. Archive instead.
create or replace function notices_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Notices and reads are never deleted. Archive the notice instead.'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger notices_no_delete before delete on notices
  for each row execute function notices_no_delete();
create trigger notice_reads_no_delete before delete on notice_reads
  for each row execute function notices_no_delete();

-- 6. Project rules ----------------------------------------------------------------------

select enable_audit('notices');
select enable_audit('notice_reads');
select enable_active_only('notices');
select enable_active_only('notice_reads');

create trigger active_staff_only before insert on notices
  for each row execute function active_staff_only('posted_by', 'notices');
create trigger active_staff_only before insert on notice_reads
  for each row execute function active_staff_only('staff_id', 'notice reads');
