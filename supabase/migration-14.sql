-- BodyLog 追加マイグレーション v14（筋トレ重量目標）
create table if not exists public.training_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,             -- 種目名（例: ベンチプレス）
  target_kg numeric not null,     -- 目標挙上重量
  target_date date,               -- 目標日（任意）
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.training_goals enable row level security;
drop policy if exists "training_goals_own" on public.training_goals;
create policy "training_goals_own" on public.training_goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
