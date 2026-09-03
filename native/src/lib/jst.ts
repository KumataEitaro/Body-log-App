// JST（日本標準時）の日付・時刻フォーマッタ。Intlを一切使わない純関数。
//
// ■ なぜ自前で組むか（Androidの起動クラッシュ対策）
// これまで todayJST() などは `Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' })` を
// 使っていた。iOSでは問題ないが、AndroidのHermesはIntlの有無・機能範囲がエンジンの
// ビルドフラグ（hermesEnableIntl）とICUの載り方に左右され、環境によっては
//   ・`Intl` 自体が undefined → `new Intl.DateTimeFormat(...)` が TypeError
//   ・timeZone / hourCycle が未対応 → RangeError
// になり得る。todayJST() は起動直後の通知再登録や記録画面の描画から呼ばれるため、
// ここが throw すると「Androidだけ起動直後に落ちる」形になり、しかもスタックトレースが
// 手に入らない状況では原因が極めて追いにくい（今回まさにそれを疑った）。
//
// ■ 自前で厳密に一致させられる理由
// 日本標準時は 1951年（最後の夏時刻）以降サマータイムが無く、常に UTC+9 固定。
// つまり「epochミリ秒に9時間足して、UTCの暦として読む」だけでJSTの年月日時分に一致する。
// タイムゾーンDBもICUも要らない。だから Intl に頼る理由が最初から無かった。
//
// ■ 純関数にしてある理由
// 引数に epoch ミリ秒を取り、現在時刻を内部で読まない。境界（UTC 15:00 = JST 翌日0:00）や
// 月末・うるう年をjestで固定でき、「日付が1日ズレる」類の事故を作らずに移行できる。
/** JSTのUTCからのオフセット（+9時間・固定） */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JSTに直した暦の各要素（月は1-12・時は0-23） */
export type JstParts = { y: number; m: number; d: number; h: number; mi: number; s: number };

const p2 = (n: number) => String(n).padStart(2, '0');
const p4 = (n: number) => String(n).padStart(4, '0');

/**
 * epochミリ秒 → JSTの暦要素。壊れた入力（NaN・Infinity・非数）は null を返す。
 * null を返すのは「間違った日付を静かに返す」より安全だから（呼び出し側で分岐できる）。
 */
export function jstParts(ms: number): JstParts | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const d = new Date(ms + JST_OFFSET_MS);
  const y = d.getUTCFullYear();
  if (!Number.isFinite(y)) return null;   // Dateの表現範囲外（±8.64e15超）
  return {
    y,
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
  };
}

/**
 * JSTの日付 'YYYY-MM-DD'。壊れた入力は空文字。
 * 旧実装（Intl 'sv-SE' + Asia/Tokyo）と同じ出力になる。
 */
export function jstYmd(ms: number): string {
  const p = jstParts(ms);
  if (!p) return '';
  return `${p4(p.y)}-${p2(p.m)}-${p2(p.d)}`;
}

/**
 * JSTの時刻 'HH:MM'（24時間・ゼロ埋め）。壊れた入力は空文字。
 * 旧実装（Intl 'ja-JP' + hour/minute:'2-digit'）と同じ出力になる。
 */
export function jstHm(ms: number): string {
  const p = jstParts(ms);
  if (!p) return '';
  return `${p2(p.h)}:${p2(p.mi)}`;
}

/** JSTの時（0-23）。壊れた入力は NaN（呼び出し側で端末ローカル時などに退避する） */
export function jstHour(ms: number): number {
  const p = jstParts(ms);
  return p ? p.h : NaN;
}

/**
 * ISO8601文字列 → JSTの 'HH:MM'。パースできない文字列は空文字。
 * Date.parse はISO文字列については実装差が小さく、Hermesでも安定して動く
 * （危ないのは Intl 側だった）。
 */
export function jstHmFromIso(iso: string | null | undefined): string {
  if (!iso) return '';
  return jstHm(Date.parse(iso));
}
