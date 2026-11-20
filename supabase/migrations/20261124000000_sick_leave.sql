-- Slice 7: sick leave, with the food safety exclusion for vomiting or diarrhoea.
--
--   1. leave_requests: staff ask for sick leave in hours (the Employment
--      Leave Act 2026 moves leave to hours), with an optional certificate.
--   2. Column grants: staff can't set the status, decision or clearance.
--   3. RLS: your own requests; managers and the owner see all.
--   4. decide_leave: managers and the owner approve or decline (final),
--      never their own (except the owner).
--   5. Food safety: someone with vomiting or diarrhoea (gi_symptoms) can't
--      clock in until a manager clears them (MPI: 48 hours symptom-free).
--      Reporting it while clocked in clocks you out.
--   6. Storage policies for the private "leave-documents" bucket (the bucket
--      is in supabase/config.toml).

-- 1. Table -----------------------------------------------------------------------

create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null default auth.uid() references staff (id),
  reason text not null check (reason in ('sick', 'injured', 'caring_for_dependant')),
  start_date date not null,
  end_date date not null,
  hours numeric(5,2) not null check (hours > 0),
  -- Short on purpose: the form says no medical details are needed.
  note text check (length(note) <= 300),
  certificate_path text,
  -- Vomiting or diarrhoea: excluded from food handling until cleared.
  gi_symptoms boolean not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references staff (id),
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 300),
  cleared_to_work_at timestamptz,
  cleared_by uuid references staff (id),
  created_at timestamptz not null default now(),
  constraint leave_dates_in_order check (end_date >= start_date),
  constraint leave_decided_together check (
    (status = 'pending') = (decided_by is null) and (decided_by is null) = (decided_at is null)
  ),
  constraint leave_cleared_together check ((cleared_to_work_at is null) = (cleared_by is null)),
  constraint leave_clear_only_gi check (cleared_to_work_at is null or gi_symptoms)
);

create index leave_requests_staff on leave_requests (staff_id, start_date);
create index leave_requests_pending on leave_requests (created_at) where status = 'pending';
-- start_shift checks this on every clock-in.
create index leave_requests_uncleared_gi on leave_requests (staff_id)
  where gi_symptoms and cleared_to_work_at is null;

-- 2. Grants ------------------------------------------------------------------------

alter table leave_requests enable row level security;
revoke all on leave_requests from anon, authenticated;
grant select on leave_requests to authenticated;
grant insert (reason, start_date, end_date, hours, note, certificate_path, gi_symptoms)
  on leave_requests to authenticated;

-- 3. Helpers and RLS -----------------------------------------------------------------

-- The certificate is in your own folder of "leave-documents" and you
-- uploaded it. security definer: reads storage.objects directly.
create or replace function leave_document_belongs(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select split_part(path, '/', 1) = auth.uid()::text
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'leave-documents'
        and o.name = path
        and o.owner_id = auth.uid()::text
    );
$$;

create or replace function leave_document_in_use(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from leave_requests where certificate_path = path);
$$;

-- Have YOU reported vomiting or diarrhoea and not been cleared yet?
-- No "person" argument on purpose: anyone can call a function, and whether a
-- colleague is ill is health information.
create or replace function needs_clearance() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from leave_requests
    where staff_id = auth.uid() and gi_symptoms and cleared_to_work_at is null
  );
$$;

create policy "own leave or manager" on leave_requests
  for select using (staff_id = auth.uid() or is_manager());

create policy "request own leave" on leave_requests
  for insert to authenticated
  with check (
    staff_id = auth.uid()
    and (certificate_path is null or leave_document_belongs(certificate_path))
  );

-- 4. Decisions -------------------------------------------------------------------------

