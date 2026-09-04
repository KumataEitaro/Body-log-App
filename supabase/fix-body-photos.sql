-- ============================================================
-- BodyLog: 体の写真（body_photos）が保存できないときの修復 SQL（2026-09-05）
-- 実行先: https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 症状: 写真のアップロードは通るのに「記録の保存に失敗しました」と出る。
-- 原因の候補: body_photos テーブルが無い（apply-pending.sql の v16 が未適用）／RLS ポリシーが無い／
--            entries.bodyfat 列が無い。この SQL は全て再実行安全（if not exists / drop policy if exists）。
-- ============================================================

-- v16: 体脂肪率目標＋週1体写真（apply-pending.sql と同一内容）
alter table public.goals   add column if not exists target_bodyfat numeric;
alter table public.entries add column if not exists bodyfat numeric;
alter table public.logs    add column if not exists bodyfat numeric;

create table if not exists public.body_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  path text not null,
  bodyfat numeric,
  note text,
  created_at timestamptz not null default now()
);
alter table public.body_photos enable row level security;
drop policy if exists "body_photos_own" on public.body_photos;
create policy "body_photos_own" on public.body_photos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 写真本体は非公開バケットに保存（パスは <user_id>/... 固定で RLS）
insert into storage.buckets (id, name, public) values ('body-photos', 'body-photos', false)
  on conflict (id) do nothing;
drop policy if exists "body_photos_storage_own" on storage.objects;
create policy "body_photos_storage_own" on storage.objects
  for all using (bucket_id = 'body-photos' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'body-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- ==================== 確認（期待値: table=1 / policy=1 / bucket=1 / entries_bodyfat=1） ====================
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name = 'body_photos') as "table",
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'body_photos' and policyname = 'body_photos_own') as "policy",
  (select count(*) from storage.buckets where id = 'body-photos') as "bucket",
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'entries' and column_name = 'bodyfat') as "entries_bodyfat";
