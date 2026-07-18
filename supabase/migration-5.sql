-- BodyLog 追加マイグレーション v5（目標・予定イベント・体写真）

-- 目標（1ユーザー1行）
create table if not exists public.goals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  target_date date not null,
  target_weight numeric,
  target_bf numeric,
  note text not null default '',
  start_date date not null,
  start_weight numeric not null,
  start_bf numeric,
  activity_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.goals enable row level security;
drop policy if exists "goals_own" on public.goals;
create policy "goals_own" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 先の予定（飲み会など、カロリー増が見込まれるイベント）
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  title text not null default '',
  extra_kcal numeric not null default 800,
  created_at timestamptz not null default now()
);
create index if not exists events_user_date on public.events (user_id, date);
alter table public.events enable row level security;
drop policy if exists "events_own" on public.events;
create policy "events_own" on public.events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 体の写真（進捗記録）
create table if not exists public.body_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  path text not null,
  bf_est numeric,
  assessment text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists body_photos_user_date on public.body_photos (user_id, date);
alter table public.body_photos enable row level security;
drop policy if exists "body_photos_own" on public.body_photos;
create policy "body_photos_own" on public.body_photos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 体写真バケット（非公開・本人のみ）
insert into storage.buckets (id, name, public)
values ('body', 'body', false)
on conflict (id) do nothing;

drop policy if exists "body_own_select" on storage.objects;
create policy "body_own_select" on storage.objects for select
  using (bucket_id = 'body' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "body_own_insert" on storage.objects;
create policy "body_own_insert" on storage.objects for insert
  with check (bucket_id = 'body' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "body_own_delete" on storage.objects;
create policy "body_own_delete" on storage.objects for delete
  using (bucket_id = 'body' and auth.uid()::text = (storage.foldername(name))[1]);
