-- BodyLog migration-23: 新ティア設計（free/liteのAI回数変更）＋クーポン機構
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 新ティア表（2026-09-01決定）:
--   AIテキスト解析: free 3回/日・lite 5回/日・standard 50・premium 100
--   AI写真解析:     free 1枚/日・lite 2枚/日・standard 5・premium 30
--   AI相談:         free/lite 0（ロック）・standard 10・premium 50 セッション/日
-- 値は lib/plan.ts の FALLBACK と揃えること（DBが読めない時の保険が同じ設計になるように）。

-- 1) free/liteの上限を新ティアへ（standard/premiumは据え置き）
update public.plan_limits set text_day = 3, photo_day = 1, coach_day = 0 where plan = 'free';
update public.plan_limits set coach_day = 0 where plan = 'lite';  -- text5/photo2は据え置き

-- 2) クーポンコード（発行台帳）。plan='lite'|'standard'|'premium' を無期限で付与する
create table if not exists public.coupon_codes (
  code text primary key,
  plan text not null,
  max_uses int not null default 1,
  used_count int not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
-- RLS: 有効化するがポリシーを一切作らない＝anon/authenticatedからは全操作不可。
-- 触れるのは service role（/api/redeem-coupon）だけ（コードの総当たり列挙をDB層で防ぐ）
alter table public.coupon_codes enable row level security;

-- 3) 使用履歴（PK=(user_id, code) で「1ユーザー1コード1回」をDB層で保証）
create table if not exists public.coupon_redemptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  redeemed_at timestamptz not null default now(),
  primary key (user_id, code)
);
-- RLS: 本人が自分の使用履歴をselectできるのみ（insert/update/deleteはservice roleだけ）
alter table public.coupon_redemptions enable row level security;
drop policy if exists "coupon_redemptions_read_own" on public.coupon_redemptions;
create policy "coupon_redemptions_read_own" on public.coupon_redemptions
  for select using (auth.uid() = user_id);

-- 発行例（コードは好きな文字列。下は「20人まで使えるpremium無期限クーポン」）:
-- insert into coupon_codes (code, plan, max_uses) values ('<好きなコード>', 'premium', 20);
-- 期限つきにするなら:
-- insert into coupon_codes (code, plan, max_uses, expires_at) values ('<好きなコード>', 'standard', 50, '2026-12-31 23:59:59+09');
