-- Sample data matching the concept demo (Mon 16 Nov 2026). Not real business data.
-- Safe to re-run: every insert skips rows that already exist.

insert into sites (id, name, kind) values
  ('00000000-0000-0000-0000-000000000001', 'Chutneys South Indian Delights (Stoddard Road)', 'restaurant'),
  ('00000000-0000-0000-0000-000000000002', 'Orewa Cafe', 'cafe'),
  ('00000000-0000-0000-0000-000000000003', 'Truck - Sandringham', 'truck'),
  ('00000000-0000-0000-0000-000000000004', 'Truck - New Lynn', 'truck'),
  ('00000000-0000-0000-0000-000000000005', 'Truck - Mission Bay', 'truck'),
  ('00000000-0000-0000-0000-000000000006', 'Truck - Papatoetoe', 'truck'),
  ('00000000-0000-0000-0000-000000000007', 'Urban Roast by Chutneys', 'cafe')
on conflict (id) do nothing;

insert into checklist_items (site_kind, checklist, label, sort_order, needs_photo) values
  ('truck', 'opening', 'Gas bottles checked and secured', 1, false),
  ('truck', 'opening', 'Generator fuel and power OK', 2, false),
  ('truck', 'opening', 'Handwash station set up with soap and paper towels', 3, true),
  ('truck', 'opening', 'Fridges at 5 C or below', 4, false),
  ('truck', 'opening', 'Surface sanitiser made up', 5, false),
  ('truck', 'opening', 'Prep containers labelled and dated', 6, false),
  ('truck', 'opening', 'EFTPOS terminal charged and online', 7, false),
  ('truck', 'opening', 'Float counted ($200)', 8, false),

  ('restaurant', 'opening', 'Handwash stations stocked with soap and paper towels', 1, true),
  ('restaurant', 'opening', 'Walk-in chiller and fridges at 5 C or below', 2, false),
  ('restaurant', 'opening', 'Freezers running and food frozen hard', 3, false),
  ('restaurant', 'opening', 'Surface sanitiser made up', 4, false),
  ('restaurant', 'opening', 'Prep and stored food labelled, dated and rotated', 5, false),
  ('restaurant', 'opening', 'Tawa, ovens and fryers on and checked', 6, false),
  ('restaurant', 'opening', 'Fryer oil checked (colour and level)', 7, false),
  ('restaurant', 'opening', 'Dining room, tables and toilets clean', 8, false),
  ('restaurant', 'opening', 'Allergen information up to date', 9, false),
  ('restaurant', 'opening', 'Delivery tablets on and accepting orders', 10, false),
  ('restaurant', 'opening', 'Till, EFTPOS and float ready', 11, false),

  ('cafe', 'opening', 'Handwash station stocked with soap and paper towels', 1, true),
  ('cafe', 'opening', 'Fridges and display cabinet at 5 C or below', 2, false),
  ('cafe', 'opening', 'Coffee machine on, purged and test shot pulled', 3, false),
  ('cafe', 'opening', 'Milk checked: use-by dates OK and stock rotated', 4, false),
  ('cafe', 'opening', 'Surface sanitiser made up', 5, false),
  ('cafe', 'opening', 'Cabinet food labelled and dated', 6, false),
  ('cafe', 'opening', 'Tables, counter and toilet clean', 7, false),
  ('cafe', 'opening', 'Delivery tablet on and accepting orders', 8, false),
  ('cafe', 'opening', 'Till, EFTPOS and float ready', 9, false)
on conflict (site_kind, checklist, label) do nothing;

-- temp_units has no unique key, so skip any unit that already exists by site and name.
insert into temp_units (site_id, name, min_c, max_c)
select v.site_id, v.name, v.min_c, v.max_c
from (values
  ('00000000-0000-0000-0000-000000000004'::uuid, 'Fridge 1', null::numeric, 5.0),
  ('00000000-0000-0000-0000-000000000004'::uuid, 'Fridge 2', null::numeric, 5.0),
  ('00000000-0000-0000-0000-000000000004'::uuid, 'Bain-marie', 60.0, null::numeric)
) as v(site_id, name, min_c, max_c)
where not exists (
  select 1 from temp_units t where t.site_id = v.site_id and t.name = v.name
);

