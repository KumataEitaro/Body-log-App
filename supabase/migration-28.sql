-- BodyLog migration-28: 生理周期モード（月経開始日の記録）
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 1500人ペルソナ監査「日本ダイエット層: 女性の周期変動を説明しないグラフが停滞期離脱を生む」。
-- 月経前〜月経中は水分貯留で体重が1〜2kg増えることがある。それを「太った」と誤解すると
-- 理不尽な自己嫌悪と離脱を生む。この機能の目的はただ一つ、「記録した周期と体重の重なりを
-- 見せる」こと。予測もしないし診断もしない（次回予測日は意図的に持たない）。
--
-- 【プライバシー】このテーブルは本アプリで最も機微なデータである。
-- ・RLSは **本人のみ**（select/insert/update/delete すべて auth.uid() = user_id）に限定する。
--   管理者ロール・共有・集計目的の緩いポリシーは絶対に足さない。
-- ・記録するのは「開始日」と任意メモだけ。症状・妊娠可能性・体調スコア等の医療情報は持たない。
-- ・機能自体が既定OFF（アプリ側 AsyncStorage 'bl-cycle-enabled'）で、ONにした本人にしか
--   カードも帯も出ない。OFFの人にはこのテーブルへの読み書きが一度も起きない。
-- ・退会時は on delete cascade で確実に消える（残骸を残さない）。
--
-- アプリはこのテーブルが無くても壊れない（読み込み失敗は空配列扱い＝機能が静かに非表示）。

create table if not exists public.cycle_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,          -- 月経開始日（記録するのはこれだけ）
  note text,                         -- 任意メモ（本人用の覚え書き。解析には使わない）
  created_at timestamptz not null default now(),
  unique (user_id, start_date)       -- 同じ開始日は1件（二重タップでも増えない）
);

-- RLS: 本人のみ全操作可。他人の周期が絶対に見えない
alter table public.cycle_logs enable row level security;
drop policy if exists "cycle_logs_own" on public.cycle_logs;
create policy "cycle_logs_own" on public.cycle_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 読み出しは常に「本人の開始日順・直近N件」なので複合インデックスを1本
create index if not exists cycle_logs_user_start on public.cycle_logs (user_id, start_date);
