-- BodyLog migration-26: 食事の制約（除外アラート・B-18）
-- 【ユーザー実行待ち】Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- ビーガン/グルテンフリー/ハラール等の「食べないもの」を登録し、解析結果に
-- 該当の可能性を警告する機能（docs/DIET-MODES.md）。モードごとに実装せず
-- 「除外リスト＋自由記述」の1つの器にまとめている。
--
-- 既存の profiles.constraints_note（AI相談用の恒常的な前提）とは別カラムにする。
-- あちらは「提案してほしくない」ための好み、こちらは警告の判定基準で、
-- 誤検知のコストが桁違いに違うため混ぜない。
--
-- アプリはこの3列が無くても壊れない（読みはselect('*')でundefined→空扱い、
-- 書きは列を外して再実行するフォールバックを settings.tsx / API側に実装済み）。

alter table public.profiles add column if not exists diet_modes jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists diet_custom text;
-- 同意日時: 免責への同意をいつ得たかを残す（後日の紛争で「何にいつ同意したか」を再現するため）。
-- 値が無い＝未同意。アプリは未同意のあいだ機能をONにできない（同意ゲート・docs/DIET-MODES.md §6-2）
alter table public.profiles add column if not exists diet_consent_at timestamptz;

comment on column public.profiles.diet_modes is '食事の制約: 有効なプリセットキーの配列 例 ["vegan","gluten_free"]';
comment on column public.profiles.diet_custom is '食事の制約: 自由記述の排除指定（AIへそのまま渡す・プレミアム）';
comment on column public.profiles.diet_consent_at is '食事の制約: 免責同意の日時（未同意はnull＝機能をONにできない）';
