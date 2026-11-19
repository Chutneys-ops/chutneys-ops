-- Slice 6: grocery and supply purchases, with invoice photos for GST.
--
--   1. purchases table: GST worked out by the database, an invoice or a
--      "no receipt" reason on every purchase.
--   2. Column grants: the browser can't set who bought it, when, the GST or
--      the paid-back columns. No update or delete grants: nobody edits or
--      deletes a purchase through the API.
--   3. RLS: add only where you're on shift; staff see their own purchases,
--      managers and the owner see all.
--   4. mark_reimbursed: a manager or the owner marks an own_money purchase
--      as paid back (never their own, except the owner).
--   5. Storage policies for the private "invoices" bucket (the bucket itself
--      is defined in supabase/config.toml).
--
-- Note: money pages (cash-ups, sales) are owner only, but managers see all
-- purchases: they approve and pay back staff spending.

-- 1. Table ----------------------------------------------------------------------

create table purchases (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  purchased_by uuid not null default auth.uid() references staff (id),
  purchased_at timestamptz not null default now(),
  supplier text not null check (btrim(supplier) <> '' and length(supplier) <= 200),
  description text not null check (btrim(description) <> '' and length(description) <= 500),
  total_incl_gst numeric(10,2) not null check (total_incl_gst > 0),
  gst_included boolean not null default true,
  -- NZ GST is 15%, so the GST inside a GST-inclusive total is 3/23 of it.
  -- "generated always ... stored": Postgres works it out on insert, and
  -- nobody can write it.
  gst_amount numeric(10,2) generated always as (
    case when gst_included then round(total_incl_gst * 3 / 23, 2) else 0 end
  ) stored,
  payment_method text not null check (payment_method in ('company_card', 'cash', 'own_money')),
  invoice_path text,
  no_receipt_reason text check (length(no_receipt_reason) <= 500),
  comments text check (length(comments) <= 500),
  reimbursed_at timestamptz,
  reimbursed_by uuid references staff (id),
  -- Every purchase needs proof for GST: the invoice, or why there isn't one.
  constraint purchases_invoice_or_reason
    check (invoice_path is not null or btrim(coalesce(no_receipt_reason, '')) <> ''),
  -- Only money a staff member paid out of their own pocket gets paid back.
  constraint purchases_reimburse_own_money_only
    check (reimbursed_at is null or payment_method = 'own_money'),
  constraint purchases_reimbursed_together
    check ((reimbursed_at is null) = (reimbursed_by is null))
);

create index purchases_site_time on purchases (site_id, purchased_at);
create index purchases_by on purchases (purchased_by);
-- The "Owed to staff" list.
create index purchases_owed on purchases (purchased_at)
  where payment_method = 'own_money' and reimbursed_at is null;

-- 2. Grants -----------------------------------------------------------------------

alter table purchases enable row level security;
revoke all on purchases from anon, authenticated;
grant select on purchases to authenticated;
grant insert (site_id, supplier, description, total_incl_gst, gst_included,
              payment_method, invoice_path, no_receipt_reason, comments)
  on purchases to authenticated;

-- 3. Helpers and RLS --------------------------------------------------------------

-- "abc" -> null instead of an error, so a junk folder name in a storage path
-- is simply refused by the policies below.
create or replace function try_uuid(value text) returns uuid
language sql immutable as $$
  select case
    when value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then value::uuid
  end;
$$;

-- The invoice file is in this site's folder, exists, and you uploaded it.
-- Stops anyone pointing their purchase at someone else's invoice.
-- security definer: reads storage.objects whatever the storage policies say.
create or replace function invoice_belongs(path text, target_site uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select try_uuid(split_part(path, '/', 1)) = target_site
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'invoices'
        and o.name = path
        and o.owner_id = auth.uid()::text
    );
$$;

-- Is a purchase using this file? Then it can't be deleted.
create or replace function invoice_in_use(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from purchases where invoice_path = path);
$$;

create policy "own purchases or manager" on purchases
  for select using (purchased_by = auth.uid() or is_manager());

create policy "add purchases where on shift" on purchases
  for insert to authenticated
  with check (
    purchased_by = auth.uid()
    and on_shift_at(site_id)
    and (invoice_path is null or invoice_belongs(invoice_path, site_id))
  );

-- 4. Paid back ----------------------------------------------------------------------

create or replace function mark_reimbursed(purchase_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p purchases%rowtype;
begin
  if not is_manager() then
    raise exception 'Only a manager or the owner can mark a purchase as paid back'
      using errcode = 'insufficient_privilege';
  end if;

  -- "for update" locks the row, so two managers tapping at once can't both
  -- mark it.
  select * into p from purchases where id = purchase_id for update;
  if not found then
    raise exception 'Purchase not found' using errcode = 'invalid_parameter_value';
  end if;
  if p.payment_method <> 'own_money' then
    raise exception 'Only purchases paid with your own money are paid back'
      using errcode = 'check_violation';
  end if;
  if p.reimbursed_at is not null then
    raise exception 'This purchase is already marked as paid back' using errcode = 'check_violation';
  end if;
  if p.purchased_by = auth.uid() and not is_owner() then
    raise exception 'Someone else has to mark your own purchase as paid back'
      using errcode = 'insufficient_privilege';
  end if;

  update purchases set reimbursed_at = now(), reimbursed_by = auth.uid() where id = p.id;
end;
$$;

revoke execute on function mark_reimbursed(uuid) from public, anon;
grant execute on function mark_reimbursed(uuid) to authenticated;

-- 5. Invoice storage ------------------------------------------------------------------

-- Paths are {site_id}/{yyyy}/{mm}/{uuid}.{ext}. storage.foldername(name)
-- splits the folders, so [1] is the site.

create policy "invoices: upload where on shift" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'invoices'
    and on_shift_at(try_uuid((storage.foldername(name))[1]))
  );

create policy "invoices: read own or manager" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'invoices'
    and (owner_id = auth.uid()::text or is_manager())
  );

-- Only to clean up after a failed save: your own file, and only while no
-- purchase uses it. A saved invoice can't be deleted.
create policy "invoices: delete own unused" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'invoices'
    and owner_id = auth.uid()::text
    and not invoice_in_use(name)
  );
