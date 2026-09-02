// 筋トレ記録の日ごとまとめ、1種目だけの削除、自重種目の実負荷。
// テキストを組み直すため、往復して形が変わらないことが重要（変わるとRM換算が読めなくなる）。
import {
  parseLiftText, liftTextFrom, liftSetLabel, removeLiftAt, groupLiftsByDay,
  volumeOf, effectiveKg, weightLookup,
} from '../liftLog';

describe('記録テキストの解析', () => {
  it('セット数まで読む', () => {
    expect(parseLiftText('🏋️ ベンチプレス 80kg×8×3')).toEqual([
      { name: 'ベンチプレス', kg: 80, reps: 8, sets: 3, mode: 'abs' },
    ]);
  });

  it('複数種目を分解する', () => {
    expect(parseLiftText('🏋️ ベンチプレス 80kg×8×3、スクワット 100kg×5').map((e) => e.name))
      .toEqual(['ベンチプレス', 'スクワット']);
  });

  it('セット省略は1セットとして扱う', () => {
    expect(parseLiftText('🏋️ デッドリフト 140kg×3')[0].sets).toBe(1);
  });

  it('小数の重量を読む', () => {
    expect(parseLiftText('🏋️ アームカール 12.5kg×10×3')[0].kg).toBe(12.5);
  });

  it('加重（+10kg）を加重として読む', () => {
    expect(parseLiftText('🏋️ 懸垂 +10kg×8×3')[0]).toEqual({
      name: '懸垂', kg: 10, reps: 8, sets: 3, mode: 'plus',
    });
  });

  it('加重なしの自重を読む', () => {
    expect(parseLiftText('🏋️ 懸垂 自重×8×3')[0]).toEqual({
      name: '懸垂', kg: 0, reps: 8, sets: 3, mode: 'bw',
    });
  });

  it('絵文字がなくても読める', () => {
    expect(parseLiftText('ベンチプレス 80kg×8×3')).toHaveLength(1);
  });

  it('読めない断片は無視する（記録全体を落とさない）', () => {
    expect(parseLiftText('🏋️ ベンチプレス 80kg×8×3、メモ')).toHaveLength(1);
  });

  it('補助（-20kg）を補助として読む（kgは負・mode=minus）。全角マイナスも読む', () => {
    expect(parseLiftText('🏋️ 懸垂 -20kg×8×3')[0]).toEqual({
      name: '懸垂', kg: -20, reps: 8, sets: 3, mode: 'minus',
    });
    expect(parseLiftText('🏋️ 懸垂 −20kg×8')[0].kg).toBe(-20);
  });

  it.each([
    '🏋️ ベンチプレス 80kg×8×3、スクワット 100kg×5',
    '🏋️ 懸垂 +10kg×8×3',
    '🏋️ 懸垂 自重×8×3',
    '🏋️ 懸垂 10kg×8×3',
    '🏋️ 懸垂 -20kg×9、懸垂 -20kg×7、懸垂 -20kg×5',
  ])('組み直しても表記が変わらない: %s', (text) => {
    expect(liftTextFrom(parseLiftText(text))).toBe(text);
  });
});

describe('表示', () => {
  it('加重は+付きで見せる（体重に足す量だと分かるように）', () => {
    expect(liftSetLabel(parseLiftText('🏋️ 懸垂 +10kg×8×3')[0])).toBe('+10kg×8×3');
  });

  it('加重なしは「自重」と見せる', () => {
    expect(liftSetLabel(parseLiftText('🏋️ 懸垂 自重×8')[0])).toBe('自重×8');
  });

  it('通常種目はそのままの重量', () => {
    expect(liftSetLabel(parseLiftText('🏋️ ベンチプレス 80kg×8×3')[0])).toBe('80kg×8×3');
  });
});

describe('自重種目の実負荷', () => {
  const bw = (text: string) => parseLiftText(text)[0];

  it('懸垂は体重＋加重（体重全部が負荷）', () => {
    expect(effectiveKg(bw('🏋️ 懸垂 +10kg×8'), 62)).toBe(72);
  });

  it('加重なしの懸垂は体重そのもの', () => {
    expect(effectiveKg(bw('🏋️ 懸垂 自重×8'), 62)).toBe(62);
  });

  it('昔の記録（懸垂 10kg）も加重として体重を足す', () => {
    expect(effectiveKg(bw('🏋️ 懸垂 10kg×8'), 62)).toBe(72);
  });

  it('腕立て伏せは体重の一部だけが負荷', () => {
    expect(effectiveKg(bw('🏋️ 腕立て伏せ 自重×20'), 62)).toBe(39.7);
  });

  it('通常種目に体重は足さない', () => {
    expect(effectiveKg(bw('🏋️ ベンチプレス 80kg×8'), 62)).toBe(80);
  });

  it('補助つき懸垂は体重から補助を引く（62kg・補助20 → 42）。表示は -20kg×8', () => {
    expect(effectiveKg(bw('🏋️ 懸垂 -20kg×8'), 62)).toBe(42);
    expect(liftSetLabel(bw('🏋️ 懸垂 -20kg×8'))).toBe('-20kg×8');
    expect(volumeOf(bw('🏋️ 懸垂 -20kg×8'), 62)).toBe(42 * 8);
  });

  it('体重が分からないときは加重だけを返す（体重0で計算しない）', () => {
    expect(effectiveKg(bw('🏋️ 懸垂 +10kg×8'), null)).toBe(10);
  });

  it('総挙上量も実負荷で数える（自重が0kg扱いにならない）', () => {
    expect(volumeOf(bw('🏋️ 懸垂 自重×8×3'), 62)).toBe(62 * 8 * 3);
  });
});

