-- ISF Business Ledger V4 schema (fresh install)
-- Changes vs V3:
--  - New Google sign-ins default to role='pending' (no data access) instead of 'agent'
--  - The very first person ever to sign in automatically becomes super_admin (no manual SQL needed)
--  - Read access to business data now requires an approved (non-pending) role, not just "signed in"
--  - Payment channels moved from a hard-coded list into a manageable `channels` table
--  - audit_logs now stores the actor's email directly for easy review
--  - Fixed a bug in user_permissions RLS (was checking the wrong column)

create extension if not exists pgcrypto;

create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'pending' check(role in('super_admin','admin','manager','member','agent','pending')),
  created_at timestamptz not null default now()
);

create table if not exists public.channels(
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.members(id uuid primary key default gen_random_uuid(),name text not null,phone text,active boolean not null default true,created_at timestamptz not null default now());
create table if not exists public.agents(id uuid primary key default gen_random_uuid(),name text not null,phone text,active boolean not null default true,created_at timestamptz not null default now());

create table if not exists public.transactions(
  id uuid primary key default gen_random_uuid(),
  type text not null check(type in('collection','fund_given','expense')),
  person_type text not null check(person_type in('member','agent')),
  person_id uuid not null,
  channel text not null,
  amount numeric(14,2) not null check(amount>0),
  note text,
  transaction_date date not null default current_date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.opening_balances(
  id uuid primary key default gen_random_uuid(),
  balance_date date not null default current_date,
  channel text not null,
  amount numeric(14,2) not null check(amount>=0),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.daily_closings(id uuid primary key default gen_random_uuid(),closing_date date unique not null,total_fund numeric(14,2) not null default 0,total_collection numeric(14,2) not null default 0,total_expense numeric(14,2) not null default 0,net_result numeric(14,2) not null default 0,closed_by uuid references auth.users(id),closed_at timestamptz not null default now());
create table if not exists public.user_permissions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,permission text not null,enabled boolean not null default false,unique(user_id,permission));
create table if not exists public.audit_logs(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),user_email text,action text not null,table_name text not null,row_id uuid,details text,created_at timestamptz not null default now());

create or replace function public.current_role() returns text language sql stable security definer set search_path=public as $$ select role from public.profiles where id=auth.uid() $$;
create or replace function public.is_approved() returns boolean language sql stable security definer set search_path=public as $$ select coalesce((select role<>'pending' from public.profiles where id=auth.uid()),false) $$;

alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.members enable row level security;
alter table public.agents enable row level security;
alter table public.transactions enable row level security;
alter table public.opening_balances enable row level security;
alter table public.daily_closings enable row level security;
alter table public.user_permissions enable row level security;
alter table public.audit_logs enable row level security;

do $$ begin
 create policy "profiles self or manage read" on public.profiles for select to authenticated using(id=auth.uid() or public.current_role() in('super_admin','admin'));
 create policy "profiles admin update" on public.profiles for update to authenticated using(public.current_role() in('super_admin','admin')) with check(public.current_role() in('super_admin','admin'));

 create policy "channels read" on public.channels for select to authenticated using(public.is_approved());
 create policy "channels manage" on public.channels for all to authenticated using(public.current_role() in('super_admin','admin','manager')) with check(public.current_role() in('super_admin','admin','manager'));

 create policy "members read" on public.members for select to authenticated using(public.is_approved());
 create policy "members manage" on public.members for all to authenticated using(public.current_role() in('super_admin','admin','manager')) with check(public.current_role() in('super_admin','admin','manager'));

 create policy "agents read" on public.agents for select to authenticated using(public.is_approved());
 create policy "agents manage" on public.agents for all to authenticated using(public.current_role() in('super_admin','admin','manager')) with check(public.current_role() in('super_admin','admin','manager'));

 create policy "transactions read" on public.transactions for select to authenticated using(public.is_approved());
 create policy "transactions insert" on public.transactions for insert to authenticated with check(public.current_role() in('super_admin','admin','manager','member','agent'));
 create policy "transactions update" on public.transactions for update to authenticated using(public.current_role() in('super_admin','admin','manager')) with check(public.current_role() in('super_admin','admin','manager'));
 create policy "transactions delete" on public.transactions for delete to authenticated using(public.current_role() in('super_admin','admin','manager'));

 create policy "openings read" on public.opening_balances for select to authenticated using(public.is_approved());
 create policy "openings manage" on public.opening_balances for all to authenticated using(public.current_role() in('super_admin','admin','manager')) with check(public.current_role() in('super_admin','admin','manager'));

 create policy "closings read" on public.daily_closings for select to authenticated using(public.is_approved());
 create policy "closings manage" on public.daily_closings for all to authenticated using(public.current_role() in('super_admin','admin','manager')) with check(public.current_role() in('super_admin','admin','manager'));

 create policy "permissions read" on public.user_permissions for select to authenticated using(user_id=auth.uid() or public.current_role() in('super_admin','admin'));
 create policy "permissions manage" on public.user_permissions for all to authenticated using(public.current_role() in('super_admin','admin')) with check(public.current_role() in('super_admin','admin'));

 create policy "audit read" on public.audit_logs for select to authenticated using(public.current_role() in('super_admin','admin','manager'));
 create policy "audit insert" on public.audit_logs for insert to authenticated with check(user_id=auth.uid());
exception when duplicate_object then null; end $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare assigned_role text;
begin
 if (select count(*) from public.profiles) = 0 then assigned_role := 'super_admin'; else assigned_role := 'pending'; end if;
 insert into public.profiles(id,full_name,email,role) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),new.email,assigned_role) on conflict(id) do nothing;
 return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

insert into public.channels(name,sort_order) values ('Cash',1),('bKash',2),('Nagad',3),('Rocket',4),('Upay',5),('Bank',6) on conflict (name) do nothing;

-- The first person ever to sign in with Google automatically becomes super_admin.
-- Everyone after that starts as 'pending' and must be approved from the in-app
-- "Users" tab by a Super Admin or Admin before they can see or enter any data.
