-- ISF Multi-Book Ledger
create extension if not exists pgcrypto;

create type public.app_role as enum ('primary_admin','admin','employee');
create type public.transaction_type as enum ('cash_in','cash_out');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role public.app_role not null default 'employee',
  created_at timestamptz not null default now()
);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  book_type text not null default 'custom',
  description text default '',
  opening_balance numeric(14,2) not null default 0,
  currency text not null default 'BDT',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.book_members (
  book_id uuid references public.books(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  can_view boolean not null default true,
  can_create boolean not null default true,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  created_at timestamptz not null default now(),
  primary key(book_id,user_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references public.books(id) on delete cascade,
  name text not null,
  type transaction_type,
  created_at timestamptz not null default now()
);

create table public.payment_modes (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references public.books(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  member_id uuid references public.profiles(id),
  category_id uuid references public.categories(id),
  payment_mode_id uuid references public.payment_modes(id),
  transaction_type public.transaction_type not null,
  amount numeric(14,2) not null check(amount > 0),
  transaction_date date not null default current_date,
  note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_closings (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  closing_date date not null,
  opening_balance numeric(14,2) not null default 0,
  total_in numeric(14,2) not null default 0,
  total_out numeric(14,2) not null default 0,
  closing_balance numeric(14,2) not null default 0,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz not null default now(),
  unique(book_id,closing_date)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  book_id uuid references public.books(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Helpers
create or replace function public.current_role()
returns public.app_role
language sql stable security definer set search_path=public
as $$ select role from public.user_roles where user_id=auth.uid() $$;

create or replace function public.is_book_member(p_book uuid)
returns boolean
language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.book_members where book_id=p_book and user_id=auth.uid() and can_view) or exists(select 1 from public.books where id=p_book and owner_id=auth.uid()) $$;

create or replace function public.can_write_book(p_book uuid)
returns boolean
language sql stable security definer set search_path=public
as $$ select public.current_role() in ('primary_admin','admin') or exists(select 1 from public.book_members where book_id=p_book and user_id=auth.uid() and can_create) or exists(select 1 from public.books where id=p_book and owner_id=auth.uid()) $$;

-- New user profile + employee role
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path=public
as $$
begin
  insert into public.profiles(id,full_name,email)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email)
  on conflict(id) do nothing;
  insert into public.user_roles(user_id,role) values(new.id,'employee')
  on conflict(user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.books enable row level security;
alter table public.book_members enable row level security;
alter table public.categories enable row level security;
alter table public.payment_modes enable row level security;
alter table public.transactions enable row level security;
alter table public.daily_closings enable row level security;
alter table public.audit_logs enable row level security;

create policy "profile self read" on public.profiles for select using(id=auth.uid() or public.current_role() in ('primary_admin','admin'));
create policy "profile self update" on public.profiles for update using(id=auth.uid());
create policy "admin roles read" on public.user_roles for select using(user_id=auth.uid() or public.current_role() in ('primary_admin','admin'));
create policy "primary admin manages roles" on public.user_roles for all using(public.current_role()='primary_admin');

create policy "books visible" on public.books for select using(owner_id=auth.uid() or public.is_book_member(id) or public.current_role() in ('primary_admin','admin'));
create policy "books create" on public.books for insert with check(owner_id=auth.uid());
create policy "books update" on public.books for update using(owner_id=auth.uid() or public.current_role() in ('primary_admin','admin'));
create policy "books delete" on public.books for delete using(owner_id=auth.uid() or public.current_role()='primary_admin');

create policy "members visible" on public.book_members for select using(public.is_book_member(book_id) or public.current_role() in ('primary_admin','admin'));
create policy "members manage" on public.book_members for all using(public.current_role() in ('primary_admin','admin') or exists(select 1 from public.books where id=book_id and owner_id=auth.uid()));

create policy "categories visible" on public.categories for select using(public.is_book_member(book_id));
create policy "categories manage" on public.categories for all using(public.can_write_book(book_id));
create policy "modes visible" on public.payment_modes for select using(public.is_book_member(book_id));
create policy "modes manage" on public.payment_modes for all using(public.can_write_book(book_id));

create policy "transactions visible" on public.transactions for select using(public.is_book_member(book_id));
create policy "transactions create" on public.transactions for insert with check(public.can_write_book(book_id) and created_by=auth.uid());
create policy "transactions update" on public.transactions for update using(public.can_write_book(book_id));
create policy "transactions delete" on public.transactions for delete using(public.current_role() in ('primary_admin','admin') or exists(select 1 from public.book_members where book_id=transactions.book_id and user_id=auth.uid() and can_delete));

create policy "closing visible" on public.daily_closings for select using(public.is_book_member(book_id));
create policy "closing write" on public.daily_closings for all using(public.can_write_book(book_id));

create policy "audit visible" on public.audit_logs for select using(user_id=auth.uid() or public.current_role() in ('primary_admin','admin'));
create policy "audit insert" on public.audit_logs for insert with check(user_id=auth.uid());

-- Summary RPC for fast dashboard calculations
create or replace function public.book_summary(p_book uuid, p_from date default null, p_to date default null)
returns table(opening numeric,total_in numeric,total_out numeric,net numeric)
language sql stable security definer set search_path=public
as $$
  select
    b.opening_balance,
    coalesce(sum(case when t.transaction_type='cash_in' then t.amount else 0 end),0),
    coalesce(sum(case when t.transaction_type='cash_out' then t.amount else 0 end),0),
    b.opening_balance
      + coalesce(sum(case when t.transaction_type='cash_in' then t.amount else 0 end),0)
      - coalesce(sum(case when t.transaction_type='cash_out' then t.amount else 0 end),0)
  from books b
  left join transactions t on t.book_id=b.id
    and (p_from is null or t.transaction_date >= p_from)
    and (p_to is null or t.transaction_date <= p_to)
  where b.id=p_book and public.is_book_member(p_book)
  group by b.id,b.opening_balance
$$;