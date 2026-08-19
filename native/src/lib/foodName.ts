// 食品名の正規化。「オートミール80g」と「オートミール1杯」を同じ食品として扱うために使う。
//
// 方針: 誤検知を避け、取りこぼしは許容する。
// 「鶏むね肉」と「鶏もも肉」は栄養が2倍違うため、部分一致で寄せると危険。
// 正規化したあとの完全一致だけを同一とみなす。
// 表記ゆれ（たまご/卵/玉子）は辞書の保守が破綻するので寄せない。

// 数量＋単位（例: 80g / 150ml / 2個 / 1杯 / 1切れ / 大さじ2）
const QTY = /[0-9０-９]+(?:\.[0-9０-９]+)?\s*(?:g|ｇ|kg|mg|ml|ｍｌ|l|cc|個|コ|本|杯|切れ|枚|片|房|粒|尾|匹|人前|皿|袋|パック|缶|缸|カップ|さじ|膳|玉|株|束|丁|合|斤)?/gi;
// 数量を表す副詞（数字を伴わないもの）
const QTY_WORDS = /(?:ひとつかみ|ひとつまみ|一つかみ|一つまみ|少々|少量|多め|軽く|山盛り|大盛り|小盛り|適量|大さじ|小さじ|カップ)/g;
// 括弧とその中身（全角・半角）
const PARENS = /[（(][^）)]*[）)]/g;

/** 括弧・分量・余分な空白を落とした表示用の名前 */
export function foodBaseName(name: string): string {
  let s = String(name ?? '');
  s = s.replace(PARENS, ' ');                 // （約25g）(可食部) などを落とす
  s = s.replace(/[×✕]\s*[0-9０-９.]+/g, ' ');  // ×2 ×1.5（QTYより先に。後だと「×」が残る）
  s = s.replace(QTY, ' ');                    // 80g 2個 1杯 …
  s = s.replace(QTY_WORDS, ' ');              // ひとつかみ 少々 …
  s = s.replace(/[・,、\s]+$/g, '');              // 末尾の区切り
  s = s.replace(/^[・,、\s]+/g, '');              // 先頭の区切り
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** 同一判定に使う照合キー（大小文字と全角半角の差を吸収する） */
export function foodKey(name: string): string {
  const base = foodBaseName(name);
  return base
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * 元の名前から分量の表現だけを取り出す（登録フォームの「単位」の初期値に使う）。
 * 例: 'オートミール 1カップ（約80g）' → '1カップ（約80g）'
 */
export function foodPortion(name: string): string | null {
  const raw = String(name ?? '').trim();
  const base = foodBaseName(raw);
  if (!base) return null;
  // 表示名を取り除いた残り＝分量部分
  const idx = raw.indexOf(base);
  if (idx < 0) return null;
  const rest = (raw.slice(0, idx) + raw.slice(idx + base.length)).trim();
  const cleaned = rest.replace(/^[・,、\s]+|[・,、\s]+$/g, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}
