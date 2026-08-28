-- BodyLog migration-20: 増量サイクル切替（B-5）
-- 中級者はバルク（増量）とカット（減量）を季節で往復する。目的の切替を履歴として残し、
-- 「前回のカットは8週で−3.1kg」のようなサイクル単位の自己比較を可能にする。
-- アプリ側はこのテーブルが無くても全機能が動く（サイクル機能だけ静かに非表示）。
-- Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
create table if not exists public.purpose_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null,          -- PurposeKey（cut_lean/cut_std/easy/bulk）
  started_at date not null,       -- この目的で始めた日
  ended_at date                   -- 次の目的へ切り替えた日（null=進行中）
);
alter table public.purpose_periods enable row level security;
drop policy if exists "purpose_periods_own" on public.purpose_periods;
create policy "purpose_periods_own" on public.purpose_periods
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists purpose_periods_user_started
  on public.purpose_periods (user_id, started_at);