-- new_hours: the hours to approve (a manager can adjust them); null keeps
-- what was asked for. A decline needs a note saying why.
create or replace function decide_leave(request_id uuid, new_status text, new_hours numeric, note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r leave_requests%rowtype;
begin
  if not is_manager() then
    raise exception 'Only a manager or the owner can decide leave' using errcode = 'insufficient_privilege';
  end if;
  if new_status not in ('approved', 'declined') then
    raise exception 'Approve or decline' using errcode = 'invalid_parameter_value';
  end if;

  select * into r from leave_requests where id = request_id for update;
  if not found then
    raise exception 'Leave request not found' using errcode = 'invalid_parameter_value';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been decided' using errcode = 'check_violation';
  end if;
  if r.staff_id = auth.uid() and not is_owner() then
    raise exception 'Someone else has to decide your own leave' using errcode = 'insufficient_privilege';
  end if;
  if new_hours is not null and (new_hours <= 0 or new_hours > 999.99) then
    raise exception 'Hours must be more than 0' using errcode = 'check_violation';
  end if;
  -- "decide_leave.note": the parameter, not the leave_requests.note column.
  if new_status = 'declined' and coalesce(btrim(decide_leave.note), '') = '' then
    raise exception 'Say why the leave is declined' using errcode = 'check_violation';
  end if;

  update leave_requests
  set status = new_status,
      hours = case when new_status = 'approved' then coalesce(new_hours, r.hours) else r.hours end,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = nullif(btrim(decide_leave.note), '')
  where id = r.id;
end;
$$;

revoke execute on function decide_leave(uuid, text, numeric, text) from public, anon;
grant execute on function decide_leave(uuid, text, numeric, text) to authenticated;

-- 5. Food safety exclusion ----------------------------------------------------------------

-- A manager confirms the person can handle food again (MPI: 48 hours after
-- symptoms stop). Independent of approving the leave: a declined request
-- still excludes them until cleared.
create or replace function clear_to_work(request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r leave_requests%rowtype;
begin
  if not is_manager() then
    raise exception 'Only a manager or the owner can clear someone to work' using errcode = 'insufficient_privilege';
  end if;
  select * into r from leave_requests where id = request_id for update;
  if not found then
    raise exception 'Leave request not found' using errcode = 'invalid_parameter_value';
  end if;
  if not r.gi_symptoms then
    raise exception 'Only vomiting or diarrhoea needs clearing' using errcode = 'check_violation';
  end if;
  if r.cleared_to_work_at is not null then
    raise exception 'Already cleared' using errcode = 'check_violation';
  end if;
  if r.staff_id = auth.uid() and not is_owner() then
    raise exception 'Someone else has to clear you' using errcode = 'insufficient_privilege';
  end if;

  update leave_requests set cleared_to_work_at = now(), cleared_by = auth.uid() where id = r.id;
end;
$$;

revoke execute on function clear_to_work(uuid) from public, anon;
grant execute on function clear_to_work(uuid) to authenticated;

-- Reporting vomiting or diarrhoea while clocked in clocks you out, so you
-- stop handling food now, not at the end of the shift.
create or replace function leave_requests_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  current_shift shifts%rowtype;
begin
  if new.gi_symptoms then
    select * into current_shift from shifts where staff_id = new.staff_id and clock_out is null;
    if found then
      if current_shift.clock_in <= stale_shift_cutoff() then
        perform close_stale_shift(current_shift.id);
      else
        update shifts set clock_out = now() where id = current_shift.id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger leave_requests_after_insert
  after insert on leave_requests
  for each row execute function leave_requests_after_insert();

-- start_shift from the pin lockout migration, plus the exclusion check.
create or replace function start_shift(site_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  current_shift shifts%rowtype;
  new_id uuid;
begin
  if not exists (select 1 from staff where id = auth.uid()) then
    raise exception 'Only staff can clock in' using errcode = 'insufficient_privilege';
  end if;
  -- Food safety: vomiting or diarrhoea reported and not cleared yet.
  if needs_clearance() then
    raise exception 'Your manager needs to clear you to return to work after illness'
      using errcode = 'insufficient_privilege', hint = 'needs_clearance';
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

-- 6. Certificate storage --------------------------------------------------------------------

-- Paths are {staff_id}/{uuid}.{ext}: your own folder only.
create policy "leave documents: upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'leave-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "leave documents: read own or manager" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'leave-documents'
    and (owner_id = auth.uid()::text or is_manager())
  );

-- Only to clean up after a failed save.
create policy "leave documents: delete own unused" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'leave-documents'
    and owner_id = auth.uid()::text
    and not leave_document_in_use(name)
  );
