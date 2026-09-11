-- ISF Suite V6: adds two standalone, single-user tools alongside Business Ledger.
-- Cash Book and Personal Expense are NOT scoped to a business_id — each row simply
-- belongs to the signed-in user (user_id = auth.uid()), so there is no team/role
-- concept here at all. Safe to run on an existing V5 project: only adds new tables.

create table if not exists public.cashbook_entries(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  type text not null check(type in('in','out')),
  category text not null default 'General',
  channel text not null default 'Cash',
  amount numeric(14,2) not null check(amount>0),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.personal_expenses(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expense_date date not null default current_date,
  category text not null default 'Other',
  amount numeric(14,2) not null check(amount>0),
  note text,
  created_at timestamptz not null default now()
);

alter table public.cashbook_entries enable row level security;
alter table public.personal_expenses enable row level security;

drop policy if exists "cashbook own" on public.cashbook_entries;
create policy "cashbook own" on public.cashbook_entries for all to authenticated
  using(user_id=auth.uid()) with check(user_id=auth.uid());

drop policy if exists "personal expenses own" on public.personal_expenses;
create policy "personal expenses own" on public.personal_expenses for all to authenticated
  using(user_id=auth.uid()) with check(user_id=auth.uid());

-- Refresh PostgREST's schema cache immediately (avoids a transient
-- "Could not find the table ... in the schema cache" error right after this runs).
NOTIFY pgrst, 'reload schema';
