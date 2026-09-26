-- migration-39（2026-09-26）体の写真（body_photos）の復活: テーブル・RLS・非公開バケット・ストレージポリシー
-- 実行先: https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
-- 何度実行しても安全（if not exists / drop policy if exists / on conflict）。
--
-- 背景: 2026-09-05〜18 に「写真の保存に失敗する」で機能を取り下げた（ef91b51）。
--   ・supabase/schema.sql に body_photos が無い（apply-pending.sql の v16 と fix-body-photos.sql にしか無い）
--     ＝本番 DB にテーブル／バケットが無い、または作った後に PostgREST のスキーマキャッシュが古いままで
--       API がテーブルを知らなかった可能性が高い（旧 UI の「記録の保存に失敗しました」は insert 側の失敗）
--   ・この SQL は fix-body-photos.sql を今の設計に合わせて整理したもの。実行後にアプリ側は
--     lib/bodyPhotos.ts が「どの段で何が失敗したか」を画面に出すので、まだ失敗するなら本文を見れば分かる。
--
-- 使い方: このファイル全体を SQL Editor に貼って Run。最後の select が 1,1,1,1,1 なら準備完了。

-- 1) 体脂肪率の列（v16 と同じ。既にあれば何もしない）
alter table public.goals   add column if not exists target_bodyfat numeric;
alter table public.entries add column if not exists bodyfat numeric;
alter table public.logs    add column if not exists bodyfat numeric;

-- 2) 写真の行（1枚1行）。path は Storage 上の '<user_id>/<date>-<nonce>.jpg'。
--    user_id は既定で auth.uid()（アプリは明示的にも渡す。RLS の with check と一致する）
create table if not exists public.body_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  path text not null,
  bodyfat numeric,
  note text,
  created_at timestamptz not null default now()
);
alter table public.body_photos alter column user_id set default auth.uid();
create index if not exists body_photos_user_date_idx on public.body_photos (user_id, date desc, created_at desc);
alter table public.body_photos enable row level security;
drop policy if exists "body_photos_own" on public.body_photos;
create policy "body_photos_own" on public.body_photos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) 非公開バケット（署名付き URL でだけ読める。公開に倒さない）
insert into storage.buckets (id, name, public) values ('body-photos', 'body-photos', false)
  on conflict (id) do update set public = false;

-- 4) ストレージのポリシー: 自分のフォルダ（<user_id>/…）だけ 読む／上げる／消す
drop policy if exists "body_photos_storage_own" on storage.objects;
create policy "body_photos_storage_own" on storage.objects
  for all to authenticated
  using (bucket_id = 'body-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'body-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ==================== 確認（期待値: すべて 1） ====================
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name = 'body_photos') as "table",
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'body_photos' and policyname = 'body_photos_own') as "policy",
  (select count(*) from storage.buckets where id = 'body-photos' and public = false) as "bucket_private",
  (select count(*) from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'body_photos_storage_own') as "storage_policy",
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'entries' and column_name = 'bodyfat') as "entries_bodyfat";

-- API のスキーマキャッシュを更新（これが無いと新しいテーブルを API が知らず、insert が PGRST205 で失敗する）
notify pgrst, 'reload schema';
