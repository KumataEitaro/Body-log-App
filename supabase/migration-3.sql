-- BodyLog 追加マイグレーション v3（マイ食品・マイレシピ登録）

create table if not exists public.my_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null default 'food' check (kind in ('food','recipe')),
  unit text not null default '1人前',
  kcal numeric not null default 0,
  p numeric not null default 0,
  f numeric not null default 0,
  c numeric not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.my_foods enable row level security;
drop policy if exists "my_foods_own" on public.my_foods;
create policy "my_foods_own" on public.my_foods
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
