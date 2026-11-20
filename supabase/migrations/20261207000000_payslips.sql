-- Payslips in the app. The owner uploads a pay run's PDFs (from Crystal
-- Payroll), checks who each one is for and publishes them; each person sees
-- only their own.
--
--   1. staff.payroll_code: the person's code in Crystal Payroll (optional,
--      unique ignoring case). Used to match PDF file names to people. Only
--      the owner sets it, through set_staff_payroll_code().
--   2. payslips: one row per PDF. Uploaded rows are drafts until the owner
--      publishes them. source is 'upload' now; 'email' is for a later
--      inbound-email webhook (web/lib/payslips-ingest.ts, ingestPayslip).
--   3. Payslips are never edited or deleted. A mistake is fixed by
--      withdrawing it (withdrawn_at, reason) and uploading a corrected one.
--      Triggers enforce this for everyone, even the SQL editor.
--   4. Who sees what: you see your own payslips once published and not
--      withdrawn (managers too). Only the owner sees all, uploads, publishes
--      and withdraws.
--   5. publish_payslips(), withdraw_payslip(), mark_payslip_viewed().
--   6. A private "payslips" bucket (PDF only, 2 MB). Paths are
--      {staff_id}/{pay_date}-{uuid}.pdf. The owner uploads and reads all;
--      you can read only the file of your own published payslip.
--   7. A "Payslips" switch in notification settings.
--   8. The project rules: enable_audit, enable_active_only, active_staff_only.

-- 1. Payroll codes ------------------------------------------------------------------------

