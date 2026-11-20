-- Slice 8: staff training records (MPI food control plan: who was trained
-- in what, when, by whom, signed by both).
--
--   1. training_records: a manager or the owner records training they gave.
--      Their login is their signature (trainer_signed_at = now()).
--   2. The trainee confirms on their own login with confirm_training, with an
--      optional drawn signature. After that the record is locked.
--   3. RLS: staff see records where they are the trainee (or trainer);
--      managers and the owner see all.
--   4. Storage policies for the private "signatures" bucket (the bucket is in
--      supabase/config.toml).

-- 1. Table -----------------------------------------------------------------------

create table training_records (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (topic in (
    'food_safety_basics', 'handwashing_and_hygiene', 'allergens', 'cleaning',
    'temperature_control', 'cooking_cooling_reheating', 'batter_fermentation',
    'induction', 'other'
  )),
  topic_detail text check (length(topic_detail) <= 200),
  trainee_id uuid not null references staff (id),
  trainer_id uuid not null default auth.uid() references staff (id),
  trained_on date not null default today_nz(),
  trainer_signed_at timestamptz not null default now(),
  trainee_signed_at timestamptz,
  trainee_signature_path text,
  notes text check (length(notes) <= 500),
  constraint training_other_needs_detail
    check (topic <> 'other' or btrim(coalesce(topic_detail, '')) <> ''),
  constraint training_not_self check (trainee_id <> trainer_id),
  constraint training_signature_needs_confirm
    check (trainee_signature_path is null or trainee_signed_at is not null)
);

create index training_records_trainee on training_records (trainee_id, topic, trained_on);

-- 2. Grants --------------------------------------------------------------------------

alter table training_records enable row level security;
revoke all on training_records from anon, authenticated;
grant select on training_records to authenticated;
-- trainer_id defaults to you and trainer_signed_at to now(); the trainee's
-- columns are only set by confirm_training. No update or delete grants.
grant insert (topic, topic_detail, trainee_id, trained_on, notes) on training_records to authenticated;

-- 3. RLS ------------------------------------------------------------------------------

create policy "own training or manager" on training_records
  for select using (trainee_id = auth.uid() or trainer_id = auth.uid() or is_manager());

create policy "managers record training they gave" on training_records
  for insert to authenticated
  with check (
    is_manager()
    and trainer_id = auth.uid()
    and trained_on <= today_nz()
  );

-- Belt and braces: even code that bypasses the grants (security definer
-- functions, the SQL editor) can only add the trainee's signature, once.
create or replace function training_records_lock() returns trigger
language plpgsql as $$
begin
  if old.trainee_signed_at is not null then
    raise exception 'This training record is signed by both and can''t be changed'
      using errcode = 'insufficient_privilege';
  end if;
  if (new.topic, new.topic_detail, new.trainee_id, new.trainer_id, new.trained_on,
      new.trainer_signed_at, new.notes)
     is distinct from
     (old.topic, old.topic_detail, old.trainee_id, old.trainer_id, old.trained_on,
      old.trainer_signed_at, old.notes) then
    raise exception 'Only the trainee''s confirmation can be added to a training record'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger training_records_lock
  before update on training_records
  for each row execute function training_records_lock();

-- The drawn signature is in your own folder of "signatures" and you uploaded it.
create or replace function signature_belongs(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select split_part(path, '/', 1) = auth.uid()::text
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'signatures'
        and o.name = path
        and o.owner_id = auth.uid()::text
    );
$$;

create or replace function signature_in_use(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from training_records where trainee_signature_path = path);
$$;

-- The trainee confirms. Already confirmed: does nothing (a double tap is fine).
create or replace function confirm_training(record_id uuid, signature_path text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r training_records%rowtype;
begin
  select * into r from training_records where id = record_id for update;
  if not found or r.trainee_id <> auth.uid() then
    raise exception 'You can only confirm your own training' using errcode = 'insufficient_privilege';
  end if;
  if r.trainee_signed_at is not null then
    return;
  end if;
  if signature_path is not null and not signature_belongs(signature_path) then
    raise exception 'That signature isn''t yours' using errcode = 'insufficient_privilege';
  end if;

  update training_records
  set trainee_signed_at = now(), trainee_signature_path = signature_path
  where id = r.id;
end;
$$;

revoke execute on function confirm_training(uuid, text) from public, anon;
grant execute on function confirm_training(uuid, text) to authenticated;

-- 4. Signature storage ------------------------------------------------------------------

-- Paths are {staff_id}/{uuid}.png: your own folder only.
create policy "signatures: upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'signatures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "signatures: read own or manager" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'signatures'
    and (owner_id = auth.uid()::text or is_manager())
  );

create policy "signatures: delete own unused" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'signatures'
    and owner_id = auth.uid()::text
    and not signature_in_use(name)
  );
