-- BodyLog 追加マイグレーション v34（2026-09-18）
-- 実行場所: Supabase ダッシュボード → SQL Editor（https://supabase.com/dashboard/project/_/sql/new）
-- 冪等（何度流しても同じ結果）。
--
-- 1) ai_usage の**書き込みを利用者本人から外す**（QA P1-7 後半／TODO B14・課金点火 A9 の前提）
--    これまで RLS が「本人なら全操作可」だったため、アプリを介さず自分の行を count=0 に戻せた。
--    加算は API（service role・lib/aiUsage.ts）だけが行う。本人は自分の使用回数を**読める**だけ。
-- 2) coupon_attempts: クーポンコードの試行回数（1人1日あたりの上限。QA C-3・コードの有効性オラクル対策）
-- 3) i18n_requests:  UI翻訳の新規依頼件数（1人1日あたりの上限。QA C-8・上限なし LLM プロキシ対策）
--    2) 3) は service role だけが書く（利用者向けのポリシーは作らない＝RLS 有効・ポリシー無し）。

-- ===== 1) ai_usage: 本人は SELECT のみ =====
alter table public.ai_usage enable row level security;
drop policy if exists "ai_usage_own" on public.ai_usage;
drop policy if exists "ai_usage_select_own" on public.ai_usage;
create policy "ai_usage_select_own" on public.ai_usage
  for select using (auth.uid() = user_id);
-- insert / update / delete のポリシーは作らない ＝ authenticated からは書けない。
-- service role は RLS を通らないので API 側の加算はそのまま動く。

-- ===== 2) クーポンの試行回数（失敗も数える） =====
create table if not exists public.coupon_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  count int not null default 0,
  primary key (user_id, date)
);
alter table public.coupon_attempts enable row level security;
-- 利用者向けポリシー無し（service role 専用）

-- ===== 3) UI翻訳の依頼件数 =====
create table if not exists public.i18n_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  count int not null default 0,
  primary key (user_id, date)
);
alter table public.i18n_requests enable row level security;
-- 利用者向けポリシー無し（service role 専用）

-- ===== 確認（実行後にこの3行が出ればOK） =====
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'ai_usage') as ai_usage_policies,     -- 1 のはず（select だけ）
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'coupon_attempts') as coupon_attempts,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'i18n_requests') as i18n_requests;

notify pgrst, 'reload schema';
