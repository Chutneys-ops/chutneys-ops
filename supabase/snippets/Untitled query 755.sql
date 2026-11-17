select * from staff;
update sites set name = 'Chutneys South Indian Delights (Stoddard Road)' where id = '00000000-0000-0000-0000-000000000001';
update sites set name = 'Orewa Cafe' where id = '00000000-0000-0000-0000-000000000002';
update sites set name = 'Truck - Sandringham' where id = '00000000-0000-0000-0000-000000000003';
update sites set name = 'Truck - New Lynn' where id = '00000000-0000-0000-0000-000000000004';
update sites set name = 'Truck - Mission Bay' where id = '00000000-0000-0000-0000-000000000005';
update sites set name = 'Truck - Papatoetoe' where id = '00000000-0000-0000-0000-000000000006';

insert into sites (id, name, kind)
values ('00000000-0000-0000-0000-000000000007', 'Urban Roast by Chutneys', 'cafe');