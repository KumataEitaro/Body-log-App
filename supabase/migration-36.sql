-- migration-36（2026-09-24）
--
-- 1) 運動ぶんの目標反映を「手動」に（lib/activeApply.ts）
--    entries.active_kcal: その日に本人が「目標に反映する」を押して足した運動ぶん（kcal）。
--    null/0 = 反映なし。lib/sync.ts の日次サマリー同期はこの列を触らない（値が残る）。
--    食事タブの目標 = BMR×生活係数 ＋ 手記録の運動 ＋ active_kcal。過去日の収支・繰り越し調整の判定も同じ式。
alter table public.entries add column if not exists active_kcal numeric;

-- 2) マイ食品の「1回分のグラム」と微量栄養素（lib/foods.ts）
--    grams: ×1（登録した1回分）が何グラムか。チップで足すときの量を g で見せ、倍率や g で調整できる。
--    nutrients: 登録時に AI が出した微量栄養素（キーは native/src/lib/items.ts NUTRIENT_KEYS）。
--    チップで足した品目にも比例させて載せ、栄養ランキング「自分の摂取」「不足栄養素」の集計に使う。
alter table public.my_foods add column if not exists grams numeric;
alter table public.my_foods add column if not exists nutrients jsonb;

notify pgrst, 'reload schema';
