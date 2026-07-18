-- BodyLog 追加マイグレーション v2（写真添付 + AI使用回数制限）
-- Supabase SQL Editor に貼って Run

-- 1) 記録に写真パス列を追加
alter table public.entries add column if not exists photo_urls text[] not null default '{}';

-- 2) AI解析の1日あたり使用回数カウンタ
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  count int not null default 0,
  primary key (user_id, date)
);
alter table public.ai_usage enable row level security;
drop policy if exists "ai_usage_own" on public.ai_usage;
create policy "ai_usage_own" on public.ai_usage
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) 食事写真バケット（非公開・本人のみ読み書き）
insert into storage.buckets (id, name, public)
values ('meals', 'meals', false)
on conflict (id) do nothing;

drop policy if exists "meals_own_select" on storage.objects;
create policy "meals_own_select" on storage.objects for select
  using (bucket_id = 'meals' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "meals_own_insert" on storage.objects;
create policy "meals_own_insert" on storage.objects for insert
  with check (bucket_id = 'meals' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "meals_own_delete" on storage.objects;
create policy "meals_own_delete" on storage.objects for delete
  using (bucket_id = 'meals' and auth.uid()::text = (storage.foldername(name))[1]);
