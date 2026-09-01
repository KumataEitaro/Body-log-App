// 招待リンク（/invite）の ?from= の安全化。
//
// この値は「◯◯さんからの招待です」と出すためだけに使う外部入力で、
// リンクを配る人が誰でも自由に書ける＝一切信用しない。守り方は3つ。
//   ①HTMLとして意味を持つ文字・制御文字・不可視文字を「捨てる」
//   ②改行と連続空白を1個の空白に畳む（縦に伸ばして画面を乗っ取る改ざんを防ぐ）
//   ③20文字で切る（長文を差し込んで別の文章に見せかける改ざんを防ぐ）
//
// エスケープを実体参照への変換ではなく「除去」で行っているのは、
// Reactが本文を描くときに自動でエスケープするため、ここで実体参照へ変換すると
// 画面に二重エスケープされた文字列がそのまま出てしまうから。
// 除去方式なら、Reactの自動エスケープと二重にならず、かつ危険な文字は残らない。
//
// 判定を正規表現の文字クラスではなくコードポイントの数値比較で書いているのは、
// 不可視文字を正規表現に埋めるとソース自体に生の制御文字が混ざって
// 誰も読めない・grepできないファイルになるため。
export const INVITE_FROM_MAX = 20;

/**
 * 幅を持たない文字か（ゼロ幅スペース・双方向マーク・双方向オーバーライド・BOM）。
 * これらは空白への畳み込みより先に落とす。U+FEFF は正規表現の \s に含まれるため、
 * 順番を逆にすると「消えるべき文字」が空白1個に化けて残ってしまう。
 */
function isZeroWidth(cp: number): boolean {
  if (cp >= 0x200b && cp <= 0x200f) return true; // ゼロ幅スペース・双方向マーク
  if (cp >= 0x202a && cp <= 0x202e) return true; // 双方向オーバーライド（表示の偽装）
  if (cp >= 0x2066 && cp <= 0x2069) return true; // 双方向分離指示（同上）
  return cp === 0xfeff; // BOM
}

/** 落とす文字か（制御文字・HTML/URLの起点になる記号） */
function isDropped(cp: number): boolean {
  if (cp <= 0x1f || cp === 0x7f) return true; // 制御文字
  // HTML・URL・スクリプトの起点になりうる記号。ニックネームには不要
  // 0x22 " / 0x26 & / 0x27 ' / 0x2f / / 0x3c < / 0x3e > / 0x5c \ / 0x60 `
  return cp === 0x22 || cp === 0x26 || cp === 0x27 || cp === 0x2f
    || cp === 0x3c || cp === 0x3e || cp === 0x5c || cp === 0x60;
}

/** ?from= を表示可能な短い文字列に丸める。危険・不正な入力は空文字（＝招待者名を出さない） */
export function sanitizeInviteFrom(raw: unknown): string {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') return '';
  const stripped = Array.from(first)
    .filter((c) => !isZeroWidth(c.codePointAt(0) ?? 0))
    .join('');
  // 空白（改行・タブ・全角スペース・行区切り U+2028/2029 を含む）を半角1個へ畳む
  const folded = stripped.replace(/\s+/g, ' ');
  // 切り出しは「コードポイント単位」で行う。String#sliceだと絵文字（サロゲートペア）の
  // 途中で切れて壊れた文字（U+FFFD）が出るため、Array.fromで分けてから20個で切る
  const chars = Array.from(folded).filter((c) => !isDropped(c.codePointAt(0) ?? 0));
  return chars.slice(0, INVITE_FROM_MAX).join('').trim();
}
