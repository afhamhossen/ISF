-- ISF Suite V8 -> V9
-- Adds the "CashBook Pro" module: a Business (workspace) can hold many
-- independent Books (Day Book, Investments, Project Book, Client Record...),
-- each with its own entries, opening balance, categories, payment modes and
-- activity log — mirroring the reference app's Business -> Books -> Entries
-- hierarchy. Reuses the existing public.businesses / public.business_members
-- tables for the workspace + Primary Admin/Admin roles; adds a book-level
-- membership table for Employee roles (Book Admin / Data Operator / Viewer)
-- that only see the books they're added to.

create table if not exists public.cbp_books(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  access_mode text not null default 'just_me' check(access_mode in('just_me','team')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  archived boolean not null default false
);

-- Employee-level access to a specific book. Primary Admin/Admin (in
-- business_members) already have full access to every book in the business
-- and don't need a row here.
create table if not exists public.cbp_book_members(
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.cbp_books(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'viewer' check(role in('book_admin','data_operator','viewer')),
  created_at timestamptz not null default now(),
  unique(book_id,user_id)
);

create table if not exists public.cbp_categories(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(business_id,name)
);

create table if not exists public.cbp_payment_modes(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(business_id,name)
);

create table if not exists public.cbp_contacts(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.cbp_opening_balances(
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.cbp_books(id) on delete cascade,
  balance_date date not null default current_date,
  amount numeric(14,2) not null default 0,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.cbp_entries(
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.cbp_books(id) on delete cascade,
  entry_date date not null default current_date,
  type text not null check(type in('in','out')),
  amount numeric(14,2) not null check(amount>0),
  category text,
  payment_mode text default 'Cash',
  contact_id uuid references public.cbp_contacts(id) on delete set null,
  remark text,
  attachment_url text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.cbp_book_activity(
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.cbp_books(id) on delete cascade,
  user_email text,
  action text not null,
  details text,
  created_at timestamptz not null default now()
);

create index if not exists cbp_entries_book_date_idx on public.cbp_entries(book_id,entry_date);
create index if not exists cbp_books_business_idx on public.cbp_books(business_id);

-- Extra Business Profile fields (address, employee size, category, mobile...)
-- used by CashBook Pro's Business Profile screen. Kept as one jsonb column so
-- we don't need a fresh migration every time a new profile field is added.
alter table public.businesses add column if not exists profile_meta jsonb not null default '{}'::jsonb;

-- ---- Helpers -------------------------------------------------------------

create or replace function public.cbp_has_book_access(p_book_id uuid)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from public.cbp_books b
    where b.id=p_book_id and (
      public.role_in_business(b.business_id) in('super_admin','admin')
      or exists(select 1 from public.cbp_book_members m where m.book_id=b.id and m.user_id=auth.uid())
    )
  );
$$;

create or replace function public.cbp_can_edit_book(p_book_id uuid)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from public.cbp_books b
    where b.id=p_book_id and (
      public.role_in_business(b.business_id) in('super_admin','admin')
      or exists(select 1 from public.cbp_book_members m where m.book_id=b.id and m.user_id=auth.uid() and m.role in('book_admin','data_operator'))
    )
  );
$$;

-- ---- RLS ------------------------------------------------------------------

alter table public.cbp_books enable row level security;
alter table public.cbp_book_members enable row level security;
alter table public.cbp_categories enable row level security;
alter table public.cbp_payment_modes enable row level security;
alter table public.cbp_contacts enable row level security;
alter table public.cbp_opening_balances enable row level security;
alter table public.cbp_entries enable row level security;
alter table public.cbp_book_activity enable row level security;

drop policy if exists "cbp_books read" on public.cbp_books;
create policy "cbp_books read" on public.cbp_books for select to authenticated
  using(public.cbp_has_book_access(id));

drop policy if exists "cbp_books manage" on public.cbp_books;
create policy "cbp_books manage" on public.cbp_books for all to authenticated
  using(public.role_in_business(business_id) in('super_admin','admin'))
  with check(public.role_in_business(business_id) in('super_admin','admin'));

drop policy if exists "cbp_book_members read" on public.cbp_book_members;
create policy "cbp_book_members read" on public.cbp_book_members for select to authenticated
  using(user_id=auth.uid() or public.cbp_has_book_access(book_id));

drop policy if exists "cbp_book_members manage" on public.cbp_book_members;
create policy "cbp_book_members manage" on public.cbp_book_members for all to authenticated
  using(exists(select 1 from public.cbp_books b where b.id=book_id and public.role_in_business(b.business_id) in('super_admin','admin')))
  with check(exists(select 1 from public.cbp_books b where b.id=book_id and public.role_in_business(b.business_id) in('super_admin','admin')));

drop policy if exists "cbp_categories rw" on public.cbp_categories;
create policy "cbp_categories rw" on public.cbp_categories for all to authenticated
  using(public.is_approved_in_business(business_id)) with check(public.is_approved_in_business(business_id));

drop policy if exists "cbp_payment_modes rw" on public.cbp_payment_modes;
create policy "cbp_payment_modes rw" on public.cbp_payment_modes for all to authenticated
  using(public.is_approved_in_business(business_id)) with check(public.is_approved_in_business(business_id));

drop policy if exists "cbp_contacts rw" on public.cbp_contacts;
create policy "cbp_contacts rw" on public.cbp_contacts for all to authenticated
  using(public.is_approved_in_business(business_id)) with check(public.is_approved_in_business(business_id));

drop policy if exists "cbp_opening_balances rw" on public.cbp_opening_balances;
create policy "cbp_opening_balances rw" on public.cbp_opening_balances for all to authenticated
  using(public.cbp_has_book_access(book_id)) with check(public.cbp_can_edit_book(book_id));

drop policy if exists "cbp_entries read" on public.cbp_entries;
create policy "cbp_entries read" on public.cbp_entries for select to authenticated
  using(public.cbp_has_book_access(book_id));

drop policy if exists "cbp_entries write" on public.cbp_entries;
create policy "cbp_entries write" on public.cbp_entries for insert to authenticated
  with check(public.cbp_can_edit_book(book_id));

drop policy if exists "cbp_entries update" on public.cbp_entries;
create policy "cbp_entries update" on public.cbp_entries for update to authenticated
  using(public.cbp_can_edit_book(book_id)) with check(public.cbp_can_edit_book(book_id));

drop policy if exists "cbp_entries delete" on public.cbp_entries;
create policy "cbp_entries delete" on public.cbp_entries for delete to authenticated
  using(public.cbp_can_edit_book(book_id));

drop policy if exists "cbp_book_activity read" on public.cbp_book_activity;
create policy "cbp_book_activity read" on public.cbp_book_activity for select to authenticated
  using(public.cbp_has_book_access(book_id));

drop policy if exists "cbp_book_activity insert" on public.cbp_book_activity;
create policy "cbp_book_activity insert" on public.cbp_book_activity for insert to authenticated
  with check(public.cbp_has_book_access(book_id));

-- Run this file after migration_v7_to_v8.sql. It only adds new cbp_* tables,
-- so it's safe to run on an existing V8 database without touching your
-- current Business Ledger / Cash Book / Personal Expense data.
