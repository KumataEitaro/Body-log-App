// 詳細ページのトレンド文章（Appleヘルスケアの「14週間で下向き」に相当）。
// 日別の値を週ごとに平均して平滑化し、直近から「同じ方向に動き続けている週数」を数えて
// 一文にする。日々の上下ではなく「流れ」を言葉で返すのが目的。
import { t } from './i18n';

// 週の起点（月曜）を返す。changes.tsxのweekStartOf2と同じ定義
function weekStartOf(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// 日別の値を週平均の列にする（週の起点キー順・古い→新しい）。trendPhrase/trendBands共用
function weeklyAvgs(vals: { date: string; value: number }[]): number[] {
  const buckets = new Map<string, { sum: number; n: number }>();
  for (const v of vals) {
    if (v == null || !isFinite(v.value)) continue;
    const wk = weekStartOf(v.date);
    const b = buckets.get(wk) ?? { sum: 0, n: 0 };
    b.sum += v.value; b.n += 1;
    buckets.set(wk, b);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, b]) => b.sum / b.n);
}

/**
 * 直近の週の動きの向き。trendPhraseの方向判定と同一ロジック
 * （ハイライトの「トレンド転換」検知で前回保存値との比較に使う）。
 * 週2つ未満・動きがごく小さい（週平均の0.1%以下）なら 'flat'
 */
export function trendDirection(vals: { date: string; value: number }[]): 'up' | 'down' | 'flat' {
  const weekly = weeklyAvgs(vals).slice(-9);
  if (weekly.length < 2) return 'flat';
  const eps = Math.abs(weekly[weekly.length - 1]) * 0.001;
  const last = weekly[weekly.length - 1] - weekly[weekly.length - 2];
  if (Math.abs(last) <= eps) return 'flat';
  return last < 0 ? 'down' : 'up';
}

/**
 * 値の並びからトレンド文章を作る。
 * - 週平均の差分を直近から遡り、同方向が続いた週数n（最大8）を数える
 * - 直近の週の動きがごく小さい（週平均の0.1%以下）か、週が2つ未満なら「横ばいです」
 * 返り値: t('{n}週間で下向き') / t('{n}週間で上向き') / t('横ばいです')
 */
export function trendPhrase(vals: { date: string; value: number }[]): string {
  // 直近9週ぶんの週平均（8週連続の判定に必要な差分は最大8個）
  const weekly = weeklyAvgs(vals).slice(-9);
  if (weekly.length < 2) return t('横ばいです');

  // 「動いた」とみなす最小幅。値のスケールに比例させる（体重87kgなら約0.09kg、歩数7000なら約7歩）
  const eps = Math.abs(weekly[weekly.length - 1]) * 0.001;
  const last = weekly[weekly.length - 1] - weekly[weekly.length - 2];
  if (Math.abs(last) <= eps) return t('横ばいです');

  const dir = Math.sign(last);
  let n = 1;
  for (let i = weekly.length - 2; i >= 1 && n < 8; i--) {
    const d = weekly[i] - weekly[i - 1];
    if (Math.abs(d) <= eps || Math.sign(d) !== dir) break;
    n++;
  }
  return dir < 0 ? t('{n}週間で下向き', { n }) : t('{n}週間で上向き', { n });
}

/**
 * ヘルスケアの体重トレンド表現（B-17）: 「直近4週の平均」と「その前8週の平均」の2本。
 * - weekly平均の直近12週を窓にし、recent=末尾4週の平均、older=その前（最大8週）の平均
 * - データ不足（週平均が5週未満＝直近4週＋比較相手が無い）ならnull
 * 返り値は生の平均値（丸めは表示側で行う）
 */
export function trendBands(vals: { date: string; value: number }[]): { older: number; recent: number } | null {
  const weekly = weeklyAvgs(vals).slice(-12);
  if (weekly.length < 5) return null;
  const recentArr = weekly.slice(-4);
  const olderArr = weekly.slice(0, -4);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { older: avg(olderArr), recent: avg(recentArr) };
}
