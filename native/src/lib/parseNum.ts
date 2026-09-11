// 数値入力の共通パーサ（QA B-1）。
//
// なぜ独立ファイルか: 体重・身長・年齢・PFC・kcal の入力口が10か所以上あり、
// どこも `Number(text)` を直に呼んでいた。Number() は次を全部 NaN にする:
//   ・カンマ小数ロケールの「72,5」（ドイツ語・フランス語・スペイン語圏の標準的な打ち方）
//   ・全角の「７２．５」（日本語キーボードでよく混ざる）
//   ・単位つきの「72.5 kg」「170cm」
// そして NaN は `Number(x) || 170` の形で既定値へ黙って倒され、
// 「170cm/30歳の別人」として基礎代謝が計算されてしまっていた。
//
// ここを唯一の入り口にして、読めない入力は null を返す（＝呼び出し側は
// 既定値へ倒さず、エラーとして本人に見せる）。
//
// 判断は全部この純関数にあるので jest で固定できる（lib/__tests__/parseNum.test.ts）。

/** 全角英数・全角記号を半角へ（U+FF01〜U+FF5E は半角と0xFEE0ずれ） */
function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')   // 全角スペース
    .replace(/[−－ー‐-―]/g, '-'); // 各種マイナス・長音記号の誤入力
}

/**
 * 表示用の文字列を数値にする。読めなければ null。
 *
 *   '72.5' → 72.5 / '72,5' → 72.5 / '７２．５' → 72.5 / ' 72.5 kg' → 72.5
 *   '' → null / 'abc' → null / '12kg34' → null（数字のかたまりが2つある入力は信用しない）
 *
 * 桁区切りの扱い: 「,」と「.」が混在するときは最後に現れた方を小数点と見なし、
 * もう一方は桁区切りとして落とす（1.234,5 → 1234.5 / 1,234.5 → 1234.5）。
 * 「,」だけが2つ以上あるときは桁区切り（1,234,567 → 1234567）。
 * 「,」が1つだけのときは小数点として読む（B-1 の主対象がカンマ小数ロケールのため）。
 */
export function parseDecimal(s: string | null | undefined): number | null {
  if (s == null) return null;
  const norm = toHalfWidth(String(s)).trim();
  if (norm === '') return null;
  // 数字のかたまりを1つだけ取り出す。前後の単位（kg / cm / % / 歳 / 「約」）は捨てるが、
  // 数字を挟んで数字が現れる入力（'12kg34'）は読み取りを諦める
  const m = norm.match(/^[^0-9+-]*([+-]?[0-9][0-9., ]*)[^0-9]*$/);
  if (!m) return null;
  let body = m[1].replace(/\s/g, '');
  const lastDot = body.lastIndexOf('.');
  const lastComma = body.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // 混在: 後ろにある方が小数点
    const dec = Math.max(lastDot, lastComma);
    body = body.slice(0, dec).replace(/[.,]/g, '') + '.' + body.slice(dec + 1).replace(/[.,]/g, '');
  } else if (lastComma >= 0) {
    body = body.split(',').length > 2 ? body.replace(/,/g, '') : body.replace(',', '.');
  } else if (body.split('.').length > 2) {
    // '1.234.567' は桁区切りとして読む（'1.2.3' のような壊れた入力もここで整数化される）
    body = body.replace(/\./g, '');
  }
  if (body === '' || body === '+' || body === '-') return null;
  const n = Number(body);
  return Number.isFinite(n) ? n : null;
}

/**
 * 整数として読む（身長・年齢・kcal など小数を持たない入力）。
 * 小数を打たれたら四捨五入する（'170.4cm' を弾いて行き止まりにしない）。
 */
export function parseInteger(s: string | null | undefined): number | null {
  const n = parseDecimal(s);
  return n == null ? null : Math.round(n);
}
