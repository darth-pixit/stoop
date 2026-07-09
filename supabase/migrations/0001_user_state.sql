-- Stoop per-user state.
--
-- One row per user holds the entire Stoop store as a JSONB blob (calibration,
-- day aggregates, flex logs, exercise logs, settings). Row-Level Security ties
-- every row to its owner, so the publishable anon key that ships in the app can
-- only ever read or write the signed-in user's own row.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor
-- in your project dashboard.

create table if not exists public.user_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

-- A user may only see and modify their own row.
drop policy if exists "user_state read own"   on public.user_state;
drop policy if exists "user_state insert own" on public.user_state;
drop policy if exists "user_state update own" on public.user_state;

create policy "user_state read own"
  on public.user_state for select
  using (auth.uid() = user_id);

create policy "user_state insert own"
  on public.user_state for insert
  with check (auth.uid() = user_id);

create policy "user_state update own"
  on public.user_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep updated_at honest even if a client forgets to set it.
create or replace function public.user_state_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_state_touch on public.user_state;
create trigger user_state_touch
  before update on public.user_state
  for each row execute function public.user_state_touch();
