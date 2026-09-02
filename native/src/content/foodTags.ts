// 食材タグ辞書（インサイト・エンジン §1「食材」群の土台）
//
// 品目名の部分一致で「小麦・米・鶏肉・鮭・魚・乳製品・甘い飲み物」に振り分け、
// 1日あたりの摂取g（ml）を推定する。目的は「小麦中心の日」「今月サーモン◯g」といった
// 粗い傾向の把握であって、栄養計算ではない（±30%程度の誤差は許容する設計）。
//
// 方針:
//  ・誤検知より取りこぼしを許容する（foodName.ts と同じ線）。ただし食材タグは「鶏むね/鶏もも」の
//    区別が要らない粗い分類なので、部分一致で寄せてよい
//  ・除外語（無糖・鶏卵など）で明らかな誤爆だけ潰す
//  ・分量: qty に g/ml があればそれを使う。個数単位（個・枚・杯…）は「1品＝標準量」の目安表×個数。
//    読めなければ標準量1つぶん
//  ・純関数のみ（テスト対象）。UI文字列は無い（タグ名は表示しない内部キー）

export type FoodTag = 'wheat' | 'rice' | 'chicken' | 'salmon' | 'fish' | 'dairy' | 'sugar_drink';

export const FOOD_TAGS: FoodTag[] = ['wheat', 'rice', 'chicken', 'salmon', 'fish', 'dairy', 'sugar_drink'];

/** 部分一致の語（ひらがな・カタカナ・漢字の主要表記。大小文字/全角半角は normalize で吸収） */
export const FOOD_TAG_WORDS: Record<FoodTag, string[]> = {
  wheat: ['パン', 'うどん', 'パスタ', 'スパゲ', 'ラーメン', 'ピザ', '小麦', '食パン', 'ベーグル', 'クロワッサン', 'トースト',
    'サンドイッチ', 'サンド', 'ハンバーガー', 'バーガー', '餃子', 'お好み焼き', 'たこ焼き', 'クッキー', 'ケーキ', 'ドーナツ',
    'マフィン', 'ワッフル', 'クレープ', '焼きそば', 'そうめん', 'ひやむぎ', '中華麺', 'つけ麺', 'カップ麺', 'カップヌードル',
    'ビスケット', 'クラッカー', 'シリアル', 'グラノーラ', 'パイ', 'タルト', 'ホットケーキ', 'パンケーキ', 'フランスパン', 'バゲット'],
  rice: ['ご飯', 'ごはん', '御飯', '白米', '玄米', '雑穀米', '五穀米', '十六穀', 'ライス', 'おにぎり', 'お握り', '丼', '寿司', '鮨',
    'チャーハン', '炒飯', 'カレーライス', 'オムライス', 'ピラフ', 'リゾット', '雑炊', 'おかゆ', 'お粥', '炊き込み', '混ぜご飯',
    'ビビンバ', 'ドリア', '餅', 'もち', '赤飯', 'いなり', '海鮮丼', '牛丼', '親子丼', 'カツ丼', '天丼', '米'],
  chicken: ['鶏', 'とり肉', 'とりむね', 'とりもも', 'チキン', 'ささみ', 'サラダチキン', '唐揚げ', 'から揚げ', 'からあげ', '焼き鳥',
    '焼鳥', 'つくね', '手羽', 'ナゲット', 'タンドリー', 'ローストチキン', 'チキンカツ', 'チキンステーキ'],
  salmon: ['鮭', 'サーモン', 'さけ', 'しゃけ', 'スモークサーモン', 'サケ', '銀鮭', '紅鮭', 'いくら', 'イクラ'],
  fish: ['魚', 'さば', 'サバ', '鯖', 'あじ', 'アジ', '鯵', 'いわし', 'イワシ', '鰯', 'さんま', 'サンマ', '秋刀魚', 'まぐろ', 'マグロ',
    '鮪', 'ツナ', 'かつお', 'カツオ', '鰹', 'ブリ', '鰤', 'たら', 'タラ', '鱈', 'ほっけ', 'ホッケ', '鯛',
    'ひらめ', 'カレイ', 'かれい', 'うなぎ', 'ウナギ', '鰻', 'しらす', 'ちりめん', 'めざし', '干物', '刺身', '刺し身', '寿司',
    '海鮮', 'えび', 'エビ', '海老', 'イカ', 'タコ', 'ほたて', 'ホタテ', 'あさり', 'しじみ', 'カキ', '牡蠣',
    'カニ', '蟹', 'シーフード', 'フィッシュ', 'かまぼこ', 'ちくわ', 'はんぺん', 'さつま揚げ'],
  dairy: ['牛乳', 'ミルク', 'ヨーグルト', 'チーズ', 'バター', '生クリーム', 'ホイップ', 'ラテ', 'カフェオレ', 'カフェラテ',
    'アイスクリーム', 'アイス', 'ソフトクリーム', 'プリン', 'シュークリーム', 'チーズケーキ', 'グラタン', 'クリームシチュー',
    'カルボナーラ', 'フラペチーノ', 'ミルクティー', 'ロイヤルミルク', 'ココア', 'スキムミルク', 'カッテージ', 'モッツァレラ',
    'カマンベール', 'パルメザン', 'ピザ', 'ドリア'],
  sugar_drink: ['コーラ', 'ジュース', 'サイダー', 'ソーダ', 'エナジードリンク', 'レッドブル', 'モンスターエナジー', 'スポーツドリンク',
    'ポカリ', 'アクエリ', 'カルピス', 'ミルクティー', '甘酒', 'タピオカ', 'フラペチーノ', 'ファンタ', 'ラムネ', 'ジンジャーエール',
    'オロナミン', 'デカビタ', 'リポビタン', '乳酸菌飲料', 'ヤクルト', 'いちごミルク', 'バナナジュース', 'スムージー', '加糖',
    '微糖', '練乳', 'クリームソーダ', 'メロンソーダ'],
};

