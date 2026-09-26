-- migration-38（2026-09-25）過食アラート v2: 主観ラベルと1タップ入力（docs/BINGE-PREVENTION-RESEARCH-2026-09-25.md §6）
--
-- 1) logs.overfull … その食事に「満腹を超えて食べた」の印（記録行の長押しメニューで付け外し）。
--    過食ラベルの副基準: この印が付いた日は摂取の超過額に関係なく「過食日」として学習する。
-- 2) logs.alcohol  … その食事に「お酒あり」。保存時に品目名から自動推定（lib/alcohol.ts）し、長押しで直せる。
-- 3) entries.craving … 夜（18〜23時）の渇望チェック 0–3（0=落ち着いている … 3=抑えるのがつらい）。
-- 4) entries.stress  … 朝の気ぜわしさ 0–3（気分カードの2問目）。
--    craving / stress は lib/sync.ts の日次サマリー同期が**触らない**（upsert は知っている列だけ書く。
--    その日の食事記録が全て消えた場合も、この2列が入っていれば行を消さず既知の列だけ空にする）。
alter table public.logs add column if not exists overfull boolean not null default false;
alter table public.logs add column if not exists alcohol boolean not null default false;
alter table public.entries add column if not exists craving smallint check (craving between 0 and 3);
alter table public.entries add column if not exists stress smallint check (stress between 0 and 3);

notify pgrst, 'reload schema';
