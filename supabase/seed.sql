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

-- Staff, shifts, readings and cash-ups need real auth users first.
-- Create test users in Supabase Auth, then add matching rows to staff and staff_sites.
