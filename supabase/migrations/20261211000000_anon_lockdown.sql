-- Slice 8b, part 3: nothing for anonymous (signed-out) API callers.
--
-- The publishable key in every browser calls the API as "anon" until you
-- sign in. RLS already returned nothing to anon, but Supabase's default
-- grants still let anon TRY: ten early tables (sites, alerts, cash_ups...)
-- had every table privilege, and anon could call 16 security definer
-- functions (each checks auth.uid() itself, but that's one mistake away
-- from a leak). Nothing in the app runs as anon: the sign-in and reset
-- screens talk to Supabase Auth, not the database.
--
--   1. Revoke every table, sequence and function privilege from anon.
--   2. Functions: Postgres lets PUBLIC (everyone, anon included) execute new
--      functions by default. Take that away, keeping authenticated and
--      service_role exactly as they were.
--   3. Default privileges: the same for anything created later.
--
-- supabase/tests/security_guards.test.sql fails if any of this comes back.

-- 1. Tables and sequences -----------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- 2. Functions ---------------------------------------------------------------------------

do $$
declare
  f record;
  for_authenticated boolean;
  for_service boolean;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      -- Functions that belong to an extension (pgtap, btree_gist...) are the
      -- extension's business.
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    -- Who can run it now (directly or through PUBLIC)?
    for_authenticated := has_function_privilege('authenticated', f.sig, 'execute');
    for_service := has_function_privilege('service_role', f.sig, 'execute');

    execute format('revoke execute on function %s from public, anon', f.sig);
    -- Put back what authenticated and service_role had through PUBLIC.
    if for_authenticated then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if for_service then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end;
$$;

-- 3. Anything created later by migrations (they run as postgres) ------------------------------

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
-- Postgres's built-in "PUBLIC may execute new functions" is a global default,
-- which a per-schema setting (above) can only add to, never take away. This
-- schema-less one removes it. authenticated and service_role still get
-- execute from Supabase's own per-schema default for public.
alter default privileges for role postgres revoke execute on functions from public;
