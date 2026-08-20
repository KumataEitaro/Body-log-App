// 筋トレ記録の日ごとまとめと、1種目だけの削除。
// テキストを組み直すため、往復して形が変わらないことが重要（変わるとRM換算が読めなくなる）。
import { parseLiftText, liftTextFrom, removeLiftAt, groupLiftsByDay, volumeOf } from '../liftLog';

describe('記録テキストの解析', () => {
  it('セット数まで読む', () => {
    expect(parseLiftText('🏋️ ベンチプレス 80kg×8×3')).toEqual([
      { name: 'ベンチプレス', kg: 80, reps: 8, sets: 3 },
    ]);
  });

  it('複数種目を分解する', () => {
    expect(parseLiftText('🏋️ ベンチプレス 80kg×8×3、スクワット 100kg×5')).toEqual([
      { name: 'ベンチプレス', kg: 80, reps: 8, sets: 3 },
      { name: 'スクワット', kg: 100, reps: 5, sets: 1 },
    ]);
  });

  it('セット省略は1セットとして扱う', () => {
    expect(parseLiftText('🏋️ デッドリフト 140kg×3')[0].sets).toBe(1);
  });

  it('小数の重量を読む', () => {
    expect(parseLiftText('🏋️ アームカール 12.5kg×10×3')[0].kg).toBe(12.5);
  });

  it('絵文字がなくても読める', () => {
    expect(parseLiftText('ベンチプレス 80kg×8×3')).toHaveLength(1);
  });

  it('読めない断片は無視する（記録全体を落とさない）', () => {
    expect(parseLiftText('🏋️ ベンチプレス 80kg×8×3、メモ')).toHaveLength(1);
  });

  it('組み直しても表記が変わらない', () => {
    const text = '🏋️ ベンチプレス 80kg×8×3、スクワット 100kg×5';
    expect(liftTextFrom(parseLiftText(text))).toBe(text);
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

  it('総挙上量はkg×回×セット', () => {
    expect(volumeOf({ name: 'x', kg: 80, reps: 8, sets: 3 })).toBe(1920);
  });
});
