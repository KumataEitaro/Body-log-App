-- BodyLog スキーマ（Supabase SQL Editor に貼って実行）

-- プロフィール（1ユーザー1行）
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  sex text not null default 'male' check (sex in ('male','female')),
  height_cm numeric not null default 170,
  age int not null default 30,
  init_weight numeric,                    -- 初期体重（BMR計算のフォールバック）
  life_factor numeric not null default 1.3,
  created_at timestamptz not null default now()
);

-- デイリー記録（1ユーザー1日1行）
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  ex text not null default 'オフ' check (ex in ('オフ','軽い','通常','高','特大')),
  adj numeric not null default 0,
  intake numeric,
  p numeric, f numeric, c numeric,
  weight numeric,
  mood text not null default '',
  note text not null default '',
  food_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

-- RLS: 自分の行だけ読める/書ける
alter table public.profiles enable row level security;
alter table public.entries enable row level security;

drop policy if exists "profiles_own" on public.profiles;
create policy "profiles_own" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "entries_own" on public.entries;
create policy "entries_own" on public.entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at 自動更新
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before update on public.entries
  for each row execute function public.touch_updated_at();
