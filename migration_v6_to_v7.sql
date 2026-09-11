-- ISF Suite V7: adds a customer/supplier due-amount ledger ("Khata") inside Cash Book.
-- Single-user, same pattern as cashbook_entries/personal_expenses — no business_id,
-- just user_id = auth.uid(). Safe to run on an existing V6 project.

create table if not exists public.cashbook_contacts(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  type text not null default 'customer' check(type in('customer','supplier')),
  created_at timestamptz not null default now()
);

create table if not exists public.cashbook_ledger(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.cashbook_contacts(id) on delete cascade,
  entry_type text not null check(entry_type in('you_will_get','you_will_give')),
  amount numeric(14,2) not null check(amount>0),
  note text,
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.cashbook_contacts enable row level security;
alter table public.cashbook_ledger enable row level security;

drop policy if exists "cashbook contacts own" on public.cashbook_contacts;
create policy "cashbook contacts own" on public.cashbook_contacts for all to authenticated
  using(user_id=auth.uid()) with check(user_id=auth.uid());

drop policy if exists "cashbook ledger own" on public.cashbook_ledger;
create policy "cashbook ledger own" on public.cashbook_ledger for all to authenticated
  using(user_id=auth.uid()) with check(user_id=auth.uid());

NOTIFY pgrst, 'reload schema';
