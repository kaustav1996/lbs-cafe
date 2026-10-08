-- Kitchen accounts: a chef sees only the kitchen screen (orders to make) and can move them to preparing and ready.
alter table staff drop constraint if exists staff_role_check;
alter table staff add constraint staff_role_check check (role in ('owner', 'manager', 'staff', 'chef'));
