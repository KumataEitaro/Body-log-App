// 食材ナビの栄養データ（同梱・リモート差し替え可）
//
// 熊田さんが参考動画（「スマートな食材の置き換え」「◯◯が多いのは？ランキング」「たんぱく質ティアリスト」）
// から着想した「食材ナビ」の土台。日本の一般食材 約80品について、
//   ・1食の目安量（g）と数える単位（個／パック／大さじ／枚…）と 1単位の重さ
//   ・100gあたりの kcal / P / F / C
//   ・主要な微量栄養素（ビタミンA・C・E・鉄・亜鉛・カルシウム・カリウム・食物繊維・オメガ3）
// を持つ。用途は lib/smartSwap.ts（かしこい置き換え）・content/proteinTiers.ts（たんぱく源ティア）・
// app/nutrient-rank.tsx（栄養ランキング図鑑）。
//
// 【出典と精度】値は **日本食品標準成分表2020年版（八訂）**（増補2023年を含む）の可食部100gあたりを基本に、
// 市販品（サラダチキン・ギリシャヨーグルト・プロテイン）は代表的な商品の表示値から丸めた。すべて **目安** であり、
// 品種・部位・調理で±20〜30%は動く。栄養計算の正本ではない（記録の栄養値はAI解析／マイ食品の値が正）。
// 主要品目（赤ピーマンのビタミンC 170mg・納豆のたんぱく質 16.5g・かきの亜鉛 14mg・アーモンドのビタミンE 30mg・
// ひまわり油のビタミンE 39mg・鶏レバーのビタミンA 14,000µg・豚レバーの鉄 13mg・乾燥わかめのCa 780mg／食物繊維 32.7g）は
// 文部科学省 食品成分データベース（fooddb.mext.go.jp）と照合した（2026-09-03）。
// テスト（__tests__/foodNav.test.ts）で各栄養素の「100gあたりの妥当範囲」を固定し、桁違いの打ち間違いを止める。
//
// 【リモート】remote_content の kind 'nutrients'（supabase/migration-32.sql）で同じ形の項目を配れる。
// 同idは上書き（値の訂正）・新idは追加（品目の追加）。マージ規則は lib/remoteContent.mergeById と同じ。
//
// 【文言】名前・単位は { ja, en } の多言語オブジェクト（t() は通さない。remoteContent の L10n と同じ流儀）。
// 表示側は pickL10n で現在の言語に解決する。無い言語は ja → en。
import {
  getRemoteContent, mergeById, pickL10n, NUTRIENT_RANGE_MAX, validateNutrientFood,
  type L10n, type NavNutrient, type NutrientFoodCat, type RemoteNutrientFood,
} from '@/lib/remoteContent';

// ===== 型 =====
// 栄養素キー・品目の形・リモート検証は lib/remoteContent.ts に置いてある（このファイルが remoteContent を
// import するため、逆向きの import を作らない）。ここでは同じ名前で再輸出して、利用側の import を1本にする
export type { NavNutrient, RemoteNutrientFood };
export { validateNutrientFood };

/** 図鑑の栄養素チップの並び（よく見る順） */
export const NAV_NUTRIENTS: NavNutrient[] = ['p', 'fe', 'va', 'vc', 've', 'zn', 'ca', 'fib', 'n3', 'k'];

/**
 * 栄養素の表示情報。ref は「成人1日の目安」（日本人の食事摂取基準2020/2025・18〜49歳の推奨量／目安量／目標量を
 * 男女の中間で丸めた値）。置き換え候補で「その食材の得意な栄養素」を決めるときの分母にだけ使う（充足率の表示はしない）。
 * range は 100g あたりの妥当範囲（テストで固定。上限は成分表で最大級の食品＋余裕）
 */
export type NutrientMeta = { key: NavNutrient; label: L10n; unit: string; ref: number; range: [number, number]; decimals: number };

const R = (k: NavNutrient): [number, number] => [0, NUTRIENT_RANGE_MAX[k]];
export const NUTRIENT_META: Record<NavNutrient, NutrientMeta> = {
  p:   { key: 'p',   label: { ja: 'たんぱく質', en: 'Protein' },   unit: 'g',  ref: 60,   range: R('p'),   decimals: 1 },
  fe:  { key: 'fe',  label: { ja: '鉄', en: 'Iron' },              unit: 'mg', ref: 8,    range: R('fe'),  decimals: 1 },
  va:  { key: 'va',  label: { ja: 'ビタミンA', en: 'Vitamin A' },  unit: 'µg', ref: 800,  range: R('va'),  decimals: 0 },
  vc:  { key: 'vc',  label: { ja: 'ビタミンC', en: 'Vitamin C' },  unit: 'mg', ref: 100,  range: R('vc'),  decimals: 0 },
  ve:  { key: 've',  label: { ja: 'ビタミンE', en: 'Vitamin E' },  unit: 'mg', ref: 6.5,  range: R('ve'),  decimals: 1 },
  zn:  { key: 'zn',  label: { ja: '亜鉛', en: 'Zinc' },            unit: 'mg', ref: 10,   range: R('zn'),  decimals: 1 },
  ca:  { key: 'ca',  label: { ja: 'カルシウム', en: 'Calcium' },   unit: 'mg', ref: 700,  range: R('ca'),  decimals: 0 },
  fib: { key: 'fib', label: { ja: '食物繊維', en: 'Fiber' },       unit: 'g',  ref: 20,   range: R('fib'), decimals: 1 },
  n3:  { key: 'n3',  label: { ja: 'オメガ3', en: 'Omega-3' },      unit: 'g',  ref: 2,    range: R('n3'),  decimals: 1 },
  k:   { key: 'k',   label: { ja: 'カリウム', en: 'Potassium' },   unit: 'mg', ref: 2500, range: R('k'),   decimals: 0 },
};

/** 100gあたりの栄養値。kcal/P/F/C は必須、微量栄養素は無い項目は 0 */
export type Per100 = RemoteNutrientFood['per100'];

/** ティア判定に使う食材の性格。1=良い側（手間が少ない／安い／食べすぎにくい）〜3 */
export type TierTraits = NonNullable<RemoteNutrientFood['tier']>;

export type FoodCat = NutrientFoodCat;

/**
 * 食材1品目。
 *  aliases … 品目名の部分一致に使う別名（日本語表記ゆれ・英語）。長い別名ほど優先して一致させる
 *  unit    … 数える単位（「個」「パック」「大さじ」…）と 1単位の重さ（g）。prefix=true は「大さじ2」のように単位を前に置く
 *  serving … 1食の目安量（g）。ランキングの「1食あたり」とティアの「1食あたり−◯kcal」の分母
 *  tier    … たんぱく源として格付けする食材だけ持つ（ティアリストの対象）
 */
export type NutrientFood = RemoteNutrientFood;

// ===== 同梱データ =====

/** 微量栄養素の省略を許す組み立て（無いものは 0） */
function n(v: Partial<Per100> & { kcal: number; p: number; f: number; c: number }): Per100 {
  return { va: 0, vc: 0, ve: 0, fe: 0, zn: 0, ca: 0, k: 0, fib: 0, n3: 0, ...v };
}
const U = (ja: string, en: string, g: number, prefix = false) => ({ label: { ja, en }, g, prefix });

