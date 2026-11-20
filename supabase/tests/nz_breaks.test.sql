-- nz_breaks(): rest and meal breaks from the Employment NZ table.
-- Run with: npx supabase test db
--
-- The cases between BREAK CASES START and END are SHARED: web/lib/breaks.test.ts
-- reads this file and checks web/lib/breaks.ts against the same lines. So
-- if the SQL and the TypeScript ever disagree, one of the two tests fails.
-- Keep one case per line: (minutes at work, rest breaks, meal breaks).

begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

create temp table break_cases (minutes integer, rest integer, meal integer);
insert into break_cases (minutes, rest, meal) values
-- BREAK CASES START
  (0, 0, 0),
  (119, 0, 0),
  (120, 1, 0),
  (240, 1, 0),
  (241, 1, 1),
  (360, 1, 1),
  (361, 2, 1),
  (600, 2, 1),
  (601, 3, 1),
  (720, 3, 1),
  (721, 3, 2),
  (840, 3, 2),
  (841, 4, 2),
  (960, 4, 2)
-- BREAK CASES END
;

select is((select count(*)::int from break_cases), 14, 'All 14 shared cases are loaded');

select is_empty(
  $$ select c.minutes, c.rest, c.meal, b.rest_breaks, b.meal_breaks
     from break_cases c cross join lateral nz_breaks(c.minutes) b
     where (b.rest_breaks, b.meal_breaks) is distinct from (c.rest, c.meal) $$,
  'nz_breaks matches every shared case (0, 2h, 4h, 4h01, 6h, 6h01, 10h, 10h01, 12h, 14h, 16h and neighbours)');

select * from finish();
rollback;
