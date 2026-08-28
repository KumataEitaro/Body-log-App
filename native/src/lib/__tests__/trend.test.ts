// トレンド文章（ヘルスケアの「14週間で下向き」相当）。
// 詳細ページのヘッダーに毎回出る一文なので、方向・週数・横ばい判定を固定する。
// テストはロケール未設定（=日本語キーがそのまま返る）前提で日本語文字列を比較する。
import { trendPhrase } from '../trend';

// 週の並びから日別データを作るヘルパー。2026-06-01は月曜（週の起点）
// weeklyVals[i] がそのままi週目の週平均になるよう、各週は月・木の2点で同じ値を入れる
function weeks(weeklyVals: number[]): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  const base = new Date('2026-06-01T00:00:00');
  weeklyVals.forEach((v, i) => {
    for (const off of [0, 3]) {
      const d = new Date(base.getTime() + (i * 7 + off) * 86400000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ date: key, value: v });
    }
  });
  return out;
}

describe('trendPhrase（週平均の平滑変化を言語化）', () => {
  it('3週連続で下がっている → 「3週間で下向き」', () => {
    // 87.0 → 86.6 → 86.2 → 85.8（下向きの差分が3つ）
    expect(trendPhrase(weeks([87.0, 86.6, 86.2, 85.8]))).toBe('3週間で下向き');
  });

  it('直近2週だけ上がっている（その前は下がっていた） → 「2週間で上向き」', () => {
    // 下向き→上向きに転じたら、数えるのは直近の連続部分だけ
    expect(trendPhrase(weeks([70.0, 69.5, 69.8, 70.3]))).toBe('2週間で上向き');
  });

  it('直近の週の動きがごく小さい → 「横ばいです」', () => {
    // 87.00→87.01はスケール比0.1%以下（eps=約0.087）で「動いた」とみなさない
    expect(trendPhrase(weeks([86.5, 87.0, 87.01]))).toBe('横ばいです');
  });

  it('10週連続の下向きでも週数は8で頭打ち → 「8週間で下向き」', () => {
    const vals = Array.from({ length: 11 }, (_, i) => 90 - i); // 90,89,...,80（下向き10連続）
    expect(trendPhrase(weeks(vals))).toBe('8週間で下向き');
  });

  it('データが1週ぶんしかない（比べる相手がない） → 「横ばいです」', () => {
    expect(trendPhrase(weeks([87.0]))).toBe('横ばいです');
    expect(trendPhrase([])).toBe('横ばいです');
  });
});
