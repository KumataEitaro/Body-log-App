-- BodyLog migration-27: 規約・プライバシーポリシーの再同意フロー
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 規約を改定したとき、既存ユーザー全員に「読んで同意」を取り直す必要がある
-- （改定を告知しただけでは、米国では同意の成立を争われうる）。
-- アプリ側は lib/consent.ts の TERMS_VERSION と比較し、古ければ全画面で同意を求める。
-- 列が無い環境でも壊れない（未同意扱いにせず、静かにスキップする実装）。

alter table public.profiles add column if not exists terms_version text;
alter table public.profiles add column if not exists terms_agreed_at timestamptz;

-- 同意の証跡は上書きせず履歴として残す（後日の紛争で「いつ何に同意したか」を再現できる）
create table if not exists public.consent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null,          -- 同意した規約バージョン（例 '2026-09-01'）
  kind text not null default 'terms',  -- terms / privacy / diet 等
  agreed_at timestamptz not null default now()
);
alter table public.consent_log enable row level security;
drop policy if exists "consent_log_own" on public.consent_log;
create policy "consent_log_own" on public.consent_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists consent_log_user on public.consent_log (user_id, agreed_at);
