-- Security smoke test: whole-database rules that a new migration could
-- quietly break. If one of these fails, fix the migration, don't the test.
-- Run with: npx supabase test db

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- 1. Row-level security is on for every table in public. Without it, the
--    API would hand out every row to anyone signed in.
select is_empty(
  $$ select c.relname::text
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'every table in public has row-level security on');

-- 2. Signed-out callers (anon: the publishable key with no session) have no
--    grant on any table or view. Fix: revoke all on <table> from anon.
select is_empty(
  $$ select table_name::text || ': ' || string_agg(privilege_type, ', ')
     from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public'
     group by table_name $$,
  'anon has no grant on any table in public');

-- 3. ...and that stays true for tables added later (default privileges).
create table guard_probe (id int primary key);
create function guard_probe_fn() returns int language sql as 'select 1';
select ok(
  not has_table_privilege('anon', 'guard_probe', 'select')
  and not has_table_privilege('anon', 'guard_probe', 'insert')
  and not has_function_privilege('anon', 'guard_probe_fn()', 'execute')
  and has_function_privilege('authenticated', 'guard_probe_fn()', 'execute'),
  'a new table or function gives anon nothing by default (signed-in people keep execute)');
drop function guard_probe_fn();
drop table guard_probe;

-- 4. Every security definer function pins its search_path. Without it, a
--    caller could put their own table or function named like ours earlier
--    on the path and have it run with the owner's rights.
select is_empty(
  $$ select p.oid::regprocedure::text
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and not exists (
         select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
       ) $$,
  'every security definer function in public has a fixed search_path');

-- 5. Signed-out callers can't run any of our functions (extensions' own
--    functions aside). Fix: revoke execute on function <f> from public, anon.
select is_empty(
  $$ select p.oid::regprocedure::text
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and has_function_privilege('anon', p.oid, 'execute')
       and not exists (
         select 1 from pg_depend d
         where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
       ) $$,
  'anon can''t execute any function in public');

-- 6. No storage bucket is public. Every file (invoices, certificates,
--    signatures, payslips, verifier packs) is read through policies and
--    short-lived signed links.
select is_empty(
  $$ select id from storage.buckets where public $$,
  'no storage bucket is public');

-- 7. Storage has row-level security on too.
select ok(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  'storage.objects has row-level security on');

select * from finish();
rollback;
