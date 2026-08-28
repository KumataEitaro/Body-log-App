-- BodyLog migration-22: AI相談のセッション制＋制約プロフィール
-- 1) constraints_note: アレルギー・宗教/ベジ等の食の制約・苦手/偏食・予算感を
--    ユーザーが自分の言葉で書くフリーテキスト1カラム（構造化しない＝入力障壁を下げる）。
--    /api/coach がプロンプトに「毎回必ず尊重する制約」として注入する。
-- 2) coach_sessions: 「新しい相談を始める」ごとに1消費するための既読セッション台帳。
--    (user_id, session_id, date) を主キーにして「そのsessionIdを今日はじめて見たか」を判定。
--    日をまたいだ継続は翌日ぶんとして再カウントする。
-- アプリ・APIはこの列/テーブルが無くても壊れない（列なしで再実行・毎往復1消費へフォールバック）。
-- Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new

alter table public.profiles add column if not exists constraints_note text;

create table if not exists public.coach_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, session_id, date)
);
alter table public.coach_sessions enable row level security;
drop policy if exists "coach_sessions_own" on public.coach_sessions;
create policy "coach_sessions_own" on public.coach_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
