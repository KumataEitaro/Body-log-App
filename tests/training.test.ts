import { describe, it, expect } from 'vitest';
import { parseTrainingText, trainingSeries, volumeVerdict } from '../lib/training';

describe('parseTrainingText（🏋️形式のパース）', () => {
  it('種目×kg×回×setを読み取る', () => {
    const r = parseTrainingText('🏋️ ベンチプレス 80kg×8×3、スクワット 100.5kg×5');
    expect(r).toEqual([
      { name: 'ベンチプレス', kg: 80, reps: 8, sets: 3 },
      { name: 'スクワット', kg: 100.5, reps: 5, sets: 1 },
    ]);
  });
  it('🏋️で始まらないテキストは空', () => {
    expect(parseTrainingText('昼は牛丼')).toEqual([]);
  });
});

describe('trainingSeries / volumeVerdict', () => {
  it('種目ごとの時系列（同日はmax重量・ボリューム合算）', () => {
    const s = trainingSeries([
      { date: '2026-08-01', text: '🏋️ ベンチプレス 80kg×8×3' },
      { date: '2026-08-01', text: '🏋️ ベンチプレス 85kg×3' },
      { date: '2026-08-03', text: '🏋️ ベンチプレス 82.5kg×8×3' },
    ]);
    const p = s.get('ベンチプレス')!;
    expect(p).toHaveLength(2);
    expect(p[0].maxKg).toBe(85);
    expect(p[0].volume).toBe(80 * 8 * 3 + 85 * 3);
  });
  it('ボリューム低下を検知（直近 vs 直前3回平均で-5%超）', () => {
    const v = volumeVerdict([
      { date: 'a', maxKg: 80, volume: 2000 },
      { date: 'b', maxKg: 80, volume: 2000 },
      { date: 'c', maxKg: 80, volume: 1600 },
    ]);
    expect(v!.trend).toBe('down');
    expect(v!.pct).toBe(-20);
  });
  it('±5%以内は維持、+5%超は上昇', () => {
    expect(volumeVerdict([{ date: 'a', maxKg: 1, volume: 1000 }, { date: 'b', maxKg: 1, volume: 1030 }])!.trend).toBe('flat');
    expect(volumeVerdict([{ date: 'a', maxKg: 1, volume: 1000 }, { date: 'b', maxKg: 1, volume: 1200 }])!.trend).toBe('up');
  });
  it('1回しか記録がなければ判定しない', () => {
    expect(volumeVerdict([{ date: 'a', maxKg: 1, volume: 1000 }])).toBeNull();
  });
});
