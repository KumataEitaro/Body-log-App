// ヘルスケアの手動取込の仕分け（QA B-2）。
// ヘルスケアには他アプリの試し書きや単位違いの値が混ざる。ここだけ範囲ガードが無く、
// 「1桁多い体重」がそのまま entries に入って体重グラフが潰れていた。
import { filterImportable } from '../health';
import { WEIGHT_RANGE } from '../guard';

describe('filterImportable', () => {
  const by = (o: Record<string, number>) => new Map(Object.entries(o));

  it('既にアプリ側で体重がある日は取り込まない（手入力を正とする）', () => {
    const out = filterImportable(by({ '2026-09-09': 70.1, '2026-09-10': 70.3 }), new Set(['2026-09-10']));
    expect(out).toEqual([{ date: '2026-09-09', weight: 70.1 }]);
  });

  it('体重として現実的でない値は取り込まない（lib/guard の範囲が正本）', () => {
    const out = filterImportable(by({
      '2026-09-08': WEIGHT_RANGE.min,        // 境界は含めない
      '2026-09-09': 0,
      '2026-09-10': 703,                     // 桁の打ち間違い・単位違い
      '2026-09-11': 70.3,
    }), new Set());
    expect(out).toEqual([{ date: '2026-09-11', weight: 70.3 }]);
  });

  it('取り込むものが無ければ空配列（呼び出し側が0件として扱える）', () => {
    expect(filterImportable(by({}), new Set())).toEqual([]);
    expect(filterImportable(by({ '2026-09-10': 5000 }), new Set())).toEqual([]);
  });
});
