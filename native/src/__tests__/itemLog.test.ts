// 品目単位の取り出しと集計: 1回の食事を品目ごとに開けること
import { toItemEntries, summarizeItems, slotOf, mainSlot, removeItemAt } from '@/lib/itemLog';
import type { FoodItem } from '@/lib/items';

const it1 = (name: string, qty: string, kcal: number, p = 0, f = 0, c = 0): FoodItem =>
  ({ name, qty, kcal, p, f, c });

// 2026-08-20 11:40 JST = 02:40 UTC
const AT_1140 = '2026-08-20T02:40:00.000Z';
const AT_2200 = '2026-08-20T13:00:00.000Z';   // 22:00 JST（夜）

describe('toItemEntries', () => {
  it('1回の食事の3品が3件に分かれる', () => {
    const e = toItemEntries([{
      id: 'log-1', date: '2026-08-20', at: AT_1140,
      items: [
        it1('じゃがいも', '400g', 308, 6, 0, 71),
        it1('チーズ', '10g', 34, 2, 3, 0),
        it1('鶏むね肉', '300g', 324, 67, 5, 0),
      ],
    }]);
    expect(e).toHaveLength(3);
    expect(e.map((x) => x.name)).toEqual(['じゃがいも', 'チーズ', '鶏むね肉']);
    // 同じ食事に属していたことをたどれる
    expect(new Set(e.map((x) => x.logId)).size).toBe(1);
  });

  it('栄養素と分量が品目ごとに保たれる', () => {
    const e = toItemEntries([{
      id: 'l', date: '2026-08-20', at: AT_1140,
      items: [it1('鶏むね肉', '300g', 324, 67, 5, 0)],
    }]);
    expect(e[0]).toMatchObject({ qty: '300g', kcal: 324, p: 67, f: 5, c: 0 });
  });

  it('時刻をJSTの時で取り出す', () => {
    const e = toItemEntries([{ id: 'l', date: '2026-08-20', at: AT_1140, items: [it1('米', '150g', 234)] }]);
    expect(e[0].hour).toBe(11);   // 02:40 UTC → 11:40 JST
  });

  it('時刻が無い記録でも壊れない', () => {
    const e = toItemEntries([{ id: 'l', date: '2026-08-20', at: null, items: [it1('米', '150g', 234)] }]);
    expect(e[0].hour).toBeNull();
  });

  it('分量だけの行は品目として扱わない', () => {
    const e = toItemEntries([{ id: 'l', date: '2026-08-20', at: AT_1140, items: [it1('400g', '', 0)] }]);
    expect(e).toHaveLength(0);
  });

  it('itemsが空やnullでも落ちない', () => {
    expect(toItemEntries([{ id: 'a', date: '2026-08-20', at: null, items: [] }])).toHaveLength(0);
    expect(toItemEntries([{ id: 'b', date: '2026-08-20', at: null, items: null }])).toHaveLength(0);
  });
});

describe('summarizeItems', () => {
  const rows = [
    { id: 'l1', date: '2026-08-18', at: AT_1140, items: [it1('鶏むね肉', '300g', 324, 67, 5, 0), it1('米', '150g', 234)] },
    { id: 'l2', date: '2026-08-19', at: AT_1140, items: [it1('鶏むね肉 300g', '', 324, 67, 5, 0)] },
    { id: 'l3', date: '2026-08-20', at: AT_2200, items: [it1('鶏むね肉', '200g', 216, 45, 3, 0)] },
  ];

  it('分量表記が違っても同じ品目として集計される', () => {
    const s = summarizeItems(toItemEntries(rows));
    const chicken = s.find((x) => x.name.includes('鶏むね肉'));
    expect(chicken?.times).toBe(3);
    expect(chicken?.days).toBe(3);
  });

  it('1回あたりの平均が出る', () => {
    const s = summarizeItems(toItemEntries(rows));
    const chicken = s.find((x) => x.name.includes('鶏むね肉'))!;
    expect(chicken.totalKcal).toBe(864);          // 324+324+216
    expect(chicken.avgKcal).toBe(288);            // 864/3
    expect(chicken.avgP).toBeCloseTo(59.7, 1);    // (67+67+45)/3
  });

  it('回数が多い順に並ぶ', () => {
    const s = summarizeItems(toItemEntries(rows));
    expect(s[0].name).toContain('鶏むね肉');   // 3回 > 米1回
  });

  it('最後に食べた日を持つ', () => {
    const s = summarizeItems(toItemEntries(rows));
    expect(s.find((x) => x.name.includes('鶏むね肉'))?.lastDate).toBe('2026-08-20');
  });
});

describe('時間帯の分類', () => {
  it('区分の境界が正しい', () => {
    expect(slotOf(5)).toBe('morning');
    expect(slotOf(10)).toBe('morning');
    expect(slotOf(11)).toBe('noon');
    expect(slotOf(15)).toBe('noon');
    expect(slotOf(16)).toBe('evening');
    expect(slotOf(20)).toBe('evening');
    expect(slotOf(21)).toBe('night');
    expect(slotOf(3)).toBe('night');     // 深夜も夜food扱い
  });

  it('主な時間帯とその割合が出る', () => {
    expect(mainSlot([22, 23, 22, 12])).toEqual({ slot: 'night', share: 0.75 });
  });

  it('時刻が無ければnull', () => {
    expect(mainSlot([])).toBeNull();
  });
});

describe('removeItemAt（品目を1つだけ消す）', () => {
  const three: FoodItem[] = [
    it1('じゃがいも', '400g', 308, 6, 0.2, 71),
    it1('チーズ', '10g', 34, 2, 3, 0.1),
    it1('鶏むね肉', '300g', 324, 67, 5, 0),
  ];

  it('残った品目から合計を再計算する', () => {
    const r = removeItemAt(three, 1);   // チーズを消す
    expect(r.kind).toBe('update');
    if (r.kind !== 'update') return;
    expect(r.items.map((x) => x.name)).toEqual(['じゃがいも', '鶏むね肉']);
    expect(r.kcal).toBe(632);          // 308+324
    expect(r.p).toBeCloseTo(73, 1);    // 6+67
    expect(r.f).toBeCloseTo(5.2, 1);   // 0.2+5
    expect(r.c).toBeCloseTo(71, 1);
  });

  it('最後の1品を消すとレコードごと削除になる', () => {
    expect(removeItemAt([three[0]], 0).kind).toBe('delete');
  });

  it('元の配列を書き換えない', () => {
    removeItemAt(three, 0);
    expect(three).toHaveLength(3);
  });

  it('存在しない位置を指定しても壊れない（何も減らない）', () => {
    const r = removeItemAt(three, 99);
    expect(r.kind).toBe('update');
    if (r.kind === 'update') expect(r.items).toHaveLength(3);
  });
});
