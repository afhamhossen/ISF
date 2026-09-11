-- ISF Business Ledger V5 schema (fresh install)
-- Adds on top of V4:
--  - Multi-business support: one account can own/join several businesses,
--    each with its own members, agents, transactions, channels and its own
--    per-business roles (a user can be super_admin in Business A and a
--    plain agent, or not a member at all, in Business B).
--  - Receipt/bill photo upload on transactions (Supabase Storage).
--  - Per-business currency.
-- Permission model changed: roles now live in business_members (per business)
-- instead of profiles.role (which is no longer used for access control).

create extension if not exists pgcrypto;

create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.businesses(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'BDT',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.business_members(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'pending' check(role in('super_admin','admin','manager','member','agent','pending')),
  created_at timestamptz not null default now(),
  unique(business_id,user_id)
);

create table if not exists public.channels(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,name text not null,active boolean not null default true,sort_order int not null default 0,created_at timestamptz not null default now(),unique(business_id,name));
create table if not exists public.members(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,name text not null,phone text,active boolean not null default true,created_at timestamptz not null default now());
create table if not exists public.agents(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,name text not null,phone text,active boolean not null default true,created_at timestamptz not null default now());

create table if not exists public.transactions(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  type text not null check(type in('collection','fund_given','expense')),
  person_type text not null check(person_type in('member','agent')),
  person_id uuid not null,
  channel text not null,
  amount numeric(14,2) not null check(amount>0),
  note text,
  receipt_url text,
  transaction_date date not null default current_date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.opening_balances(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,balance_date date not null default current_date,channel text not null,amount numeric(14,2) not null check(amount>=0),note text,created_by uuid references auth.users(id),created_at timestamptz not null default now());
create table if not exists public.daily_closings(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,closing_date date not null,total_fund numeric(14,2) not null default 0,total_collection numeric(14,2) not null default 0,total_expense numeric(14,2) not null default 0,net_result numeric(14,2) not null default 0,closed_by uuid references auth.users(id),closed_at timestamptz not null default now(),unique(business_id,closing_date));
create table if not exists public.user_permissions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,permission text not null,enabled boolean not null default false,unique(user_id,permission));
create table if not exists public.audit_logs(id uuid primary key default gen_random_uuid(),business_id uuid references public.businesses(id) on delete cascade,user_id uuid references auth.users(id),user_email text,action text not null,table_name text not null,row_id uuid,details text,created_at timestamptz not null default now());

-- V6: Cash Book and Personal Expense are standalone single-user tools (no business_id).
create table if not exists public.cashbook_entries(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,entry_date date not null default current_date,type text not null check(type in('in','out')),category text not null default 'General',channel text not null default 'Cash',amount numeric(14,2) not null check(amount>0),note text,created_at timestamptz not null default now());
create table if not exists public.personal_expenses(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,expense_date date not null default current_date,category text not null default 'Other',amount numeric(14,2) not null check(amount>0),note text,created_at timestamptz not null default now());

-- V7: Cash Book's customer/supplier due-amount ledger ("Khata").
create table if not exists public.cashbook_contacts(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,name text not null,phone text,type text not null default 'customer' check(type in('customer','supplier')),created_at timestamptz not null default now());
create table if not exists public.cashbook_ledger(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,contact_id uuid not null references public.cashbook_contacts(id) on delete cascade,entry_type text not null check(entry_type in('you_will_get','you_will_give')),amount numeric(14,2) not null check(amount>0),note text,entry_date date not null default current_date,created_at timestamptz not null default now());

create or replace function public.role_in_business(biz uuid) returns text language sql stable security definer set search_path=public as $$ select role from public.business_members where business_id=biz and user_id=auth.uid() $$;
create or replace function public.is_approved_in_business(biz uuid) returns boolean language sql stable security definer set search_path=public as $$ select coalesce((select role<>'pending' from public.business_members where business_id=biz and user_id=auth.uid()),false) $$;
create or replace function public.find_user_id_by_email(lookup_email text) returns uuid language sql stable security definer set search_path=public as $$ select id from public.profiles where email=lookup_email limit 1 $$;

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.channels enable row level security;
alter table public.members enable row level security;
alter table public.agents enable row level security;
alter table public.transactions enable row level security;
alter table public.opening_balances enable row level security;
alter table public.daily_closings enable row level security;
alter table public.user_permissions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.cashbook_entries enable row level security;
alter table public.personal_expenses enable row level security;
alter table public.cashbook_contacts enable row level security;
alter table public.cashbook_ledger enable row level security;

do $$ begin
 create policy "profiles self or shared-business read" on public.profiles for select to authenticated using(id=auth.uid() or exists(select 1 from public.business_members bm1 join public.business_members bm2 on bm1.business_id=bm2.business_id where bm1.user_id=auth.uid() and bm2.user_id=profiles.id));

 create policy "businesses member read" on public.businesses for select to authenticated using(exists(select 1 from public.business_members where business_id=businesses.id and user_id=auth.uid()));
 create policy "businesses create" on public.businesses for insert to authenticated with check(created_by=auth.uid());
 create policy "businesses admin update" on public.businesses for update to authenticated using(public.role_in_business(id) in('super_admin','admin')) with check(public.role_in_business(id) in('super_admin','admin'));

 create policy "business_members self or admin read" on public.business_members for select to authenticated using(user_id=auth.uid() or public.role_in_business(business_id) in('super_admin','admin'));
 create policy "business_members admin manage" on public.business_members for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin')) with check(public.role_in_business(business_id) in('super_admin','admin'));

 create policy "channels read" on public.channels for select to authenticated using(public.is_approved_in_business(business_id));
 create policy "channels manage" on public.channels for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

 create policy "members read" on public.members for select to authenticated using(public.is_approved_in_business(business_id));
 create policy "members manage" on public.members for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

 create policy "agents read" on public.agents for select to authenticated using(public.is_approved_in_business(business_id));
 create policy "agents manage" on public.agents for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

 create policy "transactions read" on public.transactions for select to authenticated using(public.is_approved_in_business(business_id));
 create policy "transactions insert" on public.transactions for insert to authenticated with check(public.role_in_business(business_id) in('super_admin','admin','manager','member','agent'));
 create policy "transactions update" on public.transactions for update to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));
 create policy "transactions delete" on public.transactions for delete to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager'));

 create policy "openings read" on public.opening_balances for select to authenticated using(public.is_approved_in_business(business_id));
 create policy "openings manage" on public.opening_balances for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

 create policy "closings read" on public.daily_closings for select to authenticated using(public.is_approved_in_business(business_id));
 create policy "closings manage" on public.daily_closings for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

 create policy "permissions read" on public.user_permissions for select to authenticated using(user_id=auth.uid());
 create policy "permissions manage" on public.user_permissions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

 create policy "audit read" on public.audit_logs for select to authenticated using(business_id is not null and public.role_in_business(business_id) in('super_admin','admin','manager'));
 create policy "audit insert" on public.audit_logs for insert to authenticated with check(user_id=auth.uid());

 create policy "cashbook own" on public.cashbook_entries for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
 create policy "personal expenses own" on public.personal_expenses for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
 create policy "cashbook contacts own" on public.cashbook_contacts for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
 create policy "cashbook ledger own" on public.cashbook_ledger for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