/**
 * タグごとの除外語（含まれていたらそのタグを付けない）。
 *  chicken: 「鶏卵」「鶏ガラ」はたんぱく源としての鶏肉ではない
 *  sugar_drink: 無糖・ゼロ・ダイエット系は「甘い飲み物」に数えない。野菜ジュースも除く（糖はあるが目的が違う）
 *  fish: 「魚肉ソーセージ」は魚に数えない（加工度が高く油脂が主）
 *  rice: 「米粉」「米油」「米酢」は主食の米ではない。「玄米茶」も同様
 *  wheat: 「パンナコッタ」「パンプキン」の「パン」、「パイナップル」の「パイ」誤爆を潰す
 *  ※ひらがな2文字の魚名（たい・かき・いか・たこ・ぶり・かに）は「すいか」「どんぶり」「たこ焼き」に誤爆するため
 *    辞書に入れない（漢字・カタカナ表記だけ拾う。取りこぼしは許容）
 */
export const FOOD_TAG_EXCLUDE: Record<FoodTag, string[]> = {
  wheat: ['パンナコッタ', 'パンプキン', 'パンチ', 'パンダ', 'パイナップル', 'パイン'],
  rice: ['米粉', '米油', '米酢', '玄米茶', '米麹', '米ぬか', 'もち麦', 'カリフラワーライス'],
  chicken: ['鶏卵', '鶏ガラ', '鶏がら'],
  salmon: [],
  fish: ['魚肉ソーセージ', '魚介だし', '魚醤'],
  dairy: ['豆乳', 'アーモンドミルク', 'オーツミルク', 'ココナッツミルク', 'ミルクフランス', 'アイスコーヒー', 'アイスティー', 'ソイラテ'],
  sugar_drink: ['無糖', 'ゼロ', 'ダイエット', 'カロリーオフ', 'カロリーゼロ', '野菜ジュース', 'トマトジュース', '青汁', 'ブラック'],
};

/**
 * 「1品＝この量」の目安（g。飲み物はml）。qty から量が読めないときの既定値。
 * 出典は日本食品標準成分表の常用量と外食の1人前の実測感（うどん1玉≒250g、ご飯1杯≒150g、
 * 鶏むね1枚≒250g→1品は半分程度、鮭1切れ≒80g、牛乳1杯≒200ml、缶飲料≒350ml）
 */
export const FOOD_TAG_STD_G: Record<FoodTag, number> = {
  wheat: 150,
  rice: 150,
  chicken: 100,
  salmon: 80,
  fish: 80,
  dairy: 200,
  sugar_drink: 350,
};

