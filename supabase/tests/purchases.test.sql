-- Purchases: grants, RLS, GST maths, mark_reimbursed and invoice storage policies.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- Setup (as postgres, which skips RLS) ---------------------------------------
-- Ana (staff) on shift at A, Ben (staff) at B, Mia (manager) at A, Olly (owner) at B.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'ben@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'mia@test.local'),
  ('d0000000-0000-0000-0000-00000000000d', 'olly@test.local');
insert into staff (id, name, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', 'Ben', 'staff'),
  ('c0000000-0000-0000-0000-00000000000c', 'Mia', 'manager'),
  ('d0000000-0000-0000-0000-00000000000d', 'Olly', 'owner');
insert into sites (id, name, kind) values
  ('10000000-0000-0000-0000-00000000000a', 'Test truck A', 'truck'),
  ('10000000-0000-0000-0000-00000000000b', 'Test truck B', 'truck');
insert into shifts (site_id, staff_id) values
  ('10000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000c'),
  ('10000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000d');

-- The bucket comes from config.toml (npx supabase seed buckets). Make sure it
-- exists so these tests don't depend on that step.
insert into storage.buckets (id, name) values ('invoices', 'invoices') on conflict (id) do nothing;

-- Ben's invoice, in site A's folder: Ana must not be able to use it.
insert into storage.objects (bucket_id, name, owner_id) values
  ('invoices', '10000000-0000-0000-0000-00000000000a/2026/11/ben.jpg', 'b0000000-0000-0000-0000-00000000000b');

-- Act as Ana -----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, no_receipt_reason)
     values ('10000000-0000-0000-0000-00000000000a', 'GST test', 'Onions', 115.00, 'own_money', 'Market stall') $$,
  'Ana can add a purchase at the site she is on shift at');

select is(
  (select gst_amount from purchases where supplier = 'GST test'),
  15.00::numeric,
  '115.00 including GST has 15.00 GST');

select is(
  (select purchased_by from purchases where supplier = 'GST test'),
  'a0000000-0000-0000-0000-00000000000a'::uuid,
  'purchased_by defaults to Ana');

select lives_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, gst_included, payment_method, no_receipt_reason)
     values ('10000000-0000-0000-0000-00000000000a', 'No GST', 'Eggs', 20.00, false, 'cash', 'Farm gate') $$,
  'Ana can add a purchase with no GST');

select is(
  (select gst_amount from purchases where supplier = 'No GST'),
  0.00::numeric,
  'GST is 0 when the price has no GST');

select throws_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, no_receipt_reason)
     values ('10000000-0000-0000-0000-00000000000b', 'Wrong site', 'Milk', 5.00, 'cash', 'Lost') $$,
  '42501', null,
  'Ana cannot add a purchase at a site she is not on shift at');

select throws_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, no_receipt_reason, purchased_at)
     values ('10000000-0000-0000-0000-00000000000a', 'Backdated', 'Milk', 5.00, 'cash', 'Lost', '2026-01-01') $$,
  '42501', null,
  'Ana cannot set purchased_at');

select throws_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, no_receipt_reason, gst_amount)
     values ('10000000-0000-0000-0000-00000000000a', 'Fake GST', 'Milk', 5.00, 'cash', 'Lost', 1.00) $$,
  '428C9', null,
  'Ana cannot set gst_amount');

select throws_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, no_receipt_reason, purchased_by)
     values ('10000000-0000-0000-0000-00000000000a', 'As Ben', 'Milk', 5.00, 'cash', 'Lost', 'b0000000-0000-0000-0000-00000000000b') $$,
  '42501', null,
  'Ana cannot set purchased_by');

select throws_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, no_receipt_reason, reimbursed_at)
     values ('10000000-0000-0000-0000-00000000000a', 'Self paid', 'Milk', 5.00, 'own_money', 'Lost', now()) $$,
  '42501', null,
  'Ana cannot set reimbursed_at');

select throws_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method)
     values ('10000000-0000-0000-0000-00000000000a', 'No proof', 'Milk', 5.00, 'cash') $$,
  '23514', null,
  'A purchase needs an invoice or a no-receipt reason');

select throws_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, no_receipt_reason)
     values ('10000000-0000-0000-0000-00000000000a', 'Blank reason', 'Milk', 5.00, 'cash', '   ') $$,
  '23514', null,
  'A blank no-receipt reason does not count');

