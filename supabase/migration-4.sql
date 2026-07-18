-- BodyLog 追加マイグレーション v4（1日複数記録: logsテーブル）

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  at timestamptz not null default now(),
  items jsonb not null default '[]',
  kcal numeric,
  p numeric, f numeric, c numeric,
  weight numeric,
  ex text check (ex in ('オフ','軽い','通常','高','特大')),
  adj numeric not null default 0,
  mood text not null default '',
  text text not null default '',
  photo_urls text[] not null default '{}'
);

create index if not exists logs_user_date on public.logs (user_id, date);

alter table public.logs enable row level security;
drop policy if exists "logs_own" on public.logs;
create policy "logs_own" on public.logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