/** 個数単位1つあたりの目安（g）。品目の標準量と別に持つ（「卵2個」と「パン2枚」で1個の重さが違う） */
const UNIT_G: Record<string, number> = {
  '個': 100, 'コ': 100, '本': 100, '杯': 150, '切れ': 80, '枚': 60, '皿': 200, '人前': 250, '缶': 350, '玉': 250,
  'パック': 100, '袋': 100, 'カップ': 200, '膳': 150, '尾': 80, '匹': 80, '貫': 40, '合': 300,
};

// 全角英数字→半角・小文字（foodName.foodKey と同じ吸収。ひらがな/カタカナは寄せない＝辞書側で両方持つ）
function normalize(s: string): string {
  return String(s ?? '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/** 品目名に付くタグ（複数可。例: 「鮭おにぎり」→ salmon, fish, rice）。salmon は必ず fish も含む */
export function tagsOf(name: string): FoodTag[] {
  const n = normalize(name);
  if (!n) return [];
  const out: FoodTag[] = [];
  for (const tag of FOOD_TAGS) {
    if (FOOD_TAG_EXCLUDE[tag].some((w) => n.includes(normalize(w)))) continue;
    if (FOOD_TAG_WORDS[tag].some((w) => n.includes(normalize(w)))) out.push(tag);
  }
  if (out.includes('salmon') && !out.includes('fish')) out.push('fish');
  return out;
}

/**
 * qty から量（g/ml）を推定する。
 *  '150g' → 150 / '0.5kg' → 500 / '200ml' → 200 / '2個' → 2×UNIT_G[個] / '1杯' → 1×杯
 *  '大盛り' や '' → null（読めない＝呼び出し側が標準量を使う）
 * 上限 2000（打ち間違いの 15000g が月合計を壊さないように）
 */
export function gramsFromQty(qty: string | null | undefined, tag?: FoodTag): number | null {
  const q = normalize(qty ?? '').replace(/\s+/g, '');
  if (!q) return null;
  let m = q.match(/(\d+(?:\.\d+)?)(kg|g|ｇ|ml|ｍｌ|cc|l)(?![a-z])/);
  if (m) {
    const v = parseFloat(m[1]);
    const unit = m[2];
    const g = unit === 'kg' || unit === 'l' ? v * 1000 : v;
    return clampG(g);
  }
  // 個数単位: 分数（1/2）にも対応
  m = q.match(/(\d+(?:\.\d+)?|\d+\/\d+)(個|コ|本|杯|切れ|枚|皿|人前|缶|玉|パック|袋|カップ|膳|尾|匹|貫|合)/);
  if (m) {
    const count = m[1].includes('/') ? Number(m[1].split('/')[0]) / Number(m[1].split('/')[1]) : parseFloat(m[1]);
    const per = UNIT_G[m[2]] ?? (tag ? FOOD_TAG_STD_G[tag] : 100);
    return clampG(count * per);
  }
  // 数字だけ（'2'）は個数扱い
  m = q.match(/^(\d+(?:\.\d+)?)$/);
  if (m && tag) return clampG(parseFloat(m[1]) * FOOD_TAG_STD_G[tag]);
  return null;
}

function clampG(g: number): number | null {
  if (!Number.isFinite(g) || g <= 0) return null;
  return Math.min(2000, Math.round(g));
}

/**
 * 1品目 → タグごとの推定g。品名にタグが無ければ空オブジェクト。
 * 複合品（鮭おにぎり）は各タグに同じ量を与える（「どちらも食べた」が分かれば足りる。
 * 比率配分は当てにならないので行わない）
 */
export function itemTagGrams(name: string, qty?: string | null): Partial<Record<FoodTag, number>> {
  const tags = tagsOf(name);
  if (tags.length === 0) return {};
  const out: Partial<Record<FoodTag, number>> = {};
  for (const tag of tags) {
    out[tag] = gramsFromQty(qty, tag) ?? FOOD_TAG_STD_G[tag];
  }
  return out;
}

/** 複数品目の合算（1日ぶん）。全タグのキーを 0 で埋めて返す（特徴量の列として扱いやすくする） */
export function sumTagGrams(items: { name?: string | null; qty?: string | null }[]): Record<FoodTag, number> {
  const out = Object.fromEntries(FOOD_TAGS.map((t) => [t, 0])) as Record<FoodTag, number>;
  for (const it of items ?? []) {
    const g = itemTagGrams(String(it?.name ?? ''), it?.qty ?? null);
    for (const [k, v] of Object.entries(g)) out[k as FoodTag] += v ?? 0;
  }
  return out;
}
