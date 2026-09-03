-- BodyLog migration-32: リモートコンテンツに kind 'nutrients'（食材ナビの栄養データ）を追加
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- 背景: 「食材ナビ」（かしこい置き換え・栄養ランキング図鑑・たんぱく源ティア）は、日本の一般食材 約80品の
-- 栄養データ（native/src/content/nutrientDb.ts・日本食品標準成分表2020年版（八訂）ベースの目安値）で動く。
-- 値の訂正（例: 成分表の改訂）や品目の追加は純データなので、App Store審査を通さずに remote_content から配りたい。
-- 既存の kind（readings / badges / laws_text）と同じテーブル・同じマージ規則（同idは上書き・新idは追加）に乗せる。
--
-- payload の形（items の1要素＝1品目。content/nutrientDb.ts の NutrientFood と同一）と投入例は docs/REMOTE-CONTENT.md §4。
-- 100gあたりの値が妥当範囲（lib/remoteContent.ts NUTRIENT_RANGE_MAX）を超える項目はアプリ側で捨てる（桁違いの数字を図鑑に載せない）。
--
-- 古いアプリ（kind 'nutrients' を知らない版）はこの行を「未知のkind」として無視する（落ちない）。
-- check 制約の付け直しだけで、既存行・RLS・索引はそのまま。

alter table public.remote_content drop constraint if exists remote_content_kind_check;
alter table public.remote_content
  add constraint remote_content_kind_check check (kind in ('readings', 'badges', 'laws_text', 'nutrients'));
