-- ===================================================================
-- BodyLog 保留マイグレーション一括適用（v8〜v14・冪等: 何度実行しても安全）
-- SupabaseのSQL Editorにこのファイル全体を貼り付けて Run するだけ。
-- ===================================================================

-- v8: UI翻訳キャッシュ
create table if not exists public.ui_translations (
  lang text not null,
  src text not null,
  dst text not null,
  created_at timestamptz not null default now(),
  primary key (lang, src)
);
alter table public.ui_translations enable row level security;
drop policy if exists "ui_translations_read" on public.ui_translations;
create policy "ui_translations_read" on public.ui_translations
  for select using (auth.role() = 'authenticated');

-- v9: 未入力アラートの送信記録
alter table public.profiles add column if not exists last_inactivity_mail date;

-- v10: リマインドメールの配信停止設定
alter table public.profiles add column if not exists mail_opt_out boolean not null default false;

-- v11: PFC目標（体重1kgあたりのたんぱく質・脂質）
alter table public.goals add column if not exists protein_per_kg numeric;
alter table public.goals add column if not exists fat_per_kg numeric;

-- v12: 脂質の1日上限g
alter table public.goals add column if not exists fat_max_g numeric;

-- v13: ウエスト記録（logs=1記録ごと / entries=日次サマリー）
alter table public.logs add column if not exists waist numeric;
alter table public.entries add column if not exists waist numeric;

-- v14: 筋トレ重量目標
create table if not exists public.training_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_kg numeric not null,
  target_date date,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.training_goals enable row level security;
drop policy if exists "training_goals_own" on public.training_goals;
create policy "training_goals_own" on public.training_goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- v15: プレミアム課金（この日時まで有効。RevenueCat Webhookが更新する。NULL=無料）
alter table public.profiles add column if not exists premium_until timestamptz;