describe('その日の体重を引く', () => {
  const at = weightLookup([
    { date: '2026-01-10', weight: 70 },
    { date: '2026-03-01', weight: 66 },
    { date: '2026-06-01', weight: null },
  ]);

  it('その日の記録があればその体重', () => {
    expect(at('2026-03-01')).toBe(66);
  });

  it('記録がない日は直前の記録で埋める（毎日測る人ばかりではない）', () => {
    expect(at('2026-04-15')).toBe(66);
  });

  it('いちばん古い記録より前は、その古い記録で代用する', () => {
    expect(at('2025-12-01')).toBe(70);
  });

  it('体重の記録が1件もなければnull', () => {
    expect(weightLookup([])('2026-03-01')).toBeNull();
  });
});

describe('1種目だけ削除', () => {
  const entries = parseLiftText('🏋️ ベンチプレス 80kg×8×3、スクワット 100kg×5×3');

  it('残りで記録を組み直す', () => {
    expect(removeLiftAt(entries, 0)).toEqual({ kind: 'update', text: '🏋️ スクワット 100kg×5×3' });
  });

  it('後ろの種目を消しても前が残る', () => {
    expect(removeLiftAt(entries, 1)).toEqual({ kind: 'update', text: '🏋️ ベンチプレス 80kg×8×3' });
  });

  it('最後の1種目を消したら記録そのものを消す', () => {
    expect(removeLiftAt(parseLiftText('🏋️ ベンチプレス 80kg×8×3'), 0)).toEqual({ kind: 'delete' });
  });

  it('自重だけの種目も消せる（kg0で消えないことの確認）', () => {
    const e = parseLiftText('🏋️ 懸垂 自重×8×3、スクワット 100kg×5');
    expect(removeLiftAt(e, 1)).toEqual({ kind: 'update', text: '🏋️ 懸垂 自重×8×3' });
  });
});

describe('日ごとのまとめ', () => {
  const rows = [
    { id: 'c', date: '2026-08-20', text: '🏋️ ベンチプレス 80kg×8×3' },
    { id: 'b', date: '2026-08-20', text: '🏋️ スクワット 100kg×5×3' },
    { id: 'a', date: '2026-08-18', text: '🏋️ デッドリフト 140kg×3×2' },
  ];

  it('同じ日の記録が1つにまとまる', () => {
    const days = groupLiftsByDay(rows);
    expect(days).toHaveLength(2);
    expect(days[0].records).toHaveLength(2);
  });

  it('新しい日が先に来る', () => {
    expect(groupLiftsByDay(rows).map((d) => d.date)).toEqual(['2026-08-20', '2026-08-18']);
  });

  it('種目数・セット数・総挙上量を出す', () => {
    const d = groupLiftsByDay(rows)[0];
    expect(d.lifts).toBe(2);
    expect(d.sets).toBe(6);
    expect(d.volume).toBe(80 * 8 * 3 + 100 * 5 * 3);
  });

  it('同じ種目を2回記録しても種目数は1', () => {
    const days = groupLiftsByDay([
      { id: 'b', date: '2026-08-20', text: '🏋️ ベンチプレス 80kg×8×3' },
      { id: 'a', date: '2026-08-20', text: '🏋️ ベンチプレス 85kg×5×2' },
    ]);
    expect(days[0].lifts).toBe(1);
    expect(days[0].sets).toBe(5);
  });

  it('読めない記録の日も欠落させない', () => {
    const days = groupLiftsByDay([{ id: 'a', date: '2026-08-20', text: '🏋️ メモだけ' }]);
    expect(days).toHaveLength(1);
    expect(days[0].sets).toBe(0);
  });

  it('自重種目はその日の体重で換算する（今日の体重で過去を計算しない）', () => {
    const at = weightLookup([
      { date: '2026-01-10', weight: 70 },
      { date: '2026-08-20', weight: 62 },
    ]);
    const days = groupLiftsByDay([
      { id: 'b', date: '2026-08-20', text: '🏋️ 懸垂 自重×8×3' },
      { id: 'a', date: '2026-01-10', text: '🏋️ 懸垂 自重×8×3' },
    ], at);
    expect(days[0].volume).toBe(62 * 8 * 3);
    expect(days[1].volume).toBe(70 * 8 * 3);
  });

  it('総挙上量はkg×回×セット', () => {
    expect(volumeOf({ name: 'ベンチプレス', kg: 80, reps: 8, sets: 3, mode: 'abs' })).toBe(1920);
  });
});
