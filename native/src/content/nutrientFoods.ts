// 不足栄養素タブの「おすすめ食材」（食材図鑑 content/nutrientDb.ts に無い軸のぶん）
//
// 図鑑が 100g あたりの値を持つ栄養素（たんぱく質・鉄・ビタミンA/C/E・亜鉛・カルシウム・食物繊維・n-3・カリウム）は
// rankByNutrient で多い順に出せる。それ以外の栄養素は図鑑に列が無いので、日本食品標準成分表（八訂）で
// その栄養素が多い食材を **図鑑の id** で列挙しておく（食べたことのある食材を先頭に出す判定が id で効く）。
// 並びは「1食の目安量で多い順」のおおよそ。レバー類は末尾（ビタミンAが多く、毎日は勧めない。lib/nutrientIntake が注記を添える）。
// 効能は書かない。食材名と数値だけ（docs/NUTRIENTS.md §1.2）。
import type { NutrientKey } from '@/lib/items';
import type { NavNutrient } from '@/content/nutrientDb';

/** 記録の栄養素キー → 図鑑の軸（同名のもの） */
export const LOG_TO_NAV: Partial<Record<'p' | 'f' | 'c' | NutrientKey, NavNutrient>> = {
  p: 'p', fib: 'fib', k: 'k', ca: 'ca', fe: 'fe', zn: 'zn', vc: 'vc', va: 'va', ve: 've', n3: 'n3',
};

/** 図鑑に軸が無い栄養素のおすすめ食材（図鑑 id）。多い順のおおよそ */
export const RICH_FOOD_IDS: Partial<Record<'p' | 'f' | 'c' | NutrientKey, readonly string[]>> = {
  f:    ['avocado', 'almond', 'walnut', 'salmon', 'mackerel', 'egg', 'olive_oil', 'cheese'],
  c:    ['rice', 'brown_rice', 'oatmeal', 'sweet_potato', 'banana', 'bread', 'udon', 'soba', 'pasta'],
  mg:   ['almond', 'natto', 'soybeans', 'sesame', 'spinach', 'brown_rice', 'wakame_dry', 'hijiki_dry', 'tofu_firm', 'banana'],
  vd:   ['salmon', 'saury', 'sardine', 'mackerel', 'mackerel_can', 'shirasu', 'yellowtail', 'horse_mackerel', 'eel', 'egg'],
  vk:   ['natto', 'spinach', 'komatsuna', 'moroheiya', 'broccoli', 'nira', 'wakame_dry', 'cabbage', 'lettuce', 'egg'],
  vb1:  ['pork_fillet', 'pork_leg', 'pork_loin', 'soybeans', 'natto', 'edamame', 'brown_rice', 'eel', 'ham', 'oatmeal'],
  vb2:  ['eel', 'natto', 'egg', 'milk', 'yogurt', 'cheese', 'mackerel', 'saury', 'almond', 'chicken_liver', 'pork_liver'],
  nia:  ['bonito', 'tuna_red', 'chicken_breast', 'chicken_tender', 'mackerel', 'saury', 'salmon', 'yellowtail', 'shimeji', 'pork_liver'],
  vb6:  ['bonito', 'tuna_red', 'salmon', 'chicken_breast', 'chicken_tender', 'banana', 'pork_fillet', 'beef_round', 'sweet_potato', 'yellowtail'],
  vb12: ['clam', 'oyster', 'mackerel', 'saury', 'sardine', 'salmon', 'shirasu', 'egg', 'cheese', 'chicken_liver', 'pork_liver'],
  fol:  ['edamame', 'broccoli', 'spinach', 'moroheiya', 'natto', 'strawberry', 'avocado', 'komatsuna', 'chicken_liver', 'pork_liver'],
  pan:  ['egg', 'natto', 'chicken_breast', 'salmon', 'avocado', 'shimeji', 'milk', 'sweet_potato', 'chicken_liver', 'pork_liver'],
  bio:  ['egg', 'natto', 'soybeans', 'almond', 'walnut', 'mackerel', 'sardine', 'shimeji', 'chicken_liver', 'pork_liver'],
  phos: ['cheese', 'shirasu', 'sardine', 'egg', 'milk', 'yogurt', 'tuna_can', 'chicken_breast', 'natto', 'almond'],
  cu:   ['oyster', 'squid', 'shrimp', 'cashew', 'almond', 'walnut', 'soybeans', 'natto', 'sesame', 'pork_liver', 'chicken_liver'],
  mn:   ['brown_rice', 'oatmeal', 'natto', 'soybeans', 'almond', 'walnut', 'spinach', 'sweet_potato', 'tofu_firm', 'hijiki_dry'],
  iod:  ['wakame_dry', 'hijiki_dry', 'cod', 'mackerel', 'saury', 'egg', 'milk'],
  se:   ['tuna_red', 'bonito', 'sardine', 'mackerel', 'saury', 'cod', 'squid', 'egg', 'pork_liver', 'chicken_liver'],
  cr:   ['hijiki_dry', 'wakame_dry', 'brown_rice', 'soybeans', 'cheese', 'egg', 'shimeji', 'almond'],
  mo:   ['natto', 'soybeans', 'edamame', 'tofu_firm', 'brown_rice', 'oatmeal', 'almond', 'bread', 'pork_liver', 'chicken_liver'],
  n6:   ['walnut', 'sesame', 'sunflower_oil', 'almond', 'natto', 'soybeans', 'cashew'],
};

/** レバー類（ビタミンAが多い。候補に載せるときは注記を添え、上位には出さない） */
export const LIVER_IDS: readonly string[] = ['chicken_liver', 'pork_liver'];
