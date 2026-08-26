-- BodyLog migration-18: 3プラン制（free/lite/standard/premium）の土台
-- Supabase SQL Editor に貼って Run
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new

-- 1) profilesにプラン列（正本はRevenueCat → webhookがここを更新 → 全クライアントはこれを見る）
--    plan_untilを過ぎたら実質free（判定はlib/plan.tsに集約）
alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles add column if not exists plan_until timestamptz;
-- 写真解析の「お試し累計」使用数（free/lite用の生涯カウンタ）
alter table public.profiles add column if not exists photo_trial_used int not null default 0;

-- 2) AI使用回数を種類別に数える（既存countは合計として維持・後方互換）
alter table public.ai_usage add column if not exists text_count int not null default 0;
alter table public.ai_usage add column if not exists photo_count int not null default 0;
alter table public.ai_usage add column if not exists coach_count int not null default 0;

-- 3) プラン別の1日上限（値はいつでもUPDATEで変更できる＝価格・制限は後から調整可能）
--    null = 無制限。photo_trial_total = 写真解析の「お試し累計枠」（無料/ライトの生涯累計）
create table if not exists public.plan_limits (
  plan text primary key,
  text_day int,
  photo_day int,
  coach_day int,
  photo_trial_total int not null default 0,
  ads boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.plan_limits enable row level security;
-- 上限値は秘密ではない（アプリが「残り回数」を表示するのに使う）。読み取りのみ全ログインユーザーに許可
drop policy if exists "plan_limits_read" on public.plan_limits;
create policy "plan_limits_read" on public.plan_limits
  for select using (auth.role() = 'authenticated');

-- 初期値（シミュレーターで決めた回数設計。金額確定後に自由に調整）
insert into public.plan_limits (plan, text_day, photo_day, coach_day, photo_trial_total, ads) values
  ('free',     3,    0,  3,  5, true),   -- 広告あり。写真は生涯お試し5枚
  ('lite',     3,    0,  3,  5, false),  -- 価値=広告なし（AIは無料と同じ）
  ('standard', 50,   5,  10, 0, false),  -- AI回数制限つき
  ('premium',  100,  30, 50, 0, false)   -- 実質無制限（公正利用の裏上限）
on conflict (plan) do nothing;
