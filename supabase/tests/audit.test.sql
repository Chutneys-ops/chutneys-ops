-- Audit log: every business table is audited; insert/update/delete rows;
-- owner-only reading; append-only; no secrets.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Coverage: a new table can never be forgotten ------------------------------
-- Every table in public must have the audit trigger, except this allowlist:
--   audit_log  (auditing the audit log would loop)
--   staff_pins (PIN hashes are secrets)
-- If this fails, add `select enable_audit('your_table');` to its migration.
select is_empty(
  $$ select c.relname::text
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relname not in ('audit_log', 'staff_pins')
       and not exists (
         select 1 from pg_trigger t
         where t.tgrelid = c.oid and t.tgname = 'audit_row' and not t.tgisinternal
       ) $$,
  'Every business table has the audit trigger (see enable_audit)');

select is(
  audit_redact('{"a":1,"pin_hash":"x","password":"y","api_token":"z","note":"ok"}'),
  '{"a":1,"note":"ok"}'::jsonb,
  'audit_redact strips hashes, passwords and tokens');

-- Setup (as postgres: actor is the system) ------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'mia@test.local'),
  ('d0000000-0000-0000-0000-00000000000d', 'olly@test.local');
insert into staff (id, name, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'Ana', 'staff'),
  ('c0000000-0000-0000-0000-00000000000c', 'Mia', 'manager'),
  ('d0000000-0000-0000-0000-00000000000d', 'Olly', 'owner');
insert into sites (id, name, kind) values
  ('10000000-0000-0000-0000-00000000000a', 'Test truck A', 'truck');
insert into shifts (site_id, staff_id) values
  ('10000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a');
insert into temp_units (id, site_id, name, max_c) values
  ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Audit fridge', 5);

select is(
  (select row(action, actor_id, actor_role, new_data ->> 'name', old_data)::text
   from audit_log where table_name = 'sites' and row_id = '10000000-0000-0000-0000-00000000000a'),
  row('insert', null::uuid, 'system', 'Test truck A', null::jsonb)::text,
  'A system insert is logged with no actor');

insert into staff_sites (staff_id, site_id) values
  ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a');
select is(
  (select row_id from audit_log where table_name = 'staff_sites' and new_data ->> 'staff_id' = 'a0000000-0000-0000-0000-00000000000a'),
  'a0000000-0000-0000-0000-00000000000a,10000000-0000-0000-0000-00000000000a',
  'A two-column key is logged as "staff_id,site_id"');

-- Insert as Ana ---------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

insert into purchases (site_id, supplier, description, total_incl_gst, payment_method, no_receipt_reason)
values ('10000000-0000-0000-0000-00000000000a', 'Audit shop', 'Onions', 23.00, 'own_money', 'Market');

select is(
  (select count(*)::int from audit_log),
  0,
  'Staff cannot read the audit log');

select throws_ok(
  $$ insert into audit_log (table_name, row_id, action) values ('x', '1', 'insert') $$,
  '42501', null,
  'Staff cannot write to the audit log');

-- Update as Mia (through a security definer function) -------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

select is(
  (select count(*)::int from audit_log),
  0,
  'A manager cannot read the audit log');

select lives_ok(
  $$ select mark_reimbursed((select id from purchases where supplier = 'Audit shop')) $$,
  'Mia marks the purchase paid back');

-- A PIN change: staff_pins isn't audited.
select lives_ok($$ select set_my_pin('2468') $$, 'Mia sets her PIN');

-- Check as the owner -----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);

create temp table p as select id::text as id from purchases where supplier = 'Audit shop';
grant select on p to authenticated;

select is(
  (select count(*)::int from audit_log
   where table_name = 'purchases' and row_id = (select id from p) and action = 'insert'),
  1,
  'The owner can read the log: one insert row');

select is(
  (select row(actor_id, actor_role, old_data)::text from audit_log
   where table_name = 'purchases' and row_id = (select id from p) and action = 'insert'),
  row('a0000000-0000-0000-0000-00000000000a'::uuid, 'staff', null::jsonb)::text,
  'The insert is by Ana (staff), with no old data');

select is(
  (select new_data ->> 'supplier' from audit_log
   where table_name = 'purchases' and row_id = (select id from p) and action = 'insert'),
  'Audit shop',
  'The insert keeps the new data');

select is(
  (select count(*)::int from audit_log
   where table_name = 'purchases' and row_id = (select id from p) and action = 'update'),
  1,
  'One update row');

select is(
  (select row(actor_id, actor_role, changed_fields)::text from audit_log
   where table_name = 'purchases' and row_id = (select id from p) and action = 'update'),
  row('c0000000-0000-0000-0000-00000000000c'::uuid, 'manager', array['reimbursed_at', 'reimbursed_by'])::text,
  'The update is by Mia, even through a security definer function, with only the changed fields');

select is(
  (select old_data ->> 'reimbursed_at' from audit_log
   where table_name = 'purchases' and row_id = (select id from p) and action = 'update'),
  null,
  'The update keeps the before values');

select is(
  (select count(*)::int from audit_log where table_name = 'staff_pins'),
  0,
  'PIN changes are not audited');

select throws_ok(
  $$ update audit_log set actor_role = 'x' $$,
  '42501', null,
  'Even the owner cannot change the audit log');

select throws_ok(
  $$ delete from audit_log $$,
  '42501', null,
  'Even the owner cannot delete from the audit log');

-- Delete and no-op update as the system ----------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);

delete from temp_units where id = '30000000-0000-0000-0000-0000000000a1';

select is(
  (select row(action, actor_id, actor_role, old_data ->> 'name', new_data, changed_fields)::text
   from audit_log where table_name = 'temp_units' and row_id = '30000000-0000-0000-0000-0000000000a1'
     and action = 'delete'),
  row('delete', null::uuid, 'system', 'Audit fridge', null::jsonb, null::text[])::text,
  'A delete is logged with the old data');

select is(
  (select count(*)::int from audit_log where table_name = 'temp_units' and row_id = '30000000-0000-0000-0000-0000000000a1'),
  2,
  'One insert and one delete for the unit');

update sites set name = name where id = '10000000-0000-0000-0000-00000000000a';
select is(
  (select count(*)::int from audit_log where table_name = 'sites' and row_id = '10000000-0000-0000-0000-00000000000a'),
  1,
  'An update that changes nothing writes no audit row');

-- No trace of the PIN hash anywhere.
select is(
  (select count(*)::int from audit_log
   where position((select pin_hash from staff_pins where staff_id = 'c0000000-0000-0000-0000-00000000000c')
                  in coalesce(old_data::text, '') || coalesce(new_data::text, '')) > 0),
  0,
  'The PIN hash appears nowhere in the audit log');

select throws_ok(
  $$ update audit_log set actor_role = 'x' $$,
  '42501', 'The audit log can''t be changed or deleted',
  'Append-only even for postgres');

select throws_ok(
  $$ truncate audit_log $$,
  '42501', 'The audit log can''t be changed or deleted',
  'The audit log cannot be truncated');

select * from finish();
rollback;