/** 同梱の食材（約80品）。並びは たんぱく源 → 野菜 → 果物 → 主食 → 種実・油 → 海藻 */
export const NUTRIENT_DB: NutrientFood[] = [
  // ---- 肉（たんぱく源） ----
  { id: 'chicken_breast', name: { ja: '鶏むね肉（皮なし）', en: 'Chicken breast (skinless)' }, aliases: ['鶏むね', '鶏胸', 'とりむね', 'むね肉', '胸肉', 'chicken breast'], emoji: '🍗', cat: 'meat', unit: U('枚', 'piece', 250), serving: 100,
    per100: n({ kcal: 105, p: 23.3, f: 1.9, c: 0.1, va: 9, vc: 3, ve: 0.3, fe: 0.3, zn: 0.7, ca: 4, k: 370 }), tier: { ease: 2, price: 1, overeat: 1 } },
  { id: 'salad_chicken', name: { ja: 'サラダチキン', en: 'Salad chicken (ready-to-eat)' }, aliases: ['サラダチキン', 'salad chicken', '鶏ハム', 'チキンバー'], emoji: '🍗', cat: 'processed', unit: U('個', 'pack', 110), serving: 110,
    per100: n({ kcal: 108, p: 23.0, f: 1.5, c: 1.0, fe: 0.3, zn: 0.7, k: 250 }), tier: { ease: 1, price: 2, overeat: 1 } },
  { id: 'chicken_tender', name: { ja: 'ささみ', en: 'Chicken tenderloin' }, aliases: ['ささみ', 'ササミ', '鶏ささ身', 'tenderloin'], emoji: '🍗', cat: 'meat', unit: U('本', 'piece', 45), serving: 90,
    per100: n({ kcal: 98, p: 23.9, f: 0.8, c: 0.1, va: 5, ve: 0.7, fe: 0.2, zn: 0.6, ca: 4, k: 420 }), tier: { ease: 2, price: 2, overeat: 1 } },
  { id: 'chicken_thigh_skinless', name: { ja: '鶏もも肉（皮なし）', en: 'Chicken thigh (skinless)' }, aliases: ['鶏もも肉（皮なし）', '鶏もも皮なし', 'もも肉皮なし'], emoji: '🍗', cat: 'meat', unit: U('枚', 'piece', 250), serving: 100,
    per100: n({ kcal: 113, p: 19.0, f: 5.0, c: 0, va: 16, ve: 0.6, fe: 0.6, zn: 1.8, ca: 5, k: 320 }), tier: { ease: 2, price: 1, overeat: 1 } },
  { id: 'chicken_thigh', name: { ja: '鶏もも肉（皮つき）', en: 'Chicken thigh (with skin)' }, aliases: ['鶏もも', '鶏モモ', 'とりもも', 'もも肉', '唐揚げ', 'から揚げ', 'からあげ', 'chicken thigh'], emoji: '🍗', cat: 'meat', unit: U('枚', 'piece', 250), serving: 100,
    per100: n({ kcal: 190, p: 17.0, f: 13.5, c: 0, va: 40, ve: 0.7, fe: 0.6, zn: 1.6, ca: 5, k: 290 }), tier: { ease: 2, price: 1, overeat: 2 } },
  { id: 'chicken_wing', name: { ja: '手羽先', en: 'Chicken wing' }, aliases: ['手羽先', '手羽', 'chicken wing'], emoji: '🍗', cat: 'meat', unit: U('本', 'piece', 40), serving: 120,
    per100: n({ kcal: 207, p: 17.4, f: 16.2, c: 0, va: 51, fe: 0.5, zn: 1.5, ca: 14, k: 210 }), tier: { ease: 2, price: 1, overeat: 3 } },
  { id: 'chicken_drumette', name: { ja: '手羽元', en: 'Chicken drumette' }, aliases: ['手羽元'], emoji: '🍗', cat: 'meat', unit: U('本', 'piece', 40), serving: 120,
    per100: n({ kcal: 175, p: 18.2, f: 12.8, c: 0, va: 44, fe: 0.5, zn: 1.6, ca: 10, k: 230 }), tier: { ease: 2, price: 1, overeat: 2 } },
  { id: 'chicken_gizzard', name: { ja: '砂肝', en: 'Chicken gizzard' }, aliases: ['砂肝', 'すなぎも', 'gizzard'], emoji: '🍢', cat: 'meat', unit: U('個', 'piece', 30), serving: 90,
    per100: n({ kcal: 86, p: 18.3, f: 1.8, c: 0, va: 4, vc: 5, fe: 2.5, zn: 2.8, ca: 7, k: 230 }), tier: { ease: 2, price: 1, overeat: 1 } },
  { id: 'chicken_liver', name: { ja: '鶏レバー', en: 'Chicken liver' }, aliases: ['鶏レバー', '鳥レバー', 'レバー', 'chicken liver'], emoji: '🫘', cat: 'meat', unit: U('個', 'piece', 40), serving: 60,
    per100: n({ kcal: 100, p: 18.9, f: 3.1, c: 0.6, va: 14000, vc: 20, ve: 0.4, fe: 9.0, zn: 3.3, ca: 5, k: 330 }), tier: { ease: 2, price: 1, overeat: 1 } },
  { id: 'pork_liver', name: { ja: '豚レバー', en: 'Pork liver' }, aliases: ['豚レバー', 'pork liver'], emoji: '🫘', cat: 'meat', unit: U('切れ', 'slice', 30), serving: 60,
    per100: n({ kcal: 114, p: 20.4, f: 3.4, c: 2.5, va: 13000, vc: 20, ve: 0.4, fe: 13.0, zn: 6.9, ca: 5, k: 290 }), tier: { ease: 2, price: 1, overeat: 1 } },
  { id: 'pork_fillet', name: { ja: '豚ヒレ肉', en: 'Pork tenderloin' }, aliases: ['豚ヒレ', '豚ひれ', 'ヒレカツ', 'pork tenderloin'], emoji: '🐖', cat: 'meat', unit: U('切れ', 'slice', 40), serving: 100,
    per100: n({ kcal: 118, p: 22.2, f: 3.7, c: 0.3, va: 3, ve: 0.3, fe: 0.9, zn: 2.2, ca: 3, k: 430 }), tier: { ease: 2, price: 2, overeat: 1 } },
  { id: 'pork_leg', name: { ja: '豚もも肉（赤肉）', en: 'Pork leg (lean)' }, aliases: ['豚もも', '豚モモ', 'pork leg'], emoji: '🐖', cat: 'meat', unit: U('枚', 'slice', 30), serving: 100,
    per100: n({ kcal: 119, p: 22.1, f: 3.6, c: 0.2, va: 3, fe: 0.9, zn: 2.2, ca: 4, k: 370 }), tier: { ease: 2, price: 1, overeat: 1 } },
  { id: 'pork_loin', name: { ja: '豚ロース（脂身つき）', en: 'Pork loin' }, aliases: ['豚ロース', 'ロースカツ', 'とんかつ', 'トンカツ', '生姜焼き', 'pork loin'], emoji: '🐖', cat: 'meat', unit: U('枚', 'slice', 100), serving: 100,
    per100: n({ kcal: 248, p: 19.3, f: 19.2, c: 0.2, va: 6, ve: 0.3, fe: 0.3, zn: 1.6, ca: 4, k: 310 }), tier: { ease: 2, price: 2, overeat: 2 } },
  { id: 'pork_belly', name: { ja: '豚バラ肉', en: 'Pork belly' }, aliases: ['豚バラ', '豚ばら', 'バラ肉', 'pork belly', 'ベーコン'], emoji: '🥓', cat: 'meat', unit: U('枚', 'slice', 30), serving: 100,
    per100: n({ kcal: 366, p: 14.4, f: 35.4, c: 0.1, va: 11, ve: 0.5, fe: 0.6, zn: 1.8, ca: 3, k: 240 }), tier: { ease: 2, price: 1, overeat: 3 } },
  { id: 'pork_mince', name: { ja: '豚ひき肉', en: 'Ground pork' }, aliases: ['豚ひき', '豚挽き', 'ground pork'], emoji: '🐖', cat: 'meat', unit: U('人前', 'serving', 100), serving: 100,
    per100: n({ kcal: 209, p: 17.7, f: 17.2, c: 0.1, va: 9, fe: 1.0, zn: 2.8, ca: 6, k: 290 }), tier: { ease: 2, price: 1, overeat: 2 } },
  { id: 'beef_round', name: { ja: '牛もも肉（赤肉・輸入）', en: 'Beef round (lean)' }, aliases: ['牛もも', '牛モモ', '赤身ステーキ', 'ローストビーフ', 'beef round'], emoji: '🥩', cat: 'meat', unit: U('枚', 'slice', 100), serving: 100,
    per100: n({ kcal: 117, p: 21.2, f: 3.6, c: 0.4, va: 3, ve: 0.4, fe: 2.6, zn: 3.8, ca: 4, k: 340 }), tier: { ease: 2, price: 2, overeat: 1 } },
  { id: 'beef_fillet', name: { ja: '牛ヒレ肉（輸入）', en: 'Beef tenderloin' }, aliases: ['牛ヒレ', 'ヒレステーキ', 'beef tenderloin'], emoji: '🥩', cat: 'meat', unit: U('枚', 'steak', 150), serving: 150,
    per100: n({ kcal: 123, p: 20.5, f: 4.8, c: 0.3, va: 4, ve: 0.7, fe: 2.8, zn: 2.8, ca: 4, k: 370 }), tier: { ease: 2, price: 3, overeat: 1 } },
  { id: 'beef_belly', name: { ja: '牛バラ肉（輸入）', en: 'Beef short plate' }, aliases: ['牛バラ', '牛丼', 'カルビ', 'beef belly'], emoji: '🥩', cat: 'meat', unit: U('枚', 'slice', 30), serving: 100,
    per100: n({ kcal: 338, p: 14.4, f: 32.9, c: 0.2, va: 13, ve: 0.7, fe: 1.5, zn: 3.0, ca: 4, k: 230 }), tier: { ease: 2, price: 2, overeat: 3 } },
  { id: 'beef_mince', name: { ja: '牛ひき肉', en: 'Ground beef' }, aliases: ['牛ひき', '牛挽き', 'ハンバーグ', 'ground beef'], emoji: '🥩', cat: 'meat', unit: U('人前', 'serving', 100), serving: 100,
    per100: n({ kcal: 251, p: 17.1, f: 21.1, c: 0.3, va: 13, ve: 0.5, fe: 2.4, zn: 5.2, ca: 6, k: 260 }), tier: { ease: 2, price: 1, overeat: 2 } },
  { id: 'ham', name: { ja: 'ロースハム', en: 'Ham' }, aliases: ['ハム', 'ham'], emoji: '🍖', cat: 'processed', unit: U('枚', 'slice', 20), serving: 40,
    per100: n({ kcal: 211, p: 18.6, f: 14.5, c: 2.0, fe: 0.5, zn: 1.6, ca: 4, k: 290 }), tier: { ease: 1, price: 2, overeat: 2 } },
  { id: 'sausage', name: { ja: 'ウインナー', en: 'Sausage' }, aliases: ['ウインナー', 'ウィンナー', 'ソーセージ', 'sausage'], emoji: '🌭', cat: 'processed', unit: U('本', 'piece', 20), serving: 60,
    per100: n({ kcal: 319, p: 11.5, f: 30.6, c: 3.3, fe: 0.5, zn: 1.3, ca: 6, k: 180 }), tier: { ease: 1, price: 1, overeat: 3 } },
  // ---- 卵・大豆・乳（たんぱく源） ----
  { id: 'egg', name: { ja: '卵（全卵）', en: 'Egg' }, aliases: ['卵', 'たまご', 'タマゴ', '玉子', 'ゆで卵', '目玉焼き', 'スクランブル', 'オムレツ', 'egg'], emoji: '🥚', cat: 'egg', unit: U('個', 'egg', 50), serving: 100,
    per100: n({ kcal: 142, p: 12.2, f: 10.2, c: 0.4, va: 210, ve: 1.3, fe: 1.5, zn: 1.1, ca: 46, k: 130, n3: 0.1 }), tier: { ease: 1, price: 1, overeat: 2 } },
  { id: 'egg_white', name: { ja: '卵白', en: 'Egg white' }, aliases: ['卵白', 'egg white'], emoji: '🥚', cat: 'egg', unit: U('個', 'egg white', 33), serving: 66,
    per100: n({ kcal: 44, p: 10.1, f: 0, c: 0.5, k: 140, ca: 5 }), tier: { ease: 1, price: 1, overeat: 1 } },
  { id: 'natto', name: { ja: '納豆', en: 'Natto' }, aliases: ['納豆', 'なっとう', 'natto'], emoji: '🫘', cat: 'soy', unit: U('パック', 'pack', 45), serving: 45,
    per100: n({ kcal: 190, p: 16.5, f: 10.0, c: 12.1, ve: 0.5, fe: 3.3, zn: 1.9, ca: 90, k: 660, fib: 6.7 }), tier: { ease: 1, price: 1, overeat: 1 } },
  { id: 'tofu_firm', name: { ja: '木綿豆腐', en: 'Firm tofu' }, aliases: ['木綿豆腐', '木綿', '豆腐', 'とうふ', 'tofu', '冷奴', '湯豆腐', '麻婆豆腐'], emoji: '🧊', cat: 'soy', unit: U('丁', 'block', 300), serving: 150,
    per100: n({ kcal: 73, p: 7.0, f: 4.9, c: 1.5, fe: 1.5, zn: 0.6, ca: 93, k: 110, fib: 1.1 }), tier: { ease: 1, price: 1, overeat: 1 } },
  { id: 'tofu_silken', name: { ja: '絹ごし豆腐', en: 'Silken tofu' }, aliases: ['絹ごし', '絹豆腐', 'silken tofu'], emoji: '🧊', cat: 'soy', unit: U('丁', 'block', 300), serving: 150,
    per100: n({ kcal: 56, p: 5.3, f: 3.5, c: 2.0, fe: 1.2, zn: 0.5, ca: 75, k: 150, fib: 0.9 }), tier: { ease: 1, price: 1, overeat: 1 } },
  { id: 'atsuage', name: { ja: '厚揚げ', en: 'Thick fried tofu' }, aliases: ['厚揚げ', '生揚げ'], emoji: '🧊', cat: 'soy', unit: U('枚', 'piece', 150), serving: 75,
    per100: n({ kcal: 143, p: 10.7, f: 11.3, c: 0.9, fe: 2.6, zn: 1.1, ca: 240, k: 120, fib: 0.7 }), tier: { ease: 1, price: 1, overeat: 2 } },
  { id: 'aburaage', name: { ja: '油揚げ', en: 'Fried tofu sheet' }, aliases: ['油揚げ', 'きつね', 'いなり'], emoji: '🟫', cat: 'soy', unit: U('枚', 'sheet', 30), serving: 30,
    per100: n({ kcal: 377, p: 23.4, f: 34.4, c: 0.4, fe: 3.2, zn: 2.5, ca: 310, k: 86, fib: 1.3 }), tier: { ease: 1, price: 1, overeat: 2 } },
  { id: 'koya_tofu', name: { ja: '高野豆腐（乾）', en: 'Freeze-dried tofu' }, aliases: ['高野豆腐', '凍り豆腐'], emoji: '🧊', cat: 'soy', unit: U('枚', 'piece', 17), serving: 17,
    per100: n({ kcal: 496, p: 50.5, f: 34.1, c: 4.2, fe: 7.5, zn: 5.2, ca: 630, k: 34, fib: 2.5 }), tier: { ease: 2, price: 1, overeat: 1 } },
  { id: 'soy_milk', name: { ja: '豆乳（無調整）', en: 'Soy milk' }, aliases: ['豆乳', 'soy milk', 'ソイラテ'], emoji: '🥛', cat: 'soy', unit: U('杯', 'cup', 200), serving: 200,
    per100: n({ kcal: 44, p: 3.6, f: 2.0, c: 3.1, fe: 1.2, zn: 0.3, ca: 15, k: 190, fib: 0.2 }), tier: { ease: 1, price: 1, overeat: 2 } },
  { id: 'edamame', name: { ja: '枝豆（ゆで）', en: 'Edamame' }, aliases: ['枝豆', 'えだまめ', 'edamame'], emoji: '🫛', cat: 'soy', unit: U('皿', 'plate', 50), serving: 50,
    per100: n({ kcal: 118, p: 11.5, f: 6.1, c: 8.9, va: 24, vc: 15, ve: 0.6, fe: 2.5, zn: 1.3, ca: 76, k: 490, fib: 4.6 }), tier: { ease: 1, price: 1, overeat: 2 } },
  { id: 'soybeans', name: { ja: '大豆（ゆで）', en: 'Soybeans (boiled)' }, aliases: ['大豆', '蒸し大豆', 'soybeans'], emoji: '🫘', cat: 'soy', unit: U('皿', 'plate', 50), serving: 50,
    per100: n({ kcal: 163, p: 14.8, f: 9.8, c: 8.4, ve: 1.6, fe: 2.2, zn: 1.9, ca: 79, k: 530, fib: 8.5 }), tier: { ease: 1, price: 1, overeat: 1 } },
  { id: 'greek_yogurt', name: { ja: 'ギリシャヨーグルト（無糖）', en: 'Greek yogurt (plain)' }, aliases: ['ギリシャヨーグルト', 'オイコス', 'パルテノ', 'greek yogurt'], emoji: '🥣', cat: 'dairy', unit: U('個', 'cup', 100), serving: 100,
    per100: n({ kcal: 59, p: 10.0, f: 0.2, c: 4.0, zn: 0.5, ca: 110, k: 140 }), tier: { ease: 1, price: 2, overeat: 2 } },
  { id: 'yogurt', name: { ja: 'プレーンヨーグルト', en: 'Plain yogurt' }, aliases: ['ヨーグルト', 'yogurt'], emoji: '🥣', cat: 'dairy', unit: U('杯', 'cup', 100), serving: 100,
    per100: n({ kcal: 56, p: 3.6, f: 3.0, c: 4.9, va: 33, zn: 0.4, ca: 120, k: 170 }), tier: { ease: 1, price: 1, overeat: 2 } },
  { id: 'milk', name: { ja: '牛乳', en: 'Milk' }, aliases: ['牛乳', 'ミルク', 'milk', 'カフェラテ', 'ラテ'], emoji: '🥛', cat: 'dairy', unit: U('杯', 'cup', 200), serving: 200,
    per100: n({ kcal: 61, p: 3.3, f: 3.8, c: 4.8, va: 38, zn: 0.4, ca: 110, k: 150 }), tier: { ease: 1, price: 1, overeat: 2 } },
  { id: 'cheese', name: { ja: 'プロセスチーズ', en: 'Processed cheese' }, aliases: ['チーズ', 'cheese'], emoji: '🧀', cat: 'dairy', unit: U('個', 'piece', 18), serving: 36,
    per100: n({ kcal: 313, p: 22.7, f: 26.0, c: 1.3, va: 260, ve: 1.1, fe: 0.3, zn: 3.2, ca: 630, k: 60 }), tier: { ease: 1, price: 2, overeat: 2 } },
  { id: 'whey_protein', name: { ja: 'プロテイン（ホエイ・粉）', en: 'Whey protein powder' }, aliases: ['プロテイン', 'ホエイ', 'protein powder', 'whey'], emoji: '🥤', cat: 'processed', unit: U('杯', 'scoop', 30), serving: 30,
    per100: n({ kcal: 380, p: 75.0, f: 5.0, c: 10.0, fe: 1.0, zn: 1.0, ca: 300, k: 300 }), tier: { ease: 1, price: 2, overeat: 1 } },
  // ---- 魚介（たんぱく源） ----
  { id: 'salmon', name: { ja: '鮭（しろさけ）', en: 'Salmon' }, aliases: ['鮭', 'サーモン', 'さけ', 'しゃけ', 'サケ', '銀鮭', '紅鮭', 'salmon'], emoji: '🐟', cat: 'fish', unit: U('切れ', 'fillet', 80), serving: 80,
    per100: n({ kcal: 124, p: 22.3, f: 4.1, c: 0.1, va: 11, vc: 1, ve: 1.2, fe: 0.5, zn: 0.5, ca: 14, k: 350, n3: 0.9 }), tier: { ease: 2, price: 2, overeat: 1 } },
  { id: 'mackerel', name: { ja: 'さば（まさば）', en: 'Mackerel' }, aliases: ['さば', 'サバ', '鯖', 'mackerel', 'しめさば'], emoji: '🐟', cat: 'fish', unit: U('切れ', 'fillet', 80), serving: 80,
    per100: n({ kcal: 211, p: 20.6, f: 16.8, c: 0.3, va: 37, vc: 1, ve: 1.3, fe: 1.2, zn: 1.1, ca: 6, k: 330, n3: 2.1 }), tier: { ease: 2, price: 1, overeat: 1 } },
  { id: 'mackerel_can', name: { ja: 'さば水煮缶', en: 'Canned mackerel (in water)' }, aliases: ['さば缶', 'サバ缶', 'さば水煮', 'サバ水煮', '鯖缶', 'canned mackerel'], emoji: '🥫', cat: 'fish', unit: U('缶', 'can', 150), serving: 150,
    per100: n({ kcal: 174, p: 20.9, f: 10.7, c: 0.2, va: 31, ve: 3.2, fe: 1.6, zn: 1.7, ca: 260, k: 260, n3: 2.7 }), tier: { ease: 1, price: 1, overeat: 1 } },
  { id: 'saury', name: { ja: 'さんま', en: 'Pacific saury' }, aliases: ['さんま', 'サンマ', '秋刀魚', 'saury'], emoji: '🐟', cat: 'fish', unit: U('尾', 'fish', 100), serving: 100,
    per100: n({ kcal: 287, p: 18.1, f: 25.6, c: 0.1, va: 16, ve: 1.7, fe: 1.4, zn: 0.8, ca: 28, k: 200, n3: 5.6 }), tier: { ease: 2, price: 1, overeat: 1 } },
  { id: 'tuna_red', name: { ja: 'まぐろ（赤身）', en: 'Tuna (lean)' }, aliases: ['まぐろ', 'マグロ', '鮪', '赤身', 'tuna sashimi', '鉄火'], emoji: '🍣', cat: 'fish', unit: U('切れ', 'slice', 15), serving: 75,
    per100: n({ kcal: 115, p: 25.4, f: 2.3, c: 0.3, va: 17, ve: 0.9, fe: 0.9, zn: 0.4, ca: 3, k: 440, n3: 0.3 }), tier: { ease: 1, price: 3, overeat: 1 } },
  { id: 'tuna_can', name: { ja: 'ツナ缶（水煮）', en: 'Canned tuna (in water)' }, aliases: ['ツナ缶', 'ツナ', 'シーチキン', 'tuna can', 'canned tuna'], emoji: '🥫', cat: 'fish', unit: U('缶', 'can', 70), serving: 70,
    per100: n({ kcal: 70, p: 16.0, f: 0.7, c: 0.2, va: 4, ve: 0.4, fe: 0.6, zn: 0.7, ca: 5, k: 230, n3: 0.2 }), tier: { ease: 1, price: 1, overeat: 1 } },
  { id: 'bonito', name: { ja: 'かつお（春獲り）', en: 'Bonito' }, aliases: ['かつお', 'カツオ', '鰹', 'たたき', 'bonito'], emoji: '🐟', cat: 'fish', unit: U('切れ', 'slice', 15), serving: 75,
    per100: n({ kcal: 108, p: 25.8, f: 0.5, c: 0.1, va: 5, ve: 0.3, fe: 1.9, zn: 0.8, ca: 11, k: 430, n3: 0.2 }), tier: { ease: 1, price: 2, overeat: 1 } },
  { id: 'yellowtail', name: { ja: 'ぶり', en: 'Yellowtail' }, aliases: ['ぶり', 'ブリ', '鰤', 'はまち', 'ハマチ', 'yellowtail'], emoji: '🐟', cat: 'fish', unit: U('切れ', 'fillet', 80), serving: 80,
    per100: n({ kcal: 222, p: 21.4, f: 17.6, c: 0.3, va: 50, vc: 2, ve: 2.0, fe: 1.3, zn: 0.7, ca: 5, k: 380, n3: 3.4 }), tier: { ease: 2, price: 2, overeat: 1 } },
  { id: 'horse_mackerel', name: { ja: 'あじ', en: 'Horse mackerel' }, aliases: ['あじ', 'アジ', '鯵', 'horse mackerel'], emoji: '🐟', cat: 'fish', unit: U('尾', 'fish', 70), serving: 70,
    per100: n({ kcal: 112, p: 19.7, f: 4.5, c: 0.1, va: 7, ve: 0.6, fe: 0.6, zn: 1.1, ca: 66, k: 360, n3: 1.1 }), tier: { ease: 2, price: 1, overeat: 1 } },
  { id: 'sardine', name: { ja: 'いわし（まいわし）', en: 'Sardine' }, aliases: ['いわし', 'イワシ', '鰯', 'sardine'], emoji: '🐟', cat: 'fish', unit: U('尾', 'fish', 50), serving: 100,
    per100: n({ kcal: 156, p: 19.2, f: 9.2, c: 0.2, va: 8, ve: 2.5, fe: 2.1, zn: 1.6, ca: 74, k: 270, n3: 2.1 }), tier: { ease: 2, price: 1, overeat: 1 } },
  { id: 'cod', name: { ja: 'たら（まだら）', en: 'Cod' }, aliases: ['たら', 'タラ', '鱈', 'cod'], emoji: '🐟', cat: 'fish', unit: U('切れ', 'fillet', 80), serving: 80,
    per100: n({ kcal: 72, p: 17.6, f: 0.2, c: 0.1, va: 10, ve: 0.8, fe: 0.2, zn: 0.5, ca: 32, k: 350, n3: 0.1 }), tier: { ease: 2, price: 2, overeat: 1 } },
  { id: 'shrimp', name: { ja: 'えび（バナメイ）', en: 'Shrimp' }, aliases: ['えび', 'エビ', '海老', 'shrimp', 'prawn'], emoji: '🦐', cat: 'fish', unit: U('尾', 'shrimp', 15), serving: 75,
    per100: n({ kcal: 82, p: 19.6, f: 0.6, c: 0.7, va: 0, ve: 1.7, fe: 1.4, zn: 1.2, ca: 68, k: 270, n3: 0.1 }), tier: { ease: 2, price: 3, overeat: 1 } },
  { id: 'oyster', name: { ja: 'かき（養殖・生）', en: 'Oyster' }, aliases: ['かき', 'カキ', '牡蠣', 'oyster'], emoji: '🦪', cat: 'fish', unit: U('個', 'oyster', 20), serving: 60,
    per100: n({ kcal: 58, p: 6.9, f: 2.2, c: 4.9, va: 24, vc: 3, ve: 1.3, fe: 2.1, zn: 14.0, ca: 84, k: 190, n3: 0.5 }), tier: { ease: 2, price: 3, overeat: 1 } },
  { id: 'clam', name: { ja: 'あさり', en: 'Clam' }, aliases: ['あさり', 'アサリ', 'clam'], emoji: '🐚', cat: 'fish', unit: U('個', 'clam', 5), serving: 50,
    per100: n({ kcal: 27, p: 6.0, f: 0.3, c: 0.4, va: 4, vc: 1, ve: 0.4, fe: 3.8, zn: 1.0, ca: 66, k: 140 }), tier: { ease: 2, price: 2, overeat: 1 } },
  { id: 'scallop', name: { ja: 'ほたて貝柱', en: 'Scallop' }, aliases: ['ほたて', 'ホタテ', '帆立', 'scallop'], emoji: '🐚', cat: 'fish', unit: U('個', 'scallop', 25), serving: 75,
    per100: n({ kcal: 82, p: 16.9, f: 0.3, c: 3.5, va: 1, ve: 0.8, fe: 0.2, zn: 1.5, ca: 7, k: 380, n3: 0.1 }), tier: { ease: 1, price: 3, overeat: 1 } },
  { id: 'squid', name: { ja: 'いか（するめいか）', en: 'Squid' }, aliases: ['いか', 'イカ', '烏賊', 'squid'], emoji: '🦑', cat: 'fish', unit: U('杯', 'squid', 200), serving: 80,
    per100: n({ kcal: 76, p: 17.9, f: 0.8, c: 0.1, va: 13, vc: 1, ve: 2.1, fe: 0.1, zn: 1.5, ca: 11, k: 300, n3: 0.3 }), tier: { ease: 2, price: 2, overeat: 1 } },
  { id: 'eel', name: { ja: 'うなぎ蒲焼', en: 'Grilled eel' }, aliases: ['うなぎ', 'ウナギ', '鰻', '蒲焼', 'eel'], emoji: '🍱', cat: 'fish', unit: U('串', 'skewer', 100), serving: 100,
    per100: n({ kcal: 285, p: 23.0, f: 21.0, c: 3.1, va: 1500, ve: 4.9, fe: 0.8, zn: 2.7, ca: 150, k: 300, n3: 2.9 }), tier: { ease: 1, price: 3, overeat: 2 } },
  { id: 'shirasu', name: { ja: 'しらす干し', en: 'Dried whitebait' }, aliases: ['しらす', 'シラス', 'ちりめん', 'whitebait'], emoji: '🐟', cat: 'fish', unit: U('大さじ', 'tbsp', 5, true), serving: 10,
    per100: n({ kcal: 187, p: 40.5, f: 3.1, c: 0.5, va: 240, ve: 1.1, fe: 0.8, zn: 3.0, ca: 520, k: 490, n3: 1.0 }), tier: { ease: 1, price: 2, overeat: 1 } },
  { id: 'chikuwa', name: { ja: 'ちくわ', en: 'Chikuwa (fish cake)' }, aliases: ['ちくわ', '竹輪', 'chikuwa'], emoji: '🍢', cat: 'processed', unit: U('本', 'piece', 30), serving: 60,
    per100: n({ kcal: 119, p: 12.2, f: 2.0, c: 13.5, fe: 1.0, zn: 0.3, ca: 15, k: 95 }), tier: { ease: 1, price: 1, overeat: 2 } },
  // ---- 野菜 ----
  { id: 'red_pepper', name: { ja: '赤パプリカ', en: 'Red bell pepper' }, aliases: ['赤パプリカ', 'パプリカ', '赤ピーマン', 'red pepper', 'bell pepper'], emoji: '🫑', cat: 'veg', unit: U('個', 'pepper', 150), serving: 75,
    per100: n({ kcal: 28, p: 1.0, f: 0.2, c: 7.2, va: 88, vc: 170, ve: 4.3, fe: 0.4, zn: 0.2, ca: 7, k: 210, fib: 1.6 }) },
  { id: 'green_pepper', name: { ja: 'ピーマン', en: 'Green pepper' }, aliases: ['ピーマン', 'green pepper'], emoji: '🫑', cat: 'veg', unit: U('個', 'pepper', 30), serving: 60,
    per100: n({ kcal: 20, p: 0.9, f: 0.2, c: 5.1, va: 33, vc: 76, ve: 0.8, fe: 0.4, zn: 0.2, ca: 11, k: 190, fib: 2.3 }) },
  { id: 'broccoli', name: { ja: 'ブロッコリー', en: 'Broccoli' }, aliases: ['ブロッコリー', 'broccoli'], emoji: '🥦', cat: 'veg', unit: U('房', 'floret', 15), serving: 80,
    per100: n({ kcal: 37, p: 5.4, f: 0.6, c: 6.6, va: 75, vc: 140, ve: 3.0, fe: 1.3, zn: 0.8, ca: 50, k: 460, fib: 5.1 }) },
  { id: 'spinach', name: { ja: 'ほうれん草', en: 'Spinach' }, aliases: ['ほうれん草', 'ホウレンソウ', 'ほうれんそう', 'spinach'], emoji: '🥬', cat: 'veg', unit: U('束', 'bunch', 200), serving: 80,
    per100: n({ kcal: 18, p: 2.2, f: 0.4, c: 3.1, va: 350, vc: 35, ve: 2.1, fe: 2.0, zn: 0.7, ca: 49, k: 690, fib: 2.8 }) },
  { id: 'komatsuna', name: { ja: '小松菜', en: 'Komatsuna' }, aliases: ['小松菜', 'こまつな', 'komatsuna'], emoji: '🥬', cat: 'veg', unit: U('束', 'bunch', 300), serving: 80,
    per100: n({ kcal: 13, p: 1.5, f: 0.2, c: 2.4, va: 260, vc: 39, ve: 0.9, fe: 2.8, zn: 0.2, ca: 170, k: 500, fib: 1.9 }) },
  { id: 'moroheiya', name: { ja: 'モロヘイヤ', en: 'Moroheiya (jute leaf)' }, aliases: ['モロヘイヤ', 'moroheiya'], emoji: '🥬', cat: 'veg', unit: U('束', 'bunch', 100), serving: 50,
    per100: n({ kcal: 36, p: 4.8, f: 0.5, c: 6.3, va: 840, vc: 65, ve: 6.5, fe: 1.0, zn: 0.6, ca: 260, k: 530, fib: 5.9 }) },
  { id: 'nira', name: { ja: 'にら', en: 'Garlic chives' }, aliases: ['にら', 'ニラ', '韮'], emoji: '🌿', cat: 'veg', unit: U('束', 'bunch', 100), serving: 50,
    per100: n({ kcal: 18, p: 1.7, f: 0.3, c: 4.0, va: 290, vc: 19, ve: 2.5, fe: 0.7, zn: 0.3, ca: 48, k: 510, fib: 2.7 }) },
  { id: 'carrot', name: { ja: 'にんじん', en: 'Carrot' }, aliases: ['にんじん', 'ニンジン', '人参', 'carrot'], emoji: '🥕', cat: 'veg', unit: U('本', 'carrot', 150), serving: 50,
    per100: n({ kcal: 35, p: 0.7, f: 0.2, c: 8.7, va: 720, vc: 6, ve: 0.4, fe: 0.2, zn: 0.2, ca: 28, k: 300, fib: 2.8 }) },
  { id: 'pumpkin', name: { ja: 'かぼちゃ（西洋）', en: 'Kabocha pumpkin' }, aliases: ['かぼちゃ', 'カボチャ', '南瓜', 'pumpkin', 'kabocha'], emoji: '🎃', cat: 'veg', unit: U('切れ', 'piece', 50), serving: 100,
    per100: n({ kcal: 78, p: 1.9, f: 0.3, c: 20.6, va: 330, vc: 43, ve: 4.9, fe: 0.5, zn: 0.3, ca: 15, k: 450, fib: 3.5 }) },
  { id: 'tomato', name: { ja: 'トマト', en: 'Tomato' }, aliases: ['トマト', 'とまと', 'tomato'], emoji: '🍅', cat: 'veg', unit: U('個', 'tomato', 150), serving: 150,
    per100: n({ kcal: 20, p: 0.7, f: 0.1, c: 4.7, va: 45, vc: 15, ve: 0.9, fe: 0.2, zn: 0.1, ca: 7, k: 210, fib: 1.0 }) },
  { id: 'cabbage', name: { ja: 'キャベツ', en: 'Cabbage' }, aliases: ['キャベツ', 'cabbage'], emoji: '🥬', cat: 'veg', unit: U('枚', 'leaf', 50), serving: 100,
    per100: n({ kcal: 21, p: 1.3, f: 0.2, c: 5.2, va: 4, vc: 41, ve: 0.1, fe: 0.3, zn: 0.2, ca: 43, k: 200, fib: 1.8 }) },
  { id: 'lettuce', name: { ja: 'レタス', en: 'Lettuce' }, aliases: ['レタス', 'lettuce', 'サラダ'], emoji: '🥗', cat: 'veg', unit: U('枚', 'leaf', 30), serving: 60,
    per100: n({ kcal: 11, p: 0.6, f: 0.1, c: 2.8, va: 20, vc: 5, ve: 0.3, fe: 0.3, zn: 0.2, ca: 19, k: 200, fib: 1.1 }) },
  { id: 'cucumber', name: { ja: 'きゅうり', en: 'Cucumber' }, aliases: ['きゅうり', 'キュウリ', '胡瓜', 'cucumber'], emoji: '🥒', cat: 'veg', unit: U('本', 'cucumber', 100), serving: 100,
    per100: n({ kcal: 13, p: 1.0, f: 0.1, c: 3.0, va: 28, vc: 14, ve: 0.3, fe: 0.3, zn: 0.2, ca: 26, k: 200, fib: 1.1 }) },
  { id: 'onion', name: { ja: '玉ねぎ', en: 'Onion' }, aliases: ['玉ねぎ', 'たまねぎ', 'タマネギ', 'onion'], emoji: '🧅', cat: 'veg', unit: U('個', 'onion', 200), serving: 50,
    per100: n({ kcal: 33, p: 1.0, f: 0.1, c: 8.4, vc: 7, fe: 0.3, zn: 0.2, ca: 17, k: 150, fib: 1.5 }) },
  { id: 'daikon', name: { ja: '大根', en: 'Daikon radish' }, aliases: ['大根', 'だいこん', 'daikon'], emoji: '🥕', cat: 'veg', unit: U('本', 'radish', 900), serving: 100,
    per100: n({ kcal: 15, p: 0.4, f: 0.1, c: 4.1, vc: 12, fe: 0.2, zn: 0.2, ca: 24, k: 230, fib: 1.4 }) },
  { id: 'bean_sprouts', name: { ja: 'もやし', en: 'Bean sprouts' }, aliases: ['もやし', 'モヤシ', 'bean sprouts'], emoji: '🌱', cat: 'veg', unit: U('袋', 'bag', 200), serving: 100,
    per100: n({ kcal: 15, p: 1.7, f: 0.1, c: 2.6, vc: 8, fe: 0.2, zn: 0.3, ca: 10, k: 69, fib: 1.3 }) },
  { id: 'shimeji', name: { ja: 'しめじ', en: 'Shimeji mushroom' }, aliases: ['しめじ', 'シメジ', 'きのこ', 'キノコ', 'mushroom'], emoji: '🍄', cat: 'veg', unit: U('パック', 'pack', 100), serving: 50,
    per100: n({ kcal: 22, p: 2.7, f: 0.5, c: 4.8, fe: 0.5, zn: 0.5, ca: 1, k: 370, fib: 3.0 }) },
  { id: 'avocado', name: { ja: 'アボカド', en: 'Avocado' }, aliases: ['アボカド', 'アボガド', 'avocado'], emoji: '🥑', cat: 'fruit', unit: U('個', 'avocado', 140), serving: 70,
    per100: n({ kcal: 176, p: 2.1, f: 17.5, c: 7.9, va: 7, vc: 12, ve: 3.3, fe: 0.6, zn: 0.7, ca: 8, k: 590, fib: 5.6 }) },
  { id: 'sweet_potato', name: { ja: 'さつまいも', en: 'Sweet potato' }, aliases: ['さつまいも', 'サツマイモ', '薩摩芋', '焼き芋', 'sweet potato'], emoji: '🍠', cat: 'veg', unit: U('本', 'potato', 200), serving: 100,
    per100: n({ kcal: 126, p: 1.2, f: 0.2, c: 31.9, va: 2, vc: 29, ve: 1.5, fe: 0.6, zn: 0.2, ca: 36, k: 480, fib: 2.2 }) },
  // ---- 果物 ----
  { id: 'orange', name: { ja: 'オレンジ', en: 'Orange' }, aliases: ['オレンジ', 'orange', 'ネーブル'], emoji: '🍊', cat: 'fruit', unit: U('個', 'orange', 130), serving: 130,
    per100: n({ kcal: 48, p: 0.9, f: 0.1, c: 11.8, va: 11, vc: 60, ve: 0.3, fe: 0.2, zn: 0.1, ca: 24, k: 180, fib: 1.0 }) },
  { id: 'mikan', name: { ja: 'みかん', en: 'Mikan (mandarin)' }, aliases: ['みかん', 'ミカン', '蜜柑', 'mandarin', 'mikan'], emoji: '🍊', cat: 'fruit', unit: U('個', 'mandarin', 80), serving: 80,
    per100: n({ kcal: 49, p: 0.7, f: 0.1, c: 12.0, va: 84, vc: 32, ve: 0.4, fe: 0.2, zn: 0.1, ca: 21, k: 150, fib: 1.0 }) },
  { id: 'kiwi', name: { ja: 'キウイ', en: 'Kiwi' }, aliases: ['キウイ', 'kiwi'], emoji: '🥝', cat: 'fruit', unit: U('個', 'kiwi', 85), serving: 85,
    per100: n({ kcal: 51, p: 1.0, f: 0.2, c: 13.4, va: 4, vc: 71, ve: 1.3, fe: 0.3, zn: 0.1, ca: 26, k: 300, fib: 2.6 }) },
  { id: 'strawberry', name: { ja: 'いちご', en: 'Strawberry' }, aliases: ['いちご', 'イチゴ', '苺', 'strawberry'], emoji: '🍓', cat: 'fruit', unit: U('個', 'berry', 15), serving: 75,
    per100: n({ kcal: 31, p: 0.9, f: 0.1, c: 8.5, va: 1, vc: 62, ve: 0.4, fe: 0.3, zn: 0.2, ca: 17, k: 170, fib: 1.4 }) },
  { id: 'banana', name: { ja: 'バナナ', en: 'Banana' }, aliases: ['バナナ', 'banana'], emoji: '🍌', cat: 'fruit', unit: U('本', 'banana', 100), serving: 100,
    per100: n({ kcal: 93, p: 1.1, f: 0.2, c: 22.5, va: 5, vc: 16, ve: 0.5, fe: 0.3, zn: 0.2, ca: 6, k: 360, fib: 1.1 }) },
  { id: 'apple', name: { ja: 'りんご', en: 'Apple' }, aliases: ['りんご', 'リンゴ', '林檎', 'apple'], emoji: '🍎', cat: 'fruit', unit: U('個', 'apple', 250), serving: 125,
    per100: n({ kcal: 53, p: 0.1, f: 0.2, c: 15.5, va: 1, vc: 4, ve: 0.1, fe: 0.1, zn: 0, ca: 3, k: 120, fib: 1.4 }) },
  { id: 'blueberry', name: { ja: 'ブルーベリー', en: 'Blueberry' }, aliases: ['ブルーベリー', 'blueberry'], emoji: '🫐', cat: 'fruit', unit: U('粒', 'berry', 2), serving: 50,
    per100: n({ kcal: 48, p: 0.5, f: 0.1, c: 12.9, va: 5, vc: 9, ve: 1.7, fe: 0.2, zn: 0.1, ca: 8, k: 70, fib: 3.3 }) },
  // ---- 主食 ----
  { id: 'rice', name: { ja: 'ごはん（白米）', en: 'White rice (cooked)' }, aliases: ['ご飯', 'ごはん', '白米', 'ライス', 'おにぎり', 'rice'], emoji: '🍚', cat: 'grain', unit: U('杯', 'bowl', 150), serving: 150,
    per100: n({ kcal: 156, p: 2.5, f: 0.3, c: 37.1, fe: 0.1, zn: 0.6, ca: 3, k: 29, fib: 1.5 }) },
  { id: 'brown_rice', name: { ja: '玄米ごはん', en: 'Brown rice (cooked)' }, aliases: ['玄米', 'brown rice'], emoji: '🍚', cat: 'grain', unit: U('杯', 'bowl', 150), serving: 150,
    per100: n({ kcal: 152, p: 2.8, f: 1.0, c: 35.6, ve: 0.5, fe: 0.6, zn: 0.8, ca: 7, k: 95, fib: 1.4 }) },
  { id: 'bread', name: { ja: '食パン', en: 'White bread' }, aliases: ['食パン', 'パン', 'トースト', 'bread', 'toast'], emoji: '🍞', cat: 'grain', unit: U('枚', 'slice', 60), serving: 60,
    per100: n({ kcal: 248, p: 8.9, f: 4.1, c: 46.4, ve: 0.4, fe: 0.5, zn: 0.5, ca: 22, k: 86, fib: 4.2 }) },
  { id: 'oatmeal', name: { ja: 'オートミール', en: 'Oatmeal' }, aliases: ['オートミール', 'オーツ', 'oatmeal', 'oats'], emoji: '🥣', cat: 'grain', unit: U('杯', 'serving', 30), serving: 30,
    per100: n({ kcal: 350, p: 13.7, f: 5.7, c: 69.1, ve: 0.6, fe: 3.9, zn: 2.1, ca: 47, k: 260, fib: 9.4 }) },
  { id: 'udon', name: { ja: 'うどん（ゆで）', en: 'Udon (boiled)' }, aliases: ['うどん', 'udon'], emoji: '🍜', cat: 'grain', unit: U('玉', 'portion', 250), serving: 250,
    per100: n({ kcal: 95, p: 2.6, f: 0.4, c: 21.6, fe: 0.2, zn: 0.1, ca: 6, k: 9, fib: 1.3 }) },
  { id: 'soba', name: { ja: 'そば（ゆで）', en: 'Soba (boiled)' }, aliases: ['そば', '蕎麦', 'soba'], emoji: '🍜', cat: 'grain', unit: U('玉', 'portion', 200), serving: 200,
    per100: n({ kcal: 130, p: 4.8, f: 1.0, c: 26.0, ve: 0.2, fe: 0.8, zn: 0.4, ca: 9, k: 34, fib: 2.9 }) },
  { id: 'pasta', name: { ja: 'パスタ（ゆで）', en: 'Pasta (boiled)' }, aliases: ['パスタ', 'スパゲ', 'pasta', 'spaghetti'], emoji: '🍝', cat: 'grain', unit: U('皿', 'plate', 250), serving: 250,
    per100: n({ kcal: 150, p: 5.8, f: 0.9, c: 32.2, ve: 0.2, fe: 0.7, zn: 0.7, ca: 8, k: 14, fib: 3.0 }) },
  // ---- 種実・油 ----
  { id: 'almond', name: { ja: 'アーモンド', en: 'Almond' }, aliases: ['アーモンド', 'almond'], emoji: '🌰', cat: 'nuts', unit: U('粒', 'nut', 1), serving: 25,
    per100: n({ kcal: 608, p: 20.3, f: 51.8, c: 20.7, va: 1, ve: 30.0, fe: 3.6, zn: 3.6, ca: 250, k: 760, fib: 10.1 }) },
  { id: 'walnut', name: { ja: 'くるみ', en: 'Walnut' }, aliases: ['くるみ', 'クルミ', '胡桃', 'walnut'], emoji: '🌰', cat: 'nuts', unit: U('粒', 'nut', 4), serving: 28,
    per100: n({ kcal: 713, p: 14.6, f: 68.8, c: 11.7, va: 2, ve: 1.2, fe: 2.6, zn: 2.6, ca: 85, k: 540, fib: 7.5, n3: 9.0 }) },
  { id: 'cashew', name: { ja: 'カシューナッツ', en: 'Cashew' }, aliases: ['カシューナッツ', 'カシュー', 'cashew'], emoji: '🌰', cat: 'nuts', unit: U('粒', 'nut', 1.5), serving: 25,
    per100: n({ kcal: 591, p: 19.8, f: 47.6, c: 26.7, va: 1, ve: 0.6, fe: 4.8, zn: 5.4, ca: 38, k: 590, fib: 6.7 }) },
  { id: 'sesame', name: { ja: 'いりごま', en: 'Roasted sesame' }, aliases: ['ごま', 'ゴマ', '胡麻', 'sesame'], emoji: '🫘', cat: 'nuts', unit: U('大さじ', 'tbsp', 9, true), serving: 9,
    per100: n({ kcal: 605, p: 20.3, f: 54.2, c: 18.5, va: 1, ve: 0.1, fe: 9.9, zn: 5.9, ca: 1200, k: 410, fib: 12.6 }) },
  { id: 'sunflower_oil', name: { ja: 'ひまわり油', en: 'Sunflower oil' }, aliases: ['ひまわり油', 'ヒマワリ油', 'sunflower oil'], emoji: '🌻', cat: 'oil', unit: U('大さじ', 'tbsp', 12, true), serving: 12,
    per100: n({ kcal: 886, p: 0, f: 100, c: 0, ve: 39.0 }) },
  { id: 'olive_oil', name: { ja: 'オリーブオイル', en: 'Olive oil' }, aliases: ['オリーブオイル', 'オリーブ油', 'olive oil'], emoji: '🫒', cat: 'oil', unit: U('大さじ', 'tbsp', 12, true), serving: 12,
    per100: n({ kcal: 894, p: 0, f: 100, c: 0, ve: 7.4 }) },
  { id: 'perilla_oil', name: { ja: 'えごま油', en: 'Perilla oil' }, aliases: ['えごま油', 'エゴマ油', 'あまに油', 'アマニ油', 'perilla oil', 'flaxseed oil'], emoji: '🫙', cat: 'oil', unit: U('小さじ', 'tsp', 4, true), serving: 4,
    per100: n({ kcal: 897, p: 0, f: 100, c: 0, ve: 2.4, n3: 58.3 }) },
  // ---- 海藻 ----
  { id: 'wakame_dry', name: { ja: '乾燥わかめ', en: 'Dried wakame' }, aliases: ['乾燥わかめ', 'わかめ', 'ワカメ', '若布', 'wakame'], emoji: '🌿', cat: 'seaweed', unit: U('大さじ', 'tbsp', 3, true), serving: 6,
    per100: n({ kcal: 164, p: 13.6, f: 1.6, c: 41.3, va: 650, vc: 27, ve: 1.0, fe: 2.6, zn: 0.9, ca: 780, k: 5200, fib: 32.7 }) },
  { id: 'hijiki_dry', name: { ja: 'ひじき（乾）', en: 'Dried hijiki' }, aliases: ['ひじき', 'ヒジキ', 'hijiki'], emoji: '🌿', cat: 'seaweed', unit: U('大さじ', 'tbsp', 3, true), serving: 6,
    per100: n({ kcal: 180, p: 9.2, f: 3.2, c: 58.4, va: 360, ve: 5.0, fe: 6.2, zn: 1.0, ca: 1000, k: 6400, fib: 51.8 }) },
];

