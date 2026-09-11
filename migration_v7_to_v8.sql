-- ISF Suite V8: Inventory, Invoices, Recurring Transactions, Budgets & Alerts,
-- and Multi-Currency Display — added to BOTH Business Ledger (business_id scoped,
-- same role model as existing tables) and Cash Book (user_id scoped, single-user,
-- same pattern as cashbook_entries). Analytics needs no new tables (computed
-- client-side from existing + these new rows). Safe to run on an existing V7 project.

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
