// 法則図鑑（B-6）: detectLaws（純関数）が仕込んだパターンを法則として検出できるか。
// 閾値は「ノイズを出さない側」に倒してあるため、弱いパターンで沈黙することも検証する
import { detectLaws, lawText, type LawInput } from '@/lib/laws';
import type { AnalysisDay } from '@/lib/bingeAnalysis';

function shift(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const EMPTY: LawInput = { today: '2026-08-28', days: [], itemDays: [], weights: [], itemHours: [], recordedDates: [] };

// 食材×翌日体重: base日から20日ぶん、ラーメンを5日食べ、その翌日だけ体重が動くデータ
function foodInput(effectUp: number, effectElse: number): LawInput {
  const base = '2026-05-01';
  const itemDays: LawInput['itemDays'] = [];
  const weights: LawInput['weights'] = [];
  let w = 80;
  for (let i = 0; i < 21; i++) {
    const date = shift(base, i);
    weights.push({ date, weight: Math.round(w * 1000) / 1000 });
    if (i < 20) {
      const ramen = i % 4 === 0;   // 0,4,8,12,16 の5日
      itemDays.push({ date, names: ramen ? ['サラダ', 'ラーメン'] : ['サラダ'] });
      w += ramen ? effectUp : effectElse;
    }
  }
  return { ...EMPTY, itemDays, weights };
}

describe('detectLaws', () => {
  it('データが空なら何も主張しない（空配列）', () => {
    expect(detectLaws(EMPTY)).toEqual([]);
  });

  it('食べた翌日に体重が増える食材を food_up として検出する（idは生値で安定）', () => {
    const laws = detectLaws(foodInput(0.6, -0.1));
    const hit = laws.find((l) => l.kind === 'food_up');
    expect(hit).toBeTruthy();
    expect(hit!.id).toBe('food_up:ラーメン');
    expect(hit!.p.kg).toBeCloseTo(0.7, 5);          // 0.6 − (−0.1)
    expect(hit!.title).toContain('ラーメン');       // 一人称の発見文に食材名が入る
  });

  it('効果が±0.3kg未満の食材はノイズとして黙る', () => {
    const laws = detectLaws(foodInput(0.1, -0.05));  // effect=0.15
    expect(laws.filter((l) => l.kind === 'food_up' || l.kind === 'food_safe')).toEqual([]);
  });

  it('毎週金曜だけ大きく超過するデータから weekday 法則を出す', () => {
    const today = '2026-08-28';
    const days: AnalysisDay[] = [];
    for (let i = 55; i >= 0; i--) {
      const date = shift(today, -i);
      const dow = new Date(date + 'T00:00:00').getDay();
      const diff = dow === 5 ? 600 : -100;
      days.push({ date, intake: 2000 + diff, p: 100, diff });
    }
    const laws = detectLaws({ ...EMPTY, today, days });
    const hit = laws.find((l) => l.kind === 'weekday');
    expect(hit).toBeTruthy();
    expect(hit!.id).toBe('weekday:5');
    expect(hit!.p.kcal).toBe(600);
    expect(hit!.title).toContain('金');
  });

  it('「前日に我慢→翌日に過食」の30日から binge_trigger 法則を出す', () => {
    const days: AnalysisDay[] = [];
    for (let i = 0; i < 30; i++) {
      const date = `2026-06-${String(i + 1).padStart(2, '0')}`;
      const diff = i % 5 === 3 ? -500 : i % 5 === 4 ? 700 : -50;
      days.push({ date, intake: 1800 + diff, p: 100, diff });
    }
    const laws = detectLaws({ ...EMPTY, today: '2026-07-01', days });
    const hit = laws.find((l) => l.kind === 'binge_trigger');
    expect(hit).toBeTruthy();
    expect(Number(hit!.p.lift)).toBeGreaterThan(1.4);
    expect(String(hit!.p.label).length).toBeGreaterThan(0);
  });

  it('夜(21時以降)にカロリーが偏っていれば timeslot 法則を出し、偏りが弱ければ黙る', () => {
    const mk = (nightKcal: number): LawInput['itemHours'] => {
      const out: LawInput['itemHours'] = [];
      for (let i = 0; i < 15; i++) {
        const date = shift('2026-08-01', i);
        out.push({ date, hour: 22, kcal: nightKcal });
        out.push({ date, hour: 12, kcal: 400 });
      }
      return out;
    };
    const heavy = detectLaws({ ...EMPTY, itemHours: mk(600) });   // 夜60%
    const hit = heavy.find((l) => l.kind === 'timeslot');
    expect(hit).toBeTruthy();
    expect(hit!.p.pct).toBe(60);
    const light = detectLaws({ ...EMPTY, itemHours: mk(100) });   // 夜20%
    expect(light.find((l) => l.kind === 'timeslot')).toBeUndefined();
  });

  it('過食後すぐ体重が戻る人には recover（お守り）法則を出す', () => {
    const days: AnalysisDay[] = [];
    for (let i = 0; i < 28; i++) {
      const date = shift('2026-06-01', i);
      const diff = i % 7 === 3 ? 500 : -50;   // 週1回の食べすぎ（計4回）
      days.push({ date, intake: 1800 + diff, p: 100, diff, weight: 80 });
    }
    const laws = detectLaws({ ...EMPTY, today: '2026-06-29', days });
    const hit = laws.find((l) => l.kind === 'recover');
    expect(hit).toBeTruthy();
    expect(Number(hit!.p.days)).toBeLessThanOrEqual(4);
  });

  it('長い空白のあと30日つないだ履歴から comeback 法則を出す', () => {
    const recorded: string[] = [];
    for (let i = 0; i < 10; i++) recorded.push(shift('2026-01-01', i));      // 10日つなぐ
    for (let i = 0; i < 35; i++) recorded.push(shift('2026-01-14', i));      // 4日空けて35日つなぐ
    const laws = detectLaws({ ...EMPTY, today: '2026-02-20', recordedDates: recorded });
    expect(laws.find((l) => l.kind === 'comeback')).toBeTruthy();
  });
});

describe('lawText', () => {
  it('保存済みの生値から表示文を組み立て直せる（言語切替に耐える設計の要）', () => {
    const { title, sub } = lawText('food_up', { food: 'ラーメン', kg: 0.6, n: 5 });
    expect(title).toContain('ラーメン');
    expect(title).toContain('+0.6');
    expect(sub).toContain('5');
  });
});
