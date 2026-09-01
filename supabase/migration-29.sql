-- BodyLog migration-29: アプリ内フィードバック（ご意見・不具合の報告）
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 背景: β運用中なのに、ユーザーが不満や不具合を言える口がアプリの中に無かった
-- （開発者本人が手でスクショを送っている状態）。このまま公開すると
-- 「不満を言う場所が無い＝いきなり★1レビュー」になる。まず**アプリ内で受け止める**。
--
-- 【設計方針】
-- ・送るのは本人が書いた文章と、環境（アプリのバージョン・OS・言語）だけ。
--   記録の中身（体重・食事・写真）は一切送らない。何が送られるかはフォーム上に明記する。
-- ・**改ざん防止**のため update / delete のポリシーは作らない（insert と select のみ）。
--   送った本人でも後から書き換えられない＝台帳として信用できる。
-- ・退会時は on delete cascade で確実に消える（残骸を残さない）。
--
-- アプリはこのテーブルが無くても壊れない（送信失敗＝「送信できませんでした」の一行だけ）。

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                -- 'bug' | 'idea' | 'other'（検証はAPI側・値の追加に強くしておく）
  body text not null,                -- 本文（1〜1000字。API側で長さを検証する）
  app_version text,                  -- 自動で添える環境情報（フォームに明示している3点）
  platform text,
  locale text,
  created_at timestamptz not null default now()
);

-- RLS: 本人の insert と select だけ。update / delete のポリシーは**意図的に作らない**
alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own" on public.feedback
  for insert with check (auth.uid() = user_id);

drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own" on public.feedback
  for select using (auth.uid() = user_id);

-- レート制限（同一ユーザー1日10件）が「本人の当日ぶん」を数えるので、この複合1本で足りる
create index if not exists feedback_user_created on public.feedback (user_id, created_at desc);
