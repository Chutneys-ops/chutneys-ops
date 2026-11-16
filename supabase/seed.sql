-- Sample data matching the concept demo (Mon 16 Nov 2026). Not real business data.

insert into sites (id, name, kind) values
  ('00000000-0000-0000-0000-000000000001', 'Restaurant', 'restaurant'),
  ('00000000-0000-0000-0000-000000000002', 'Orewa cafe', 'cafe'),
  ('00000000-0000-0000-0000-000000000003', 'Truck 1', 'truck'),
  ('00000000-0000-0000-0000-000000000004', 'Truck 2', 'truck'),
  ('00000000-0000-0000-0000-000000000005', 'Truck 3', 'truck'),
  ('00000000-0000-0000-0000-000000000006', 'Truck 4', 'truck');

insert into checklist_items (site_kind, checklist, label, sort_order, needs_photo) values
  ('truck', 'opening', 'Gas bottles checked and secured', 1, false),
  ('truck', 'opening', 'Generator fuel and power OK', 2, false),
  ('truck', 'opening', 'Handwash station set up with soap and paper towels', 3, true),
  ('truck', 'opening', 'Fridges at 5 C or below', 4, false),
  ('truck', 'opening', 'Surface sanitiser made up', 5, false),
  ('truck', 'opening', 'Prep containers labelled and dated', 6, false),
  ('truck', 'opening', 'EFTPOS terminal charged and online', 7, false),
  ('truck', 'opening', 'Float counted ($200)', 8, false);

insert into temp_units (site_id, name, min_c, max_c) values
  ('00000000-0000-0000-0000-000000000004', 'Fridge 1', null, 5.0),
  ('00000000-0000-0000-0000-000000000004', 'Fridge 2', null, 5.0),
  ('00000000-0000-0000-0000-000000000004', 'Bain-marie', 60.0, null);

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
  ('00000000-0000-0000-0000-000000000006', '2026-11-16', 'in_store', 760.00, 'manual');

-- Staff, shifts, readings and cash-ups need real auth users first.
-- Create test users in Supabase Auth, then add matching rows to staff and staff_sites.