// ===== リモート差し替え（kind 'nutrients'・検証は lib/remoteContent.validateNutrientFood） =====

/** 同梱＋リモート（同idは上書き・新idは追加）。呼び出しのたびに組むが数十件なので軽い */
export function getNutrientDb(): NutrientFood[] {
  const remote = getRemoteContent().nutrients;
  if (!remote || remote.length === 0) return NUTRIENT_DB;
  return mergeById(NUTRIENT_DB, remote);
}

// ===== 参照ユーティリティ（純関数） =====

/** 表示名（現在の言語） */
export function foodName(f: NutrientFood, locale?: string): string {
  return pickL10n(f.name, locale);
}

// 全角英数字→半角・小文字（foodTags.normalize と同じ吸収）
function normalize(s: string): string {
  return String(s ?? '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/**
 * 品目名 → 食材。名前（ja/en）と別名の部分一致で探し、**最も長く一致した別名**の食材を返す
 * （「赤パプリカ」は「パプリカ」より長いので赤パプリカに、「鶏もも肉（皮なし）」は皮つきより長いので皮なしに）。
 * 見つからなければ null。栄養計算の正本ではないので、誤爆より取りこぼしを許容する
 */
export function findFood(name: string, db: NutrientFood[] = getNutrientDb()): NutrientFood | null {
  const q = normalize(name);
  if (!q) return null;
  let best: NutrientFood | null = null;
  let bestLen = 0;
  for (const f of db) {
    const words = [...f.aliases, ...(typeof f.name === 'string' ? [f.name] : Object.values(f.name))];
    for (const w of words) {
      const nw = normalize(w);
      if (nw.length > bestLen && q.includes(nw)) { best = f; bestLen = nw.length; }
    }
  }
  return best;
}

/** g あたりの栄養量（100gあたり × g/100） */
export function nutrientOf(f: NutrientFood, key: NavNutrient, grams: number): number {
  return (f.per100[key] * grams) / 100;
}

/** kcal（g あたり） */
export function kcalOf(f: NutrientFood, grams: number): number {
  return (f.per100.kcal * grams) / 100;
}

/** 得意な栄養素と呼ぶ最低ライン: 1食で1日の目安の15%（ごはん1杯の食物繊維11%・食パン1枚の12%は「得意」と呼ばない） */
const SIGNATURE_MIN_RATIO = 0.15;

/**
 * その食材の「得意な栄養素」= 1食の目安量で1日の目安に対する充足率が最大の栄養素。
 * 置き換え候補で栄養素の指定が無いときの既定。どの栄養素も15%未満なら null（主食・油など）
 */
export function signatureNutrient(f: NutrientFood): NavNutrient | null {
  let best: NavNutrient | null = null;
  let bestRatio = SIGNATURE_MIN_RATIO;
  for (const key of NAV_NUTRIENTS) {
    const ratio = nutrientOf(f, key, f.serving) / NUTRIENT_META[key].ref;
    if (ratio > bestRatio) { best = key; bestRatio = ratio; }
  }
  return best;
}

/**
 * 栄養素のランキング（多い順・上位n件）。basis='serving' は1食の目安量あたり、'100g' は100gあたり。
 * 0 の食材は載せない
 */
export function rankByNutrient(key: NavNutrient, basis: 'serving' | '100g', top = 10, db: NutrientFood[] = getNutrientDb()): { food: NutrientFood; amount: number; grams: number }[] {
  return db
    .map((food) => {
      const grams = basis === 'serving' ? food.serving : 100;
      return { food, amount: nutrientOf(food, key, grams), grams };
    })
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, top);
}

/** 表示用の丸め（栄養素ごとの小数桁） */
export function fmtAmount(key: NavNutrient, v: number): string {
  const d = NUTRIENT_META[key].decimals;
  const r = Math.round(v * 10 ** d) / 10 ** d;
  return d === 0 ? Math.round(r).toLocaleString() : r.toFixed(d);
}
