-- Servers no longer move orders through the kitchen. 'server_kitchen' is for a person who does both (quiet days).
alter table staff drop constraint if exists staff_role_check;
alter table staff add constraint staff_role_check check (role in ('owner', 'manager', 'staff', 'server_kitchen', 'chef'));
