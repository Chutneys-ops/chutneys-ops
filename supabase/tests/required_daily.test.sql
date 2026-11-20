-- record_templates.required_daily: which daily records are due every day.
-- Run with: npx supabase test db
-- Everything happens inside a transaction that is rolled back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select col_default_is('record_templates', 'required_daily', 'false', 'required_daily defaults to false');

insert into record_templates (code, title, period, fields) values ('test_daily', 'Test daily', 'daily', '[]');
select is(
  (select required_daily from record_templates where code = 'test_daily'),
  false,
  'A new template is not required every day unless set');

select lives_ok(
  $$ update record_templates set required_daily = true where code = 'test_daily' $$,
  'A daily template can be required every day');

insert into record_templates (code, title, period, fields) values ('test_event', 'Test event', 'event', '[]');
select throws_ok(
  $$ update record_templates set required_daily = true where code = 'test_event' $$,
  '23514', null,
  'An event template (like Deliveries) cannot be required every day');

select * from finish();
rollback;
