-- ISF Business Ledger: V3 -> V4 migration
-- Safe to run on your EXISTING Supabase project. Does not delete any data
-- and does not change any current user's role. Run this once in the
-- Supabase SQL Editor, then redeploy the updated app code.

-- 1) Audit log: also store the actor's email for easy reading
alter table public.audit_logs add column if not exists user_email text;

-- 2) Dynamic payment channels (replaces the hard-coded 6-channel list)
create table if not exists public.channels(
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.channels enable row level security;
insert into public.channels(name,sort_order) values ('Cash',1),('bKash',2),('Nagad',3),('Rocket',4),('Upay',5),('Bank',6) on conflict (name) do nothing;

-- 3) Drop the old hard-coded channel check constraints so new custom
--    channels can be used on transactions / opening balances
do $$
declare r record;
begin
 for r in select conname from pg_constraint where conrelid='public.transactions'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%channel%'
 loop execute format('alter table public.transactions drop constraint %I', r.conname); end loop;
 for r in select conname from pg_constraint where conrelid='public.opening_balances'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%channel%'
 loop execute format('alter table public.opening_balances drop constraint %I', r.conname); end loop;
end $$;

-- 4) profiles: allow a 'pending' role, and make it the default for new signups
alter table public.profiles alter column role set default 'pending';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in('super_admin','admin','manager','member','agent','pending'));
-- Note: this does NOT touch any existing user's current role.

-- 5) Helper used by RLS: is the signed-in user approved (i.e. not pending)?
create or replace function public.is_approved() returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select role<>'pending' from public.profiles where id=auth.uid()),false)
$$;

-- 6) Sign-up trigger: the first-ever user becomes super_admin automatically;
--    everyone who signs up after that starts 'pending' until approved in the Users tab
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare assigned_role text;
begin
 if (select count(*) from public.profiles) = 0 then assigned_role := 'super_admin'; else assigned_role := 'pending'; end if;
 insert into public.profiles(id,full_name,email,role) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),new.email,assigned_role) on conflict(id) do nothing;
 return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- 7) THE ACTUAL SECURITY FIX: reading business data now requires an
--    approved (non-pending) account, not merely "signed in with any Google account"
drop policy if exists "profiles self read" on public.profiles;
drop policy if exists "profiles self or manage read" on public.profiles;
create policy "profiles self or manage read" on public.profiles for select to authenticated using(id=auth.uid() or public.current_role() in('super_admin','admin'));

drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles for update to authenticated using(public.current_role() in('super_admin','admin')) with check(public.current_role() in('super_admin','admin'));

drop policy if exists "channels read" on public.channels;
create policy "channels read" on public.channels for select to authenticated using(public.is_approved());
drop policy if exists "channels manage" on public.channels;
create policy "channels manage" on public.channels for all to authenticated using(public.current_role() in('super_admin','admin','manager')) with check(public.current_role() in('super_admin','admin','manager'));

drop policy if exists "members read" on public.members;
create policy "members read" on public.members for select to authenticated using(public.is_approved());

drop policy if exists "agents read" on public.agents;
create policy "agents read" on public.agents for select to authenticated using(public.is_approved());

drop policy if exists "transactions read" on public.transactions;
create policy "transactions read" on public.transactions for select to authenticated using(public.is_approved());

drop policy if exists "openings read" on public.opening_balances;
create policy "openings read" on public.opening_balances for select to authenticated using(public.is_approved());

drop policy if exists "closings read" on public.daily_closings;
create policy "closings read" on public.daily_closings for select to authenticated using(public.is_approved());

-- Bug fix: original policy checked user_permissions.id instead of .user_id,
-- so a normal user could never read their own permission rows.
drop policy if exists "permissions read" on public.user_permissions;
create policy "permissions read" on public.user_permissions for select to authenticated using(user_id=auth.uid() or public.current_role() in('super_admin','admin'));
drop policy if exists "permissions manage" on public.user_permissions;
create policy "permissions manage" on public.user_permissions for all to authenticated using(public.current_role() in('super_admin','admin')) with check(public.current_role() in('super_admin','admin'));

-- Done. Existing users keep working exactly as before. Any NEW Google
-- sign-in from now on lands on a "pending approval" screen and cannot see
-- or touch any data until you approve them from the app's Users tab.
