-- BodyLog migration-24: マイミール（複数品目のセット保存→1タップ再記録）
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 1500人ペルソナ監査ペイン3位「定番の食事を毎回AIに通すのが面倒」への対応。
-- 「今日の記録」の食事行・トレイの✓保存長押しからセット（items配列）を名前つきで保存し、
-- 食事タブのチップから1タップでトレイへ全品目を呼び出す（AI解析なし・保存済み栄養値をそのまま）。
-- アプリはこのテーブルが無くても壊れない（読み込み失敗は空扱い＝チップ非表示）。

create table if not exists public.my_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  items jsonb not null,
  created_at timestamptz not null default now()
);

-- RLS: 本人のみ全操作可
alter table public.my_meals enable row level security;
drop policy if exists "my_meals_own" on public.my_meals;
create policy "my_meals_own" on public.my_meals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 一覧は「本人の登録順」で読むだけなので複合インデックスを1本
create index if not exists my_meals_user_created on public.my_meals (user_id, created_at);
