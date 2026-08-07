import { describe, it, expect } from 'vitest';
import {
  isBingeDay, deficitStreak, preBingeStreaks, assessBingeRisk,
  buildItemDays, foodWeightEffects, normalizeItemName, type InsightDay,
} from '../lib/insights';

const day = (date: string, diff: number | null, extra: Partial<InsightDay> = {}): InsightDay => ({
  date, diff,
  intake: diff == null ? null : 1800 + diff,
  p: extra.p ?? 100,
  ...extra,
});

describe('isBingeDay（食べ過ぎ日のラベリング）', () => {
  it('+400kcal以上の超過は食べ過ぎ日', () => {
    expect(isBingeDay(day('2026-08-01', 450))).toBe(true);
    expect(isBingeDay(day('2026-08-01', 200))).toBe(false);
  });
  it('テキストの爆食サインでも検知', () => {
    expect(isBingeDay(day('2026-08-01', -100, { text: '爆食してしまった' }))).toBe(true);
  });
  it('未記録日は判定しない', () => {
    expect(isBingeDay(day('2026-08-01', null))).toBe(false);
  });
});

describe('deficitStreak / preBingeStreaks', () => {
  it('直近から続く大きめ赤字の連続日数', () => {
    expect(deficitStreak([day('d1', -400), day('d2', -350), day('d3', -500)])).toBe(3);
    expect(deficitStreak([day('d1', -400), day('d2', 100), day('d3', -500)])).toBe(1);
  });
  it('未記録日で打ち切る', () => {
    expect(deficitStreak([day('d1', -400), day('d2', null), day('d3', -500)])).toBe(1);
  });
  it('食べ過ぎ日の直前連続赤字を集める', () => {
    const days = [day('d1', -400), day('d2', -350), day('d3', 600), day('d4', -100)];
    expect(preBingeStreaks(days)).toEqual([2]);
  });
});

describe('assessBingeRisk（過食リスク判定）', () => {
  it('連続赤字3日でリスク上昇', () => {
    const r = assessBingeRisk([day('2026-08-01', -400), day('2026-08-02', -350), day('2026-08-03', -500)], 2);
    expect(r.level).not.toBe('low');
    expect(r.reasons.some((x) => x.key === 'streak')).toBe(true);
  });
  it('順調（小さな赤字）ならlow', () => {
    const r = assessBingeRisk([day('2026-08-01', -200), day('2026-08-02', -150), day('2026-08-03', -100)], 2);
    expect(r.level).toBe('low');
  });
  it('個人統計: 過去の食べ過ぎが同じ曜日に集中していると理由に出る', () => {
    // 2026-08-01, 08, 15 はすべて土曜
    const days = [
      day('2026-08-01', 500), day('2026-08-02', -100), day('2026-08-08', 600),
      day('2026-08-09', -100), day('2026-08-15', 450), day('2026-08-16', -100),
    ];
    const r = assessBingeRisk(days, 6); // 今日=土曜
    expect(r.reasons.some((x) => x.key === 'dow')).toBe(true);
  });
  it('昨日のつらいサインで上昇', () => {
    const r = assessBingeRisk([day('2026-08-01', -100), day('2026-08-02', -100, { mood: 'しんどい' })], 1);
    expect(r.reasons.some((x) => x.key === 'stress')).toBe(true);
    expect(r.level).toBe('elevated');
  });
  it('データ無しはlow', () => {
    expect(assessBingeRisk([], 0).level).toBe('low');
  });
});

describe('buildItemDays / foodWeightEffects（食材×翌日体重）', () => {
  it('品目名を日単位で正規化・重複除去', () => {
    const days = buildItemDays([
      { date: '2026-08-01', items: [{ name: 'プロテイン ' }, { name: 'プロテイン' }, { name: 'ゆで卵' }] },
      { date: '2026-08-02', items: [{ name: '鶏むね肉' }] },
    ]);
    expect(days[0].names.sort()).toEqual(['ゆで卵', 'プロテイン']);
    expect(days.length).toBe(2);
  });
  it('normalizeItemName: 全角空白・NFKC', () => {
    expect(normalizeItemName('鶏むね　肉')).toBe('鶏むね肉');
    expect(normalizeItemName('ﾌﾟﾛﾃｲﾝ')).toBe('プロテイン');
  });
  it('食べた翌日に下がりやすい食材が負のeffectで出る', () => {
    // 20日間: 偶数日に「鶏むね」を食べ翌日-0.3kg、奇数日は食べず翌日+0.1kg
    const itemDays = [];
    const weights = [];
    let w = 80;
    for (let i = 1; i <= 21; i++) {
      const d = `2026-07-${String(i).padStart(2, '0')}`;
      weights.push({ date: d, weight: Math.round(w * 100) / 100 });
      const eat = i % 2 === 0;
      itemDays.push({ date: d, names: eat ? ['鶏むね'] : ['牛丼'] });
      w += eat ? -0.3 : 0.1;
    }
    const fx = foodWeightEffects(itemDays, weights);
    const tori = fx.find((f) => f.name === '鶏むね')!;
    const gyu = fx.find((f) => f.name === '牛丼')!;
    expect(tori.effect).toBeLessThan(0);
    expect(gyu.effect).toBeGreaterThan(0);
    expect(fx[0].name).toBe('鶏むね'); // 下がりやすい順
  });
  it('データ不足（体重ペア10日未満）なら空', () => {
    const fx = foodWeightEffects(
      [{ date: '2026-08-01', names: ['a'] }],
      [{ date: '2026-08-01', weight: 80 }, { date: '2026-08-02', weight: 79.9 }],
    );
    expect(fx).toEqual([]);
  });
});
