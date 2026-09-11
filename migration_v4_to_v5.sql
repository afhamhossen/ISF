-- ISF Business Ledger: V4 -> V5 migration
-- Run this AFTER migration_v3_to_v4.sql has already been applied
-- (if you haven't run that one yet, run it first).
--
-- This turns your single-business setup into "Business #1" inside the new
-- multi-business model. NOTHING is deleted. All your existing members,
-- agents, transactions, channels, openings and closings are preserved and
-- automatically attached to that one business. Everyone who currently has
-- an approved role keeps that exact role, now scoped to Business #1.

-- 1) New tables
create table if not exists public.businesses(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'BDT',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.businesses enable row level security;

create table if not exists public.business_members(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'pending' check(role in('super_admin','admin','manager','member','agent','pending')),
  created_at timestamptz not null default now(),
  unique(business_id,user_id)
);
alter table public.business_members enable row level security;

-- 2) Receipt photo support + per-business columns on existing tables
alter table public.transactions add column if not exists receipt_url text;
alter table public.audit_logs add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.channels add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.members add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.agents add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.transactions add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.opening_balances add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.daily_closings add column if not exists business_id uuid references public.businesses(id) on delete cascade;

-- 3) Create "Business #1" from your current data and attach everything to it
do $$
declare biz_id uuid; admin_id uuid;
begin
  if not exists (select 1 from public.businesses) then
    select id into admin_id from public.profiles order by created_at limit 1;
    insert into public.businesses(name,currency,created_by) values ('My Business','BDT',admin_id) returning id into biz_id;

    update public.members set business_id=biz_id where business_id is null;
    update public.agents set business_id=biz_id where business_id is null;
    update public.transactions set business_id=biz_id where business_id is null;
    update public.opening_balances set business_id=biz_id where business_id is null;
    update public.daily_closings set business_id=biz_id where business_id is null;
    update public.channels set business_id=biz_id where business_id is null;
    update public.audit_logs set business_id=biz_id where business_id is null;

    -- Bring across each existing user's current (V4) role as their role in Business #1
    insert into public.business_members(business_id,user_id,role)
      select biz_id, id, coalesce(role,'pending') from public.profiles
      on conflict(business_id,user_id) do nothing;
  end if;
end $$;

-- 4) Now that every row has a business, make the column required
alter table public.members alter column business_id set not null;
alter table public.agents alter column business_id set not null;
alter table public.transactions alter column business_id set not null;
alter table public.opening_balances alter column business_id set not null;
alter table public.daily_closings alter column business_id set not null;
alter table public.channels alter column business_id set not null;
-- audit_logs.business_id stays nullable: very old entries may pre-date this migration

-- 5) closing_date and channel name were globally unique; they must now be
--    unique per business instead (two different businesses can both use "Cash")
do $$
declare r record;
begin
 for r in select conname from pg_constraint where conrelid='public.daily_closings'::regclass and contype='u'
 loop execute format('alter table public.daily_closings drop constraint %I', r.conname); end loop;
 for r in select conname from pg_constraint where conrelid='public.channels'::regclass and contype='u'
 loop execute format('alter table public.channels drop constraint %I', r.conname); end loop;
end $$;
alter table public.daily_closings add constraint daily_closings_business_date_key unique(business_id,closing_date);
alter table public.channels add constraint channels_business_name_key unique(business_id,name);

-- 6) Helper functions used by the new, business-scoped RLS policies
create or replace function public.role_in_business(biz uuid) returns text language sql stable security definer set search_path=public as $$ select role from public.business_members where business_id=biz and user_id=auth.uid() $$;
create or replace function public.is_approved_in_business(biz uuid) returns boolean language sql stable security definer set search_path=public as $$ select coalesce((select role<>'pending' from public.business_members where business_id=biz and user_id=auth.uid()),false) $$;
create or replace function public.find_user_id_by_email(lookup_email text) returns uuid language sql stable security definer set search_path=public as $$ select id from public.profiles where email=lookup_email limit 1 $$;

-- 7) New sign-up trigger: profiles no longer carries a role at all
--    (roles now live per-business in business_members)
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,full_name,email) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),new.email) on conflict(id) do nothing;
 return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Creating a business automatically makes its creator that business's super_admin
-- and seeds it with the 6 default payment channels.
create or replace function public.handle_new_business() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.business_members(business_id,user_id,role) values(new.id,new.created_by,'super_admin');
 insert into public.channels(business_id,name,sort_order) values (new.id,'Cash',1),(new.id,'bKash',2),(new.id,'Nagad',3),(new.id,'Rocket',4),(new.id,'Upay',5),(new.id,'Bank',6) on conflict do nothing;
 return new;
end; $$;
drop trigger if exists on_business_created on public.businesses;
create trigger on_business_created after insert on public.businesses for each row execute procedure public.handle_new_business();

