-- ISF Business Ledger V3 schema
create extension if not exists pgcrypto;
create table if not exists public.profiles(id uuid primary key references auth.users(id) on delete cascade,full_name text,email text,role text not null default 'agent' check(role in('super_admin','admin','manager','member','agent')),created_at timestamptz not null default now());
create table if not exists public.members(id uuid primary key default gen_random_uuid(),name text not null,phone text,active boolean not null default true,created_at timestamptz not null default now());
create table if not exists public.agents(id uuid primary key default gen_random_uuid(),name text not null,phone text,active boolean not null default true,created_at timestamptz not null default now());
create table if not exists public.transactions(id uuid primary key default gen_random_uuid(),type text not null check(type in('collection','fund_given','expense')),person_type text not null check(person_type in('member','agent')),person_id uuid not null,channel text not null check(channel in('bKash','Nagad','Rocket','Upay','Bank','Cash')),amount numeric(14,2) not null check(amount>0),note text,transaction_date date not null default current_date,created_by uuid references auth.users(id),created_at timestamptz not null default now());
create table if not exists public.opening_balances(id uuid primary key default gen_random_uuid(),balance_date date not null default current_date,channel text not null check(channel in('bKash','Nagad','Rocket','Upay','Bank','Cash')),amount numeric(14,2) not null check(amount>=0),note text,created_by uuid references auth.users(id),created_at timestamptz not null default now());
create table if not exists public.daily_closings(id uuid primary key default gen_random_uuid(),closing_date date unique not null,total_fund numeric(14,2) not null default 0,total_collection numeric(14,2) not null default 0,total_expense numeric(14,2) not null default 0,net_result numeric(14,2) not null default 0,closed_by uuid references auth.users(id),closed_at timestamptz not null default now());
create table if not exists public.user_permissions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,permission text not null,enabled boolean not null default false,unique(user_id,permission));
create table if not exists public.audit_logs(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),action text not null,table_name text not null,row_id uuid,details text,created_at timestamptz not null default now());

create or replace function public.current_role() returns text language sql stable security definer set search_path=public as $$ select role from public.profiles where id=auth.uid() $$;

alter table public.profiles enable row level security;alter table public.members enable row level security;alter table public.agents enable row level security;alter table public.transactions enable row level security;alter table public.opening_balances enable row level security;alter table public.daily_closings enable row level security;alter table public.user_permissions enable row level security;alter table public.audit_logs enable row level security;

do $$ begin
 create policy "profiles self read" on public.profiles for select to authenticated using(id=auth.uid() or public.current_role()='super_admin');
 create policy "profiles admin update" on public.profiles for update to authenticated using(public.current_role()='super_admin') with check(public.current_role()='super_admin');
 create policy "members read" on public.members for select to authenticated using(true);
 create policy "members manage" on public.members for all to authenticated using(public.current_role() in('super_admin','admin','manager')) with check(public.current_role() in('super_admin','admin','manager'));
 create policy "agents read" on public.agents for select to authenticated using(true);
 create policy "agents manage" on public.agents for all to authenticated using(public.current_role() in('super_admin','admin','manager')) with check(public.current_role() in('super_admin','admin','manager'));
 create policy "transactions read" on public.transactions for select to authenticated using(true);
 create policy "transactions insert" on public.transactions for insert to authenticated with check(public.current_role() in('super_admin','admin','manager','member','agent'));
 create policy "transactions update" on public.transactions for update to authenticated using(public.current_role() in('super_admin','admin','manager')) with check(public.current_role() in('super_admin','admin','manager'));
 create policy "transactions delete" on public.transactions for delete to authenticated using(public.current_role() in('super_admin','admin','manager'));
 create policy "openings read" on public.opening_balances for select to authenticated using(true);
 create policy "openings manage" on public.opening_balances for all to authenticated using(public.current_role() in('super_admin','admin','manager')) with check(public.current_role() in('super_admin','admin','manager'));
 create policy "closings read" on public.daily_closings for select to authenticated using(true);
 create policy "closings manage" on public.daily_closings for all to authenticated using(public.current_role() in('super_admin','admin','manager')) with check(public.current_role() in('super_admin','admin','manager'));
 create policy "permissions read" on public.user_permissions for select to authenticated using(id=auth.uid() or public.current_role()='super_admin');
 create policy "permissions manage" on public.user_permissions for all to authenticated using(public.current_role()='super_admin') with check(public.current_role()='super_admin');
 create policy "audit read" on public.audit_logs for select to authenticated using(public.current_role() in('super_admin','admin','manager'));
 create policy "audit insert" on public.audit_logs for insert to authenticated with check(user_id=auth.uid());
exception when duplicate_object then null; end $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.profiles(id,full_name,email) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),new.email) on conflict(id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
-- First login: update public.profiles set role='super_admin' where email='YOUR-GMAIL@example.com';
