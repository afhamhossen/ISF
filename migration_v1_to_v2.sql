-- ISF Multi-Book Ledger — V2 additions
-- Adds what the app needs for: Distributor/Party ledger (fund given/collection with a
-- running balance per party), Daily Closing, real Team invites, and Audit Log entries.
-- Additive only — safe to run on top of schema.sql, nothing is dropped.

-- Fund Given / Collection are per-party movements (money out to a distributor, money
-- collected back). Cash In / Cash Out stay as general book movements with no party.
alter type public.transaction_type add value if not exists 'fund_given';
alter type public.transaction_type add value if not exists 'collection';

create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  name text not null,
  phone text,
  party_type text not null default 'distributor' check(party_type in('distributor','customer','supplier','other')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.transactions add column if not exists party_id uuid references public.parties(id) on delete set null;

-- Lets an Admin/Primary Admin invite a teammate by email once that person has signed up
-- at least once (mirrors how book_members already needs a real profiles row).
create or replace function public.find_user_id_by_email(lookup_email text)
returns uuid language sql stable security definer set search_path=public
as $$ select id from public.profiles where email=lookup_email limit 1 $$;

alter table public.parties enable row level security;

do $$ begin
 create policy "parties visible" on public.parties for select using(public.is_book_member(book_id));
 create policy "parties manage" on public.parties for all using(public.can_write_book(book_id)) with check(public.can_write_book(book_id));
exception when duplicate_object then null; end $$;

-- Per-party running balance: sum(fund_given) - sum(collection) = what they still owe you.
create or replace function public.party_balance(p_party uuid)
returns numeric language sql stable security definer set search_path=public
as $$
 select coalesce(sum(case when transaction_type='fund_given' then amount when transaction_type='collection' then -amount else 0 end),0)
 from public.transactions where party_id=p_party
$$;

notify pgrst, 'reload schema';