-- 8) Receipt photo storage bucket
insert into storage.buckets (id,name,public) values ('receipts','receipts',true) on conflict (id) do nothing;
drop policy if exists "receipts read" on storage.objects;
create policy "receipts read" on storage.objects for select to public using(bucket_id='receipts');
drop policy if exists "receipts upload approved" on storage.objects;
create policy "receipts upload approved" on storage.objects for insert to authenticated with check(bucket_id='receipts' and public.is_approved_in_business(((storage.foldername(name))[1])::uuid));
drop policy if exists "receipts delete approved" on storage.objects;
create policy "receipts delete approved" on storage.objects for delete to authenticated using(bucket_id='receipts' and public.is_approved_in_business(((storage.foldername(name))[1])::uuid));

-- 9) DROP the old V4 policies (they checked "is this user approved ANYWHERE",
--    with no business filter at all — leaving them in place would let any
--    approved user in Business A read Business B's data once business_id
--    exists). Replace every one with a business-scoped version.
drop policy if exists "profiles self or manage read" on public.profiles;
drop policy if exists "profiles admin update" on public.profiles;
drop policy if exists "profiles self or shared-business read" on public.profiles;
create policy "profiles self or shared-business read" on public.profiles for select to authenticated using(id=auth.uid() or exists(select 1 from public.business_members bm1 join public.business_members bm2 on bm1.business_id=bm2.business_id where bm1.user_id=auth.uid() and bm2.user_id=profiles.id));

drop policy if exists "businesses member read" on public.businesses;
create policy "businesses member read" on public.businesses for select to authenticated using(exists(select 1 from public.business_members where business_id=businesses.id and user_id=auth.uid()));
drop policy if exists "businesses create" on public.businesses;
create policy "businesses create" on public.businesses for insert to authenticated with check(created_by=auth.uid());
drop policy if exists "businesses admin update" on public.businesses;
create policy "businesses admin update" on public.businesses for update to authenticated using(public.role_in_business(id) in('super_admin','admin')) with check(public.role_in_business(id) in('super_admin','admin'));

drop policy if exists "business_members self or admin read" on public.business_members;
create policy "business_members self or admin read" on public.business_members for select to authenticated using(user_id=auth.uid() or public.role_in_business(business_id) in('super_admin','admin'));
drop policy if exists "business_members admin manage" on public.business_members;
create policy "business_members admin manage" on public.business_members for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin')) with check(public.role_in_business(business_id) in('super_admin','admin'));

drop policy if exists "channels read" on public.channels;
create policy "channels read" on public.channels for select to authenticated using(public.is_approved_in_business(business_id));
drop policy if exists "channels manage" on public.channels;
create policy "channels manage" on public.channels for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

drop policy if exists "members read" on public.members;
create policy "members read" on public.members for select to authenticated using(public.is_approved_in_business(business_id));
drop policy if exists "members manage" on public.members;
create policy "members manage" on public.members for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

drop policy if exists "agents read" on public.agents;
create policy "agents read" on public.agents for select to authenticated using(public.is_approved_in_business(business_id));
drop policy if exists "agents manage" on public.agents;
create policy "agents manage" on public.agents for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

drop policy if exists "transactions read" on public.transactions;
create policy "transactions read" on public.transactions for select to authenticated using(public.is_approved_in_business(business_id));
drop policy if exists "transactions insert" on public.transactions;
create policy "transactions insert" on public.transactions for insert to authenticated with check(public.role_in_business(business_id) in('super_admin','admin','manager','member','agent'));
drop policy if exists "transactions update" on public.transactions;
create policy "transactions update" on public.transactions for update to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));
drop policy if exists "transactions delete" on public.transactions;
create policy "transactions delete" on public.transactions for delete to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager'));

drop policy if exists "openings read" on public.opening_balances;
create policy "openings read" on public.opening_balances for select to authenticated using(public.is_approved_in_business(business_id));
drop policy if exists "openings manage" on public.opening_balances;
create policy "openings manage" on public.opening_balances for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

drop policy if exists "closings read" on public.daily_closings;
create policy "closings read" on public.daily_closings for select to authenticated using(public.is_approved_in_business(business_id));
drop policy if exists "closings manage" on public.daily_closings;
create policy "closings manage" on public.daily_closings for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

drop policy if exists "permissions read" on public.user_permissions;
create policy "permissions read" on public.user_permissions for select to authenticated using(user_id=auth.uid());
drop policy if exists "permissions manage" on public.user_permissions;
create policy "permissions manage" on public.user_permissions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

drop policy if exists "audit read" on public.audit_logs;
create policy "audit read" on public.audit_logs for select to authenticated using(business_id is not null and public.role_in_business(business_id) in('super_admin','admin','manager'));

-- Done. Log in and you'll land straight in "My Business" with everything
-- exactly as it was. Use Settings to rename it or change its currency, and
-- the new business switcher (top of the app) to create additional businesses.

-- Refresh PostgREST's schema cache immediately (avoids a transient
-- "Could not find the table ... in the schema cache" error right after this runs).
NOTIFY pgrst, 'reload schema';
