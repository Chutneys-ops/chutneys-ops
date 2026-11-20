-- Trading days per site. Food trucks don't trade every day, so a daily
-- record (fridge temperatures, opening checks, cleaning) is only expected on
-- the days a site trades.
--
--   1. sites.trading_days: ISO weekday numbers, 1 = Monday ... 7 = Sunday.
--      Default all seven (nothing changes until a manager sets it).
--   2. set_site_trading_days(): managers and the owner change it (Settings,
--      next to Opening times). Like opening times, sites can't be updated
--      directly through the API.
--
-- Used by the verifier pack (non-trading days show "Closed", not "No
-- record") and the fridge and opening-check reminders (skipped on
-- non-trading days). web/lib/trading-days.ts has the same rules; its test
-- reads this file so the default can't drift.
--
-- Only the current setting is kept: changing it also changes how older
-- days look in a pack made later (README > Known follow-ups).

-- 1. Column ------------------------------------------------------------------------------

alter table sites
  add column trading_days smallint[] not null default '{1,2,3,4,5,6,7}';

-- At least one day (a site that never trades is closed: sites.active),
-- only 1 to 7, and no day twice. A check constraint can't hold a subquery,
-- so the rule lives in this small function.
create or replace function valid_trading_days(days smallint[]) returns boolean
language sql immutable as $$
  select days is not null
    and cardinality(days) between 1 and 7
    and array_position(days, null) is null
    and days <@ '{1,2,3,4,5,6,7}'::smallint[]
    and cardinality(days) = (select count(distinct d) from unnest(days) d);
$$;

alter table sites
  add constraint sites_trading_days_valid check (valid_trading_days(trading_days));

comment on column sites.trading_days is
  'ISO weekdays the site trades (1 = Monday ... 7 = Sunday). Daily records are only expected on these days.';

-- 2. Changing it ---------------------------------------------------------------------------

create or replace function set_site_trading_days(site uuid, days smallint[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_manager() then
    raise exception 'Only a manager or the owner can change trading days' using errcode = 'insufficient_privilege';
  end if;
  if days is null or cardinality(days) = 0 then
    raise exception 'Choose at least one trading day' using errcode = 'invalid_parameter_value';
  end if;
  if array_position(days, null) is not null or not days <@ '{1,2,3,4,5,6,7}'::smallint[] then
    raise exception 'Days must be 1 (Monday) to 7 (Sunday)' using errcode = 'invalid_parameter_value';
  end if;
  update sites
  set trading_days = (select array_agg(distinct d order by d) from unnest(days) d)
  where id = site;
  if not found then
    raise exception 'Site not found' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

revoke execute on function set_site_trading_days(uuid, smallint[]) from public, anon;
grant execute on function set_site_trading_days(uuid, smallint[]) to authenticated;
