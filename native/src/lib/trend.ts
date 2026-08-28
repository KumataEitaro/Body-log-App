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

/**
 * 値の並びからトレンド文章を作る。
 * - 週平均の差分を直近から遡り、同方向が続いた週数n（最大8）を数える
 * - 直近の週の動きがごく小さい（週平均の0.1%以下）か、週が2つ未満なら「横ばいです」
 * 返り値: t('{n}週間で下向き') / t('{n}週間で上向き') / t('横ばいです')
 */
export function trendPhrase(vals: { date: string; value: number }[]): string {
  // 週ごとに平均（日付順に依存しないよう、まずバケツへ入れてからキー順に並べる）
  const buckets = new Map<string, { sum: number; n: number }>();
  for (const v of vals) {
    if (v == null || !isFinite(v.value)) continue;
    const wk = weekStartOf(v.date);
    const b = buckets.get(wk) ?? { sum: 0, n: 0 };
    b.sum += v.value; b.n += 1;
    buckets.set(wk, b);
  }
  // 直近9週ぶんの週平均（8週連続の判定に必要な差分は最大8個）
  const weekly = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, b]) => b.sum / b.n)
    .slice(-9);
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
