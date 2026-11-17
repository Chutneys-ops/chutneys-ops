-- Slice 2: opening checklist
--   1. "Today" means the Auckland date, not the UTC date.
--   2. Staff can start runs and tick items, only for sites they can see.
--   3. A run locks once it is submitted.

-- 1. Auckland date ---------------------------------------------------------

-- The database clock runs in UTC, so current_date is "yesterday" until
-- noon or 1 pm in Auckland. Use this function wherever we mean "today".
create or replace function today_nz() returns date
language sql stable as $$
  select (now() at time zone 'Pacific/Auckland')::date;
$$;

alter table checklist_runs alter column run_date set default today_nz();

-- One label per kind and checklist, so seed.sql can be re-run safely
-- with "on conflict do nothing".
alter table checklist_items
  add constraint checklist_items_kind_checklist_label_key
  unique (site_kind, checklist, label);

-- 2. Column permissions ----------------------------------------------------

-- RLS decides which ROWS you can write. GRANTs decide which COLUMNS.
-- Users may only write these columns. Everything else (id, run_date,
-- ticked_at, submitted_at) comes from defaults or the trigger below,
-- so nobody can backdate a tick or start a run for another day.
revoke insert, update on checklist_runs from anon, authenticated;
grant insert (site_id, checklist) on checklist_runs to authenticated;
grant update (submitted_by) on checklist_runs to authenticated;

revoke insert, update on checklist_ticks from anon, authenticated;
grant insert (run_id, item_id, ticked_by, photo_url) on checklist_ticks to authenticated;

-- 3. Write policies --------------------------------------------------------

-- Start today's run for a site you work at.
create policy "start runs at own sites" on checklist_runs
  for insert to authenticated
  with check (can_see_site(site_id) and run_date = today_nz());

-- Submit: "using" picks which rows you may change (today's open runs at
-- your sites); "with check" says what the row must look like afterwards
-- (submitted by you). Once submitted_at is set, "using" no longer matches,
-- so the run is locked.
create policy "submit open runs at own sites" on checklist_runs
  for update to authenticated
  using (can_see_site(site_id) and run_date = today_nz() and submitted_at is null)
  with check (can_see_site(site_id) and submitted_by = auth.uid());

-- Tick: as yourself, on today's open run at your site, and only items that
-- belong to that site's kind and checklist.
create policy "tick items on open runs" on checklist_ticks
  for insert to authenticated
  with check (
    ticked_by = auth.uid()
    and exists (
      select 1
      from checklist_runs r
      join sites s on s.id = r.site_id
      join checklist_items i on i.site_kind = s.kind and i.checklist = r.checklist
      where r.id = checklist_ticks.run_id
        and i.id = checklist_ticks.item_id
        and r.run_date = today_nz()
        and r.submitted_at is null
        and can_see_site(r.site_id)
    )
  );

-- Untick: anyone at the site, while the run is still open.
create policy "untick items on open runs" on checklist_ticks
  for delete to authenticated
  using (
    exists (
      select 1
      from checklist_runs r
      where r.id = checklist_ticks.run_id
        and r.run_date = today_nz()
        and r.submitted_at is null
        and can_see_site(r.site_id)
    )
  );

-- No update policy on checklist_ticks: a tick can be removed, not edited.

-- 4. Submit trigger --------------------------------------------------------

-- When submitted_by is first set: refuse if any item is unticked, and stamp
-- submitted_at with the database time (the client can't choose it).
create or replace function checklist_runs_on_submit() returns trigger
language plpgsql as $$
declare
  missing int;
begin
  if old.submitted_by is null and new.submitted_by is not null then
    select count(*) into missing
    from checklist_items i
    join sites s on s.kind = i.site_kind
    where s.id = new.site_id
      and i.checklist = new.checklist
      and not exists (
        select 1 from checklist_ticks t
        where t.run_id = new.id and t.item_id = i.id
      );

    if missing > 0 then
      raise exception 'Cannot submit: % item(s) not ticked', missing
        using errcode = 'check_violation';
    end if;

    new.submitted_at := now();
  end if;
  return new;
end;
$$;

create trigger checklist_runs_submit
  before update on checklist_runs
  for each row execute function checklist_runs_on_submit();

-- 5. Coworker names --------------------------------------------------------

-- Staff could only read their own staff row, so "ticked by Ana" showed
-- nothing. Let them read the names of people who share a site with them.
-- security definer: staff_sites RLS hides other people's links, so this
-- function reads it with the owner's rights (same pattern as can_see_site).
create or replace function shares_site_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from staff_sites mine
    join staff_sites theirs on theirs.site_id = mine.site_id
    where mine.staff_id = auth.uid() and theirs.staff_id = other
  );
$$;

create policy "see coworkers" on staff
  for select using (shares_site_with(id));