alter table staff
  add column payroll_code text
    constraint staff_payroll_code_format check (payroll_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$');

-- "e012" and "E012" are the same code.
create unique index staff_payroll_code_unique on staff (upper(payroll_code)) where payroll_code is not null;

comment on column staff.payroll_code is
  'The person''s employee code in Crystal Payroll. Payslip PDFs are matched to people by it. '
  'Only set_staff_payroll_code changes it.';

-- staff has no update grant (staff accounts migration), so this is the only
-- way in. An empty code clears it.
create or replace function set_staff_payroll_code(target_id uuid, code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  clean text := nullif(btrim(coalesce(code, '')), '');
  holder text;
begin
  if not is_owner() then
    raise exception 'Only the owner can change payroll codes' using errcode = 'insufficient_privilege';
  end if;
  if clean is not null and clean !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$' then
    raise exception 'A payroll code is up to 20 letters, numbers, - or _'
      using errcode = 'invalid_parameter_value';
  end if;
  if clean is not null then
    select name into holder from staff
    where upper(payroll_code) = upper(clean) and id <> target_id;
    if found then
      raise exception '% already has payroll code %', holder, clean using errcode = 'check_violation';
    end if;
  end if;

  update staff set payroll_code = clean where id = target_id;
  if not found then
    raise exception 'Staff member not found' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

revoke execute on function set_staff_payroll_code(uuid, text) from public, anon;
grant execute on function set_staff_payroll_code(uuid, text) to authenticated;

-- 2. Table ---------------------------------------------------------------------------------

create table payslips (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id),
  pay_date date not null,
  period_start date not null,
  period_end date not null,
  -- {staff_id}/{pay_date}-{uuid}.pdf in the "payslips" bucket.
  file_path text not null unique,
  source text not null default 'upload' check (source in ('upload', 'email')),
  -- Who uploaded it. Empty only for the email source (no person behind it).
  uploaded_by uuid references staff (id) default auth.uid(),
  uploaded_at timestamptz not null default now(),
  -- null = a draft, only the owner sees it.
  published_at timestamptz,
  -- The first time the person opened it.
  viewed_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by uuid references staff (id),
  withdrawn_reason text,

  constraint payslips_period_order check (period_end >= period_start),
  constraint payslips_period_length check (period_end - period_start <= 31),
  constraint payslips_uploader check (source = 'email' or uploaded_by is not null),
  constraint payslips_viewed_after_publish check (viewed_at is null or published_at is not null),
  constraint payslips_withdrawn_reason check (
    (withdrawn_at is null and withdrawn_reason is null and withdrawn_by is null)
    or (withdrawn_at is not null and length(btrim(withdrawn_reason)) between 1 and 300)
  )
);

-- One live payslip per person per pay run. Withdraw the old one to replace it.
create unique index payslips_one_live_per_run
  on payslips (staff_id, pay_date, period_start, period_end)
  where withdrawn_at is null;

create index payslips_pay_date on payslips (pay_date desc);
create index payslips_staff on payslips (staff_id, pay_date desc);

comment on table payslips is
  'Payslip PDFs. Drafts until published. Never edited or deleted: withdraw and upload a corrected one.';

-- 3. Never edited, never deleted -------------------------------------------------------------

-- Is there a file at this path in the payslips bucket? security definer:
-- reads storage.objects whatever its policies say.
create or replace function payslip_file_exists(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from storage.objects where bucket_id = 'payslips' and name = path);
$$;

revoke execute on function payslip_file_exists(text) from public, anon, authenticated;

create or replace function payslips_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- The file goes up first, then the row. The path must name this person
  -- and pay date, so a payslip can never point at someone else's file.
  if new.file_path !~ (
       '^' || new.staff_id::text || '/' || to_char(new.pay_date, 'YYYY-MM-DD')
       || '-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
     ) then
    raise exception 'The file path must be {staff_id}/{pay_date}-{uuid}.pdf' using errcode = 'check_violation';
  end if;
  if not payslip_file_exists(new.file_path) then
    raise exception 'Upload the PDF before saving the payslip' using errcode = 'check_violation';
  end if;
  -- New rows are always drafts.
  if new.published_at is not null or new.viewed_at is not null or new.withdrawn_at is not null then
    raise exception 'A new payslip starts as a draft' using errcode = 'check_violation';
  end if;
  new.uploaded_at := now();
  return new;
end;
$$;

create trigger payslips_before_insert
  before insert on payslips
  for each row execute function payslips_before_insert();

-- Only three things ever happen to a payslip, each once: published, viewed,
-- withdrawn. Everything else is fixed for good.
create or replace function payslips_before_update() returns trigger
language plpgsql as $$
begin
  if (new.id, new.staff_id, new.pay_date, new.period_start, new.period_end, new.file_path,
      new.source, new.uploaded_by, new.uploaded_at)
     is distinct from
     (old.id, old.staff_id, old.pay_date, old.period_start, old.period_end, old.file_path,
      old.source, old.uploaded_by, old.uploaded_at) then
    raise exception 'A payslip can''t be changed. Withdraw it and upload a corrected one.'
      using errcode = 'insufficient_privilege';
  end if;
  if old.published_at is not null and new.published_at is distinct from old.published_at then
    raise exception 'This payslip is already published' using errcode = 'insufficient_privilege';
  end if;
  if old.viewed_at is not null and new.viewed_at is distinct from old.viewed_at then
    raise exception 'The first view is already recorded' using errcode = 'insufficient_privilege';
  end if;
  if old.withdrawn_at is not null
     and (new.withdrawn_at, new.withdrawn_by, new.withdrawn_reason)
         is distinct from (old.withdrawn_at, old.withdrawn_by, old.withdrawn_reason) then
    raise exception 'This payslip is already withdrawn' using errcode = 'insufficient_privilege';
  end if;
  if old.withdrawn_at is not null and old.published_at is null and new.published_at is not null then
    raise exception 'A withdrawn payslip can''t be published' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger payslips_before_update
  before update on payslips
  for each row execute function payslips_before_update();

create or replace function payslips_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Payslips are never deleted. Withdraw it instead.' using errcode = 'insufficient_privilege';
end;
$$;

create trigger payslips_no_delete
  before delete on payslips
  for each row execute function payslips_no_delete();

create trigger payslips_no_truncate
  before truncate on payslips
  for each statement execute function payslips_no_delete();

revoke execute on function payslips_before_insert() from public, anon, authenticated;
revoke execute on function payslips_before_update() from public, anon, authenticated;
revoke execute on function payslips_no_delete() from public, anon, authenticated;

-- 4. Grants and RLS -------------------------------------------------------------------------

alter table payslips enable row level security;

-- Read: RLS below. Add: the owner, these columns only (uploaded_by and
-- uploaded_at fill themselves; published, viewed and withdrawn start empty).
-- Change: only through the functions below. Delete: never.
revoke all on payslips from anon, authenticated;
grant select on payslips to authenticated;
grant insert (staff_id, pay_date, period_start, period_end, file_path, source) on payslips to authenticated;

create policy "own published payslips, owner sees all" on payslips
  for select to authenticated
  using (
    is_owner()
    or (staff_id = auth.uid() and published_at is not null and withdrawn_at is null)
  );

create policy "owner uploads payslips" on payslips
  for insert to authenticated
  with check (is_owner() and source = 'upload' and uploaded_by = auth.uid());

-- 5. Functions -------------------------------------------------------------------------------

-- Publish drafts. Already published or withdrawn ones are skipped. Returns
-- what was published, so the app can notify those people.
create or replace function publish_payslips(payslip_ids uuid[])
returns table (id uuid, staff_id uuid, period_start date, period_end date)
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then
    raise exception 'Only the owner can publish payslips' using errcode = 'insufficient_privilege';
  end if;
  return query
    update payslips p
    set published_at = now()
    where p.id = any(payslip_ids) and p.published_at is null and p.withdrawn_at is null
    returning p.id, p.staff_id, p.period_start, p.period_end;
end;
$$;

-- Hide a payslip from the person (published or not). The row and the file
-- stay, with who withdrew it, when and why.
create or replace function withdraw_payslip(payslip_id uuid, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  clean text := btrim(coalesce(reason, ''));
  p payslips%rowtype;
begin
  if not is_owner() then
    raise exception 'Only the owner can withdraw payslips' using errcode = 'insufficient_privilege';
  end if;
  if clean = '' or length(clean) > 300 then
    raise exception 'Say why it''s withdrawn (up to 300 characters)' using errcode = 'invalid_parameter_value';
  end if;
  select * into p from payslips where payslips.id = payslip_id for update;
  if not found then
    raise exception 'Payslip not found' using errcode = 'invalid_parameter_value';
  end if;
  if p.withdrawn_at is not null then
    raise exception 'This payslip is already withdrawn' using errcode = 'check_violation';
  end if;
  update payslips
  set withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_reason = clean
  where payslips.id = payslip_id;
end;
$$;

-- The person opened their payslip: stamp the first time. Anything else (not
-- yours, not published, withdrawn, already viewed) quietly does nothing, so
-- the owner opening someone's payslip never counts as them seeing it.
create or replace function mark_payslip_viewed(payslip_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_active() then
    raise exception 'Your account is turned off' using errcode = 'insufficient_privilege';
  end if;
  update payslips
  set viewed_at = now()
  where payslips.id = payslip_id
    and staff_id = auth.uid()
    and published_at is not null
    and withdrawn_at is null
    and viewed_at is null;
end;
$$;

revoke execute on function publish_payslips(uuid[]) from public, anon;
revoke execute on function withdraw_payslip(uuid, text) from public, anon;
revoke execute on function mark_payslip_viewed(uuid) from public, anon;
grant execute on function publish_payslips(uuid[]) to authenticated;
grant execute on function withdraw_payslip(uuid, text) to authenticated;
grant execute on function mark_payslip_viewed(uuid) to authenticated;

-- 6. Storage ------------------------------------------------------------------------------------

-- Also in supabase/config.toml (local). Created here too, so the hosted
-- project gets it from `supabase db push`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payslips', 'payslips', false, 2097152, array['application/pdf'])
on conflict (id) do nothing;

-- The owner reads every file; anyone else only the file of their own
-- published, not withdrawn payslip (that's what a signed link needs).
create policy "payslips: owner or own published" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payslips'
    and (
      is_owner()
      or exists (
        select 1 from public.payslips p
        where p.file_path = name
          and p.staff_id = auth.uid()
          and p.published_at is not null
          and p.withdrawn_at is null
      )
    )
  );

-- Only the owner uploads, and only to {uuid}/{yyyy-mm-dd}-{uuid}.pdf. No
-- update or delete policies: a stored payslip can't be replaced or removed
-- through the API.
create policy "payslips: owner uploads" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payslips'
    and is_owner()
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
  );

-- 7. Notification switch -------------------------------------------------------------------------

alter table notification_prefs add column payslips boolean not null default true;
grant insert (payslips) on notification_prefs to authenticated;
grant update (payslips) on notification_prefs to authenticated;

-- 8. Project rules ----------------------------------------------------------------------------------

select enable_audit('payslips');
select enable_active_only('payslips');

-- Trigger names sort before payslips_before_insert, so these messages come first.
create trigger active_staff_only before insert on payslips
  for each row execute function active_staff_only('staff_id', 'payslips');
create trigger active_staff_only_uploader before insert on payslips
  for each row execute function active_staff_only('uploaded_by', 'payslips');