-- Fridges and freezers at every site, with fixed ids so a re-run skips them.
-- Id pattern: 7e000000-0000-0000-0000-0000000000SU (S = site 1-7, U = unit).
-- Each unit's own limits drive the fridge_daily check: fridges 0 to 5 C,
-- freezers -25 to -15 C.
insert into temp_units (id, site_id, name, min_c, max_c) values
  -- Restaurant
  ('7e000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Walk-in chiller', 0, 5),
  ('7e000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Prep fridge', 0, 5),
  ('7e000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'Walk-in freezer', -25, -15),
  -- Cafes
  ('7e000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000002', 'Display chiller', 0, 5),
  ('7e000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000002', 'Back fridge', 0, 5),
  ('7e000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000002', 'Freezer', -25, -15),
  ('7e000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000007', 'Display chiller', 0, 5),
  ('7e000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000007', 'Back fridge', 0, 5),
  ('7e000000-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000007', 'Freezer', -25, -15),
  -- Trucks
  ('7e000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000003', 'Under-counter fridge', 0, 5),
  ('7e000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000003', 'Freezer', -25, -15),
  ('7e000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000004', 'Under-counter fridge', 0, 5),
  ('7e000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000004', 'Freezer', -25, -15),
  ('7e000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000005', 'Under-counter fridge', 0, 5),
  ('7e000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000005', 'Freezer', -25, -15),
  ('7e000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000006', 'Under-counter fridge', 0, 5),
  ('7e000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000006', 'Freezer', -25, -15)
on conflict (id) do nothing;

-- Daily sales total 9,770: in store 5,890, Uber Eats 1,920, DoorDash 1,140, website 820
insert into daily_sales (site_id, sale_date, channel, amount, source) values
  ('00000000-0000-0000-0000-000000000001', '2026-11-16', 'in_store', 1520.00, 'manual'),
  ('00000000-0000-0000-0000-000000000001', '2026-11-16', 'uber_eats', 860.00, 'manual'),
  ('00000000-0000-0000-0000-000000000001', '2026-11-16', 'doordash', 520.00, 'manual'),
  ('00000000-0000-0000-0000-000000000001', '2026-11-16', 'website', 520.00, 'manual'),
  ('00000000-0000-0000-0000-000000000002', '2026-11-16', 'in_store', 560.00, 'manual'),
  ('00000000-0000-0000-0000-000000000002', '2026-11-16', 'uber_eats', 700.00, 'manual'),
  ('00000000-0000-0000-0000-000000000002', '2026-11-16', 'doordash', 300.00, 'manual'),
  ('00000000-0000-0000-0000-000000000002', '2026-11-16', 'website', 300.00, 'manual'),
  ('00000000-0000-0000-0000-000000000003', '2026-11-16', 'in_store', 880.00, 'manual'),
  ('00000000-0000-0000-0000-000000000003', '2026-11-16', 'uber_eats', 360.00, 'manual'),
  ('00000000-0000-0000-0000-000000000004', '2026-11-16', 'in_store', 980.00, 'manual'),
  ('00000000-0000-0000-0000-000000000005', '2026-11-16', 'in_store', 1190.00, 'manual'),
  ('00000000-0000-0000-0000-000000000005', '2026-11-16', 'doordash', 320.00, 'manual'),
  ('00000000-0000-0000-0000-000000000006', '2026-11-16', 'in_store', 760.00, 'manual')
on conflict (site_id, sale_date, channel) do nothing;

-- Test users, so local testing never depends on clicking in Studio.
-- LOCAL TEST LOGINS ONLY: the password is public, never use these anywhere real.
--   owner@test.local    owner    sees every site
--   manager@test.local  manager  Truck - Sandringham, Orewa Cafe
--   staff@test.local    staff    Truck - Sandringham
-- Password for all three: password123
--
-- GoTrue (Supabase Auth) only lets a user log in when the auth.users row
-- looks like one it created itself: the default instance_id, aud and role
-- 'authenticated', a confirmed email, a bcrypt password, and empty strings
-- (not NULL) in the token columns. Each user also needs an email identity.
-- crypt() and gen_salt() come from pgcrypto, in the "extensions" schema.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', '', '', '', '', ''
from (values
  ('d0000000-0000-0000-0000-000000000001'::uuid, 'owner@test.local'),
  ('d0000000-0000-0000-0000-000000000002'::uuid, 'manager@test.local'),
  ('d0000000-0000-0000-0000-000000000003'::uuid, 'staff@test.local')
) as v(id, email)
on conflict do nothing;

-- For the email provider, provider_id is the user's id as text.
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select
  v.id, v.id, v.id::text, 'email',
  jsonb_build_object('sub', v.id::text, 'email', v.email, 'email_verified', true),
  now(), now(), now()
from (values
  ('d0000000-0000-0000-0000-000000000001'::uuid, 'owner@test.local'),
  ('d0000000-0000-0000-0000-000000000002'::uuid, 'manager@test.local'),
  ('d0000000-0000-0000-0000-000000000003'::uuid, 'staff@test.local')
) as v(id, email)
on conflict do nothing;

insert into staff (id, name, role) values
  ('d0000000-0000-0000-0000-000000000001', 'Test Owner', 'owner'),
  ('d0000000-0000-0000-0000-000000000002', 'Test Manager', 'manager'),
  ('d0000000-0000-0000-0000-000000000003', 'Test Staff', 'staff')
on conflict (id) do nothing;

-- staff_sites no longer controls access (an open shift does: log in, pick a
-- site, and you're clocked in there). These links are kept as history of
-- where each person usually works. Managers and the owner see every site.
insert into staff_sites (staff_id, site_id) values
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003'), -- manager: Truck - Sandringham
  ('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002'), -- manager: Orewa Cafe
  ('d0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003')  -- staff: Truck - Sandringham
on conflict do nothing;

-- Food safety record templates. Drafts based on a typical NZ Food Control
-- Plan: check them with the owner before relying on them.
-- Safe to re-run: on conflict, the template is updated to match this file.
-- Field types: text, number, time, date, select, yes_no, temp_unit.
-- "range_from": "unit" on a number uses the chosen unit's min_c/max_c
-- (template min/max only fill in where the unit has none).
-- "later": true marks readings taken hours later, added as follow-up entries.
insert into record_templates (code, title, description, period, sort_order, fields) values
  ('fridge_daily', 'Fridge temperatures', 'Check every fridge, chiller and freezer. Fridges 5 C or below, freezers -15 C or below.', 'daily', 1, '[
    {"key":"unit","label":"Fridge, chiller or freezer","type":"temp_unit","required":true},
    {"key":"temperature","label":"Temperature","type":"number","required":true,"max":5,"unit":"C","range_from":"unit"}
  ]'),
  ('cooking', 'Cooking', 'Core temperature of cooked chicken and mince: 75 C or above.', 'daily', 2, '[
    {"key":"dish","label":"Dish","type":"select","required":true,"options":["chicken","minced lamb","other"]},
    {"key":"batch","label":"Batch or dish name","type":"text","required":true},
    {"key":"core_temp","label":"Core temperature","type":"number","required":true,"min":75,"unit":"C"}
  ]'),
  ('cooling', 'Cooling', 'Cooked food: 21 C or below within 2 hours, 5 C or below within 6 hours.', 'daily', 3, '[
    {"key":"dish","label":"Dish","type":"text","required":true},
    {"key":"time_started","label":"Time cooling started","type":"time","required":true},
    {"key":"temp_2h","label":"Temperature after 2 hours","type":"number","max":21,"unit":"C","later":true},
    {"key":"temp_6h","label":"Temperature after 6 hours","type":"number","max":5,"unit":"C","later":true}
  ]'),
  ('reheating', 'Reheating', 'Reheat to 75 C or above.', 'daily', 4, '[
    {"key":"dish","label":"Dish","type":"text","required":true},
    {"key":"core_temp","label":"Core temperature","type":"number","required":true,"min":75,"unit":"C"}
  ]'),
  ('hot_holding', 'Hot holding', 'Bain-marie and hot hold: 60 C or above.', 'daily', 5, '[
    {"key":"food","label":"Food","type":"text","required":true},
    {"key":"temperature","label":"Temperature","type":"number","required":true,"min":60,"unit":"C"}
  ]'),
  ('cold_display', 'Cold display', 'Display cabinets: 5 C or below.', 'daily', 6, '[
    {"key":"food","label":"Food","type":"text","required":true},
    {"key":"temperature","label":"Temperature","type":"number","required":true,"max":5,"unit":"C"}
  ]'),
  ('transport', 'Transport', 'Food moved between sites. Chilled 5 C or below, hot 60 C or above on arrival.', 'daily', 7, '[
    {"key":"food","label":"Food","type":"text","required":true},
    {"key":"from_site","label":"From site","type":"text","required":true},
    {"key":"mode","label":"Chilled or hot","type":"select","required":true,"options":["chilled","hot"]},
    {"key":"temp_leaving","label":"Temperature leaving","type":"number","required":true,"unit":"C"},
    {"key":"temp_arriving","label":"Temperature arriving","type":"number","required":true,"unit":"C",
     "range_when":{"field":"mode","ranges":{"chilled":{"max":5},"hot":{"min":60}}}}
  ]'),
  ('batter_fermentation', 'Dosa and idli batter', 'Fermentation from mixing to the fridge.', 'daily', 8, '[
    {"key":"batch","label":"Batch","type":"text","required":true},
    {"key":"time_made","label":"Time made","type":"time","required":true},
    {"key":"room_temp","label":"Room temperature","type":"number","unit":"C"},
    {"key":"time_ready","label":"Time ready","type":"time","later":true},
    {"key":"how_checked","label":"How checked","type":"select","options":["smell and bubbles","pH","other"],"later":true},
    {"key":"time_into_fridge","label":"Time into fridge","type":"time","later":true},
    {"key":"use_by","label":"Use by date","type":"date","later":true}
  ]'),
  ('cleaning', 'Cleaning', 'Cleaning tasks done today.', 'daily', 9, '[
    {"key":"area","label":"Area","type":"text","required":true},
    {"key":"task_done","label":"Task done","type":"yes_no","required":true,"expect":true}
  ]'),
  ('deliveries', 'Deliveries', 'Chilled deliveries: 5 C or below. Leave the temperature blank for dry goods.', 'event', 10, '[
    {"key":"supplier","label":"Supplier","type":"text","required":true},
    {"key":"food","label":"Food","type":"text","required":true},
    {"key":"quantity","label":"Quantity","type":"text","required":true},
    {"key":"arrival_temp","label":"Arrival temperature","type":"number","max":5,"unit":"C"}
  ]'),
  ('maintenance', 'Maintenance', 'Repairs and servicing.', 'event', 11, '[
    {"key":"equipment","label":"Equipment","type":"text","required":true},
    {"key":"what_done","label":"What was done","type":"text","required":true}
  ]'),
  ('incident', 'Incident', 'Anything that went wrong with food safety.', 'event', 12, '[
    {"key":"what_happened","label":"What happened","type":"text","required":true},
    {"key":"what_done","label":"What was done","type":"text","required":true}
  ]'),
  ('complaint', 'Customer complaint', 'Complaints about food.', 'event', 13, '[
    {"key":"complaint","label":"Customer complaint","type":"text","required":true},
    {"key":"what_done","label":"What was done","type":"text","required":true}
  ]')
on conflict (code) do update set
  title = excluded.title,
  description = excluded.description,
  period = excluded.period,
  sort_order = excluded.sort_order,
  fields = excluded.fields;

-- Opening checks, as record templates (they replace the old checklist pages).
-- One template per kind of site, because each kind has different checks and
-- the record engine picks templates by site kind. One entry = the whole
-- morning check. "expect": true means a No is flagged and needs a corrective
-- action, like a fridge reading over 5 C. Drafts: confirm with the owner.
insert into record_templates (code, title, description, period, site_kinds, sort_order, fields) values
  ('opening_checks_truck', 'Opening checks', 'Before opening: answer every check. A No needs a corrective action.', 'daily', '{truck}', 0, '[
    {"key":"gas_bottles","label":"Gas bottles checked and secured","type":"yes_no","required":true,"expect":true},
    {"key":"generator","label":"Generator fuel and power OK","type":"yes_no","required":true,"expect":true},
    {"key":"handwash","label":"Handwash station set up with soap and paper towels","type":"yes_no","required":true,"expect":true},
    {"key":"fridges","label":"Fridges at 5 C or below","type":"yes_no","required":true,"expect":true},
    {"key":"sanitiser","label":"Surface sanitiser made up","type":"yes_no","required":true,"expect":true},
    {"key":"labelled","label":"Prep containers labelled and dated","type":"yes_no","required":true,"expect":true},
    {"key":"eftpos","label":"EFTPOS terminal charged and online","type":"yes_no","required":true,"expect":true},
    {"key":"float","label":"Float counted ($200)","type":"yes_no","required":true,"expect":true}
  ]'),
  ('opening_checks_restaurant', 'Opening checks', 'Before opening: answer every check. A No needs a corrective action.', 'daily', '{restaurant}', 0, '[
    {"key":"handwash","label":"Handwash stations stocked with soap and paper towels","type":"yes_no","required":true,"expect":true},
    {"key":"chillers","label":"Walk-in chiller and fridges at 5 C or below","type":"yes_no","required":true,"expect":true},
    {"key":"freezers","label":"Freezers running and food frozen hard","type":"yes_no","required":true,"expect":true},
    {"key":"sanitiser","label":"Surface sanitiser made up","type":"yes_no","required":true,"expect":true},
    {"key":"labelled","label":"Prep and stored food labelled, dated and rotated","type":"yes_no","required":true,"expect":true},
    {"key":"equipment","label":"Tawa, ovens and fryers on and checked","type":"yes_no","required":true,"expect":true},
    {"key":"fryer_oil","label":"Fryer oil checked (colour and level)","type":"yes_no","required":true,"expect":true},
    {"key":"front_clean","label":"Dining room, tables and toilets clean","type":"yes_no","required":true,"expect":true},
    {"key":"allergens","label":"Allergen information up to date","type":"yes_no","required":true,"expect":true},
    {"key":"delivery_tablets","label":"Delivery tablets on and accepting orders","type":"yes_no","required":true,"expect":true},
    {"key":"till","label":"Till, EFTPOS and float ready","type":"yes_no","required":true,"expect":true}
  ]'),
  ('opening_checks_cafe', 'Opening checks', 'Before opening: answer every check. A No needs a corrective action.', 'daily', '{cafe}', 0, '[
    {"key":"handwash","label":"Handwash station stocked with soap and paper towels","type":"yes_no","required":true,"expect":true},
    {"key":"fridges","label":"Fridges and display cabinet at 5 C or below","type":"yes_no","required":true,"expect":true},
    {"key":"coffee_machine","label":"Coffee machine on, purged and test shot pulled","type":"yes_no","required":true,"expect":true},
    {"key":"milk","label":"Milk checked: use-by dates OK and stock rotated","type":"yes_no","required":true,"expect":true},
    {"key":"sanitiser","label":"Surface sanitiser made up","type":"yes_no","required":true,"expect":true},
    {"key":"labelled","label":"Cabinet food labelled and dated","type":"yes_no","required":true,"expect":true},
    {"key":"front_clean","label":"Tables, counter and toilet clean","type":"yes_no","required":true,"expect":true},
    {"key":"delivery_tablet","label":"Delivery tablet on and accepting orders","type":"yes_no","required":true,"expect":true},
    {"key":"till","label":"Till, EFTPOS and float ready","type":"yes_no","required":true,"expect":true}
  ]')
on conflict (code) do update set
  title = excluded.title,
  description = excluded.description,
  period = excluded.period,
  site_kinds = excluded.site_kinds,
  sort_order = excluded.sort_order,
  fields = excluded.fields;

-- Records that must be done every day the site is open (Home's "Due
-- today"). Everything else is filled in only when it happens. Same list as
-- the required_daily migration. Re-running changes nothing.
update record_templates
set required_daily = code in (
  'fridge_daily',
  'opening_checks_truck',
  'opening_checks_cafe',
  'opening_checks_restaurant',
  'cleaning'
)
where required_daily is distinct from (code in (
  'fridge_daily',
  'opening_checks_truck',
  'opening_checks_cafe',
  'opening_checks_restaurant',
  'cleaning'
));
