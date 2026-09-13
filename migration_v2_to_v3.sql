-- ISF Multi-Book Ledger — V3 additions
-- Adds the single shared Business Profile row used by Settings > Business.
-- Additive only — safe to run on top of schema.sql + migration_v1_to_v2.sql.

create table if not exists public.business_profile (
  id boolean primary key default true check (id), -- singleton row, one business per deployment
  name text default '',
  address text default '',
  employees text default '',
  category text default '',
  subcategory text default '',
  biz_type text default '',
  reg_no text default '',
  mobile text default '',
  email text default '',
  updated_at timestamptz not null default now()
);

insert into public.business_profile(id) values(true) on conflict (id) do nothing;

alter table public.business_profile enable row level security;

do $$ begin
 create policy "business visible to signed-in users" on public.business_profile
  for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;

do $$ begin
 create policy "business editable by admins" on public.business_profile
  for all using (public.current_role() in ('primary_admin','admin'))
  with check (public.current_role() in ('primary_admin','admin'));
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
