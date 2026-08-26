-- BodyLog 追加マイグレーション v17（クラッシュレポート）
-- アプリのJS例外・描画エラーを自前で収集する（Sentry等の外部サービスを使わない）。
-- 書き込みはサーバ（service role）経由のみ。ユーザーからの直接insertは許可しない。
create table if not exists public.crash_reports (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid,                 -- 取れれば（未ログインのクラッシュはnull）
  platform text,                -- ios / android
  app_version text,
  fatal boolean not null default false,
  name text not null,           -- 例外名 or 発生場所
  message text not null,
  stack text
);
alter table public.crash_reports enable row level security;
-- ポリシーは作らない＝anon/authenticatedからは読めず書けず（service roleのみ）
