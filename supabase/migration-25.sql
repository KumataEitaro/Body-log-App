-- BodyLog migration-25: バイタル記録（血圧・脈拍・血糖）
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 1500人ペルソナ監査Later群「中高年・健康管理層の本丸」。
-- 体重とカロリーだけでは、健診で「血圧を気にして」と言われた層の受け皿にならない。
-- 1日1件（unique(user_id,date)）で血圧・脈拍・血糖を残し、概要タブ「からだ」の
-- バイタル行と、受診用PDFレポート（直近30日）の材料にする。
-- アプリはこのテーブルが無くても壊れない（読み込み失敗は空扱い＝表もグラフも空状態のまま）。

create table if not exists public.vitals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  systolic int,     -- 収縮期血圧（上）mmHg
  diastolic int,    -- 拡張期血圧（下）mmHg
  pulse int,        -- 脈拍 bpm
  glucose int,      -- 血糖値 mg/dL
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- RLS: 本人のみ全操作可（他人の血圧が絶対に見えない）
alter table public.vitals enable row level security;
drop policy if exists "vitals_own" on public.vitals;
create policy "vitals_own" on public.vitals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 読み出しは常に「本人の日付順・直近N日」なので複合インデックスを1本
create index if not exists vitals_user_date on public.vitals (user_id, date);
