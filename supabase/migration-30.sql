-- BodyLog migration-30: リモートコンテンツ（読み物・バッジ・法則の文言をアップデート無しで配信）
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 背景: 読み物を1本足す・バッジを1個足す・法則の文言を直す、のたびにApp Store審査を
-- 通すのは重すぎる。一方で「コードを含む機能」はOTA配信できない（App Store規約）。
-- そこで**宣言的データとして表現できるもの**だけをこのテーブルから配る:
--   readings  … 読み物（純テキスト。完全にリモート化できる）
--   badges    … バッジ（名前・説明・アイコン名・カテゴリ＋獲得条件の宣言的DSL）
--   laws_text … 法則図鑑の文言だけ（検出ロジックはコードなので、法則の追加は要アップデート）
-- payload の形と運用手順は docs/REMOTE-CONTENT.md。
--
-- 【設計方針】
-- ・読むのは全認証ユーザー（select）。書くのは service role だけ（管理者がSQL Editorでinsert）。
--   insert/update/delete の RLS ポリシーは**意図的に作らない**＝アプリのanonキーでは書けない。
-- ・アプリ側は id で同梱データと統合する（同idは上書き＝文言差し替え、新idは追加）。
--   同じ kind の行が複数あれば version昇順→published_at昇順に適用（後勝ち）。
-- ・min_app_version より古いアプリはその行を無視する（新しいDSLのmetricを古い版に見せない）。
-- ・テーブルが空でも・無くてもアプリは壊れない（同梱データだけで動く。取得失敗はキャッシュ→同梱）。

create table if not exists public.remote_content (
  id text primary key,                          -- 例 'readings-2026-09'、'badges-v2'、'laws-text-v1'
  kind text not null check (kind in ('readings', 'badges', 'laws_text')),
  version int not null default 1,               -- 同kind内の適用順（大きいほど後に適用＝優先）
  payload jsonb not null,                       -- { "items": [ ... ] }（形は docs/REMOTE-CONTENT.md）
  published_at timestamptz not null default now(),
  min_app_version text                          -- 例 '1.0.20'。null=全バージョンに配る
);

-- RLS: 認証ユーザーは読める。書き込みポリシーは無し（service role は RLS を通過するので管理者は書ける）
alter table public.remote_content enable row level security;

drop policy if exists "remote_content_select_authenticated" on public.remote_content;
create policy "remote_content_select_authenticated" on public.remote_content
  for select to authenticated using (true);

-- アプリは kind を問わず全行を published_at 順に読む（行数は運用上せいぜい数十）
create index if not exists remote_content_kind_published on public.remote_content (kind, published_at);
