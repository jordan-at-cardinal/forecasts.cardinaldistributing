-- Run this once in Supabase > SQL Editor.
-- Per-user private sync; signing into the SAME account on a second device shares data.
-- No public table access and no secrets in client code.

create table if not exists public.forecast_supplier_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  supplier text not null,
  inventory jsonb not null default '[]'::jsonb,
  sales jsonb not null default '[]'::jsonb,
  coverage jsonb not null default '[]'::jsonb,
  snapshots jsonb not null default '[]'::jsonb,
  lead_days integer check(lead_days between 0 and 120),
  inventory_updated_at timestamptz,
  sales_updated_at timestamptz,
  primary key (user_id,supplier),
  check (length(supplier) between 1 and 200)
);

create table if not exists public.forecast_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  safety_pct numeric not null default 15 check(safety_pct between 0 and 100),
  status_filter text not null default 'All eligible' check(status_filter in ('All eligible','ACTIVE','SPECIAL ORDER','SEASONAL'))
);

create table if not exists public.forecast_import_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('inventory','sales','backup')),
  supplier text not null,
  products integer not null default 0 check(products >= 0),
  filename text not null default '',
  loaded_at timestamptz not null default now()
);
create index if not exists forecast_audit_user_date_idx on public.forecast_import_audit(user_id,loaded_at desc);

alter table public.forecast_supplier_state enable row level security;
alter table public.forecast_preferences enable row level security;
alter table public.forecast_import_audit enable row level security;

-- Only an authenticated user can see and modify their own rows.
create policy "forecast_state_select_owner" on public.forecast_supplier_state for select to authenticated using ((select auth.uid()) = user_id);
create policy "forecast_state_insert_owner" on public.forecast_supplier_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "forecast_state_update_owner" on public.forecast_supplier_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "forecast_state_delete_owner" on public.forecast_supplier_state for delete to authenticated using ((select auth.uid()) = user_id);

create policy "forecast_prefs_select_owner" on public.forecast_preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy "forecast_prefs_insert_owner" on public.forecast_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "forecast_prefs_update_owner" on public.forecast_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "forecast_audit_select_owner" on public.forecast_import_audit for select to authenticated using ((select auth.uid()) = user_id);
create policy "forecast_audit_insert_owner" on public.forecast_import_audit for insert to authenticated with check ((select auth.uid()) = user_id);

revoke all on table public.forecast_supplier_state, public.forecast_preferences, public.forecast_import_audit from anon;
grant select,insert,update,delete on table public.forecast_supplier_state to authenticated;
grant select,insert,update on table public.forecast_preferences to authenticated;
grant select,insert on table public.forecast_import_audit to authenticated;
grant usage,select on sequence public.forecast_import_audit_id_seq to authenticated;

-- Optional: with a new Supabase project, keep Email authentication enabled and
-- disable public signups after your intended account(s) have been created.