exception when duplicate_object then null; end $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,full_name,email) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),new.email) on conflict(id) do nothing;
 return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Creating a business automatically makes its creator that business's super_admin.
create or replace function public.handle_new_business() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.business_members(business_id,user_id,role) values(new.id,new.created_by,'super_admin');
 insert into public.channels(business_id,name,sort_order) values (new.id,'Cash',1),(new.id,'bKash',2),(new.id,'Nagad',3),(new.id,'Rocket',4),(new.id,'Upay',5),(new.id,'Bank',6);
 return new;
end; $$;
drop trigger if exists on_business_created on public.businesses;
create trigger on_business_created after insert on public.businesses for each row execute procedure public.handle_new_business();

-- Storage bucket for receipt / bill photos. Files are stored under
-- "<business_id>/<random>.<ext>" so upload access can be scoped per business.
insert into storage.buckets (id,name,public) values ('receipts','receipts',true) on conflict (id) do nothing;
do $$ begin
 create policy "receipts read" on storage.objects for select to public using(bucket_id='receipts');
 create policy "receipts upload approved" on storage.objects for insert to authenticated with check(bucket_id='receipts' and public.is_approved_in_business(((storage.foldername(name))[1])::uuid));
 create policy "receipts delete approved" on storage.objects for delete to authenticated using(bucket_id='receipts' and public.is_approved_in_business(((storage.foldername(name))[1])::uuid));
exception when duplicate_object then null; end $$;

-- Every user starts with zero businesses. The first thing they do after
-- signing in is either create a business (they become its super_admin) or
-- be added to an existing one by that business's admin (Users tab, by email).

-- Force PostgREST to pick up the tables/policies above immediately instead of
-- waiting for its own periodic schema-cache refresh (avoids a transient
-- "Could not find the table ... in the schema cache" error right after setup).
-- V8: Inventory, Invoices, Recurring Transactions, Budgets & Alerts, Multi-Currency (see migration_v7_to_v8.sql for upgrade notes).
-- ============ Business Ledger (business_id scoped) ============