select throws_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, no_receipt_reason)
     values ('10000000-0000-0000-0000-00000000000a', 'Zero', 'Milk', 0, 'cash', 'Lost') $$,
  '23514', null,
  'The total must be more than 0');

select throws_ok(
  $$ update purchases set total_incl_gst = 1 where supplier = 'GST test' $$,
  '42501', null,
  'Ana cannot edit her purchase');

select throws_ok(
  $$ delete from purchases where supplier = 'GST test' $$,
  '42501', null,
  'Ana cannot delete her purchase');

select throws_ok(
  $$ select mark_reimbursed((select id from purchases where supplier = 'GST test')) $$,
  '42501', null,
  'Staff cannot mark a purchase as paid back');

-- Storage as Ana
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('invoices', '10000000-0000-0000-0000-00000000000a/2026/11/ana.jpg', 'a0000000-0000-0000-0000-00000000000a') $$,
  'Ana can upload an invoice into her shift site''s folder');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('invoices', '10000000-0000-0000-0000-00000000000b/2026/11/ana.jpg', 'a0000000-0000-0000-0000-00000000000a') $$,
  '42501', null,
  'Ana cannot upload into another site''s folder');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('invoices', 'not-a-site/2026/11/ana.jpg', 'a0000000-0000-0000-0000-00000000000a') $$,
  '42501', null,
  'A junk folder name is refused');

select lives_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, invoice_path)
     values ('10000000-0000-0000-0000-00000000000a', 'With invoice', 'Rice', 80.00, 'company_card',
             '10000000-0000-0000-0000-00000000000a/2026/11/ana.jpg') $$,
  'Ana can add a purchase with her own invoice');

select throws_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, invoice_path)
     values ('10000000-0000-0000-0000-00000000000a', 'Stolen invoice', 'Rice', 80.00, 'company_card',
             '10000000-0000-0000-0000-00000000000a/2026/11/ben.jpg') $$,
  '42501', null,
  'Ana cannot use someone else''s invoice');

select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'invoices' and name like '10000000-0000-0000-0000-00000000000_/%'),
  1,
  'Ana sees only her own invoice file');

-- Act as Ben -----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, no_receipt_reason)
     values ('10000000-0000-0000-0000-00000000000b', 'Ben shop', 'Ice', 9.50, 'cash', 'Vending machine') $$,
  'Ben can add a purchase at his site');

select is(
  (select array_agg(supplier) from purchases),
  array['Ben shop'],
  'Ben sees only his own purchases');

-- Act as Mia (manager) -------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated","aal":"aal2"}', true);

-- Only count the test sites: the local database may have real test data too.
select is(
  (select count(*)::int from purchases
   where site_id in ('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b')),
  4,
  'A manager sees every purchase');

select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'invoices' and name like '10000000-0000-0000-0000-00000000000_/%'),
  2,
  'A manager can read every invoice file');

select lives_ok(
  $$ insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, no_receipt_reason)
     values ('10000000-0000-0000-0000-00000000000a', 'Mia shop', 'Lemons', 12.00, 'own_money', 'Lost it') $$,
  'Mia can add her own purchase where she is on shift');

select lives_ok(
  $$ select mark_reimbursed((select id from purchases where supplier = 'GST test')) $$,
  'A manager can mark staff''s own-money purchase as paid back');

select is(
  (select reimbursed_by from purchases where supplier = 'GST test'),
  'c0000000-0000-0000-0000-00000000000c'::uuid,
  'reimbursed_by is the manager');

select throws_ok(
  $$ select mark_reimbursed((select id from purchases where supplier = 'GST test')) $$,
  '23514', null,
  'A purchase cannot be paid back twice');

select throws_ok(
  $$ select mark_reimbursed((select id from purchases where supplier = 'No GST')) $$,
  '23514', null,
  'A cash purchase is not paid back');

select throws_ok(
  $$ select mark_reimbursed((select id from purchases where supplier = 'Mia shop')) $$,
  '42501', null,
  'A manager cannot mark her own purchase as paid back');

select throws_ok(
  $$ update purchases set reimbursed_at = now() where supplier = 'Mia shop' $$,
  '42501', null,
  'A manager cannot set reimbursed_at directly');

-- Act as Olly (owner) --------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$ select mark_reimbursed((select id from purchases where supplier = 'Mia shop')) $$,
  'The owner can mark a manager''s purchase as paid back');

select * from finish();
rollback;