create table if not exists public.inventory_items(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  sku text,
  unit text not null default 'pcs',
  quantity numeric(14,2) not null default 0,
  cost_price numeric(14,2) not null default 0,
  sale_price numeric(14,2) not null default 0,
  low_stock_threshold numeric(14,2) not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_movements(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  movement_type text not null check(movement_type in('in','out','adjustment')),
  quantity numeric(14,2) not null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.invoices(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_no text not null,
  customer_name text not null,
  customer_phone text,
  issue_date date not null default current_date,
  due_date date,
  status text not null default 'draft' check(status in('draft','sent','paid')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.invoice_items(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  item_id uuid references public.inventory_items(id) on delete set null,
  description text not null,
  quantity numeric(14,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.recurring_transactions(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  type text not null check(type in('collection','fund_given','expense')),
  person_type text not null default 'agent' check(person_type in('member','agent')),
  person_id uuid,
  channel text not null default 'Cash',
  amount numeric(14,2) not null check(amount>0),
  note text,
  frequency text not null default 'monthly' check(frequency in('daily','weekly','monthly')),
  next_run_date date not null default current_date,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.budgets(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null,
  month text not null,
  amount_limit numeric(14,2) not null check(amount_limit>0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(business_id,channel,month)
);

create table if not exists public.exchange_rates(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  currency text not null,
  rate numeric(18,6) not null check(rate>0),
  updated_at timestamptz not null default now(),
  unique(business_id,currency)
);

alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.recurring_transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.exchange_rates enable row level security;

do $$ begin
 create policy "inventory items read" on public.inventory_items for select to authenticated using(public.is_approved_in_business(business_id));
 create policy "inventory items manage" on public.inventory_items for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

 create policy "inventory movements read" on public.inventory_movements for select to authenticated using(public.is_approved_in_business(business_id));
 create policy "inventory movements manage" on public.inventory_movements for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

 create policy "invoices read" on public.invoices for select to authenticated using(public.is_approved_in_business(business_id));
 create policy "invoices manage" on public.invoices for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

 create policy "invoice items read" on public.invoice_items for select to authenticated using(public.is_approved_in_business(business_id));
 create policy "invoice items manage" on public.invoice_items for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

 create policy "recurring read" on public.recurring_transactions for select to authenticated using(public.is_approved_in_business(business_id));
 create policy "recurring manage" on public.recurring_transactions for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

 create policy "budgets read" on public.budgets for select to authenticated using(public.is_approved_in_business(business_id));
 create policy "budgets manage" on public.budgets for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));

 create policy "exchange rates read" on public.exchange_rates for select to authenticated using(public.is_approved_in_business(business_id));
 create policy "exchange rates manage" on public.exchange_rates for all to authenticated using(public.role_in_business(business_id) in('super_admin','admin','manager')) with check(public.role_in_business(business_id) in('super_admin','admin','manager'));
exception when duplicate_object then null; end $$;

-- ============ Cash Book (user_id scoped, single-user) ============

create table if not exists public.cashbook_inventory_items(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sku text,
  unit text not null default 'pcs',
  quantity numeric(14,2) not null default 0,
  cost_price numeric(14,2) not null default 0,
  sale_price numeric(14,2) not null default 0,
  low_stock_threshold numeric(14,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cashbook_inventory_movements(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.cashbook_inventory_items(id) on delete cascade,
  movement_type text not null check(movement_type in('in','out','adjustment')),
  quantity numeric(14,2) not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.cashbook_invoices(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_no text not null,
  customer_name text not null,
  customer_phone text,
  issue_date date not null default current_date,
  due_date date,
  status text not null default 'draft' check(status in('draft','sent','paid')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.cashbook_invoice_items(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null references public.cashbook_invoices(id) on delete cascade,
  item_id uuid references public.cashbook_inventory_items(id) on delete set null,
  description text not null,
  quantity numeric(14,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.cashbook_recurring(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check(type in('in','out')),
  category text not null default 'General',
  channel text not null default 'Cash',
  amount numeric(14,2) not null check(amount>0),
  note text,
  frequency text not null default 'monthly' check(frequency in('daily','weekly','monthly')),
  next_run_date date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cashbook_budgets(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  month text not null,
  amount_limit numeric(14,2) not null check(amount_limit>0),
  created_at timestamptz not null default now(),
  unique(user_id,category,month)
);

create table if not exists public.cashbook_exchange_rates(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null,
  rate numeric(18,6) not null check(rate>0),
  updated_at timestamptz not null default now(),
  unique(user_id,currency)
);

alter table public.cashbook_inventory_items enable row level security;
alter table public.cashbook_inventory_movements enable row level security;
alter table public.cashbook_invoices enable row level security;
alter table public.cashbook_invoice_items enable row level security;
alter table public.cashbook_recurring enable row level security;
alter table public.cashbook_budgets enable row level security;
alter table public.cashbook_exchange_rates enable row level security;

do $$ begin
 create policy "cashbook inventory items own" on public.cashbook_inventory_items for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
 create policy "cashbook inventory movements own" on public.cashbook_inventory_movements for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
 create policy "cashbook invoices own" on public.cashbook_invoices for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
 create policy "cashbook invoice items own" on public.cashbook_invoice_items for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
 create policy "cashbook recurring own" on public.cashbook_recurring for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
 create policy "cashbook budgets own" on public.cashbook_budgets for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
 create policy "cashbook exchange rates own" on public.cashbook_exchange_rates for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
exception when duplicate_object then null; end $$;

NOTIFY pgrst, 'reload schema';
