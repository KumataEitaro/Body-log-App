// 生理周期モードの純関数。ここは「予測しない・断定しない」約束を固定する場所でもある。
// cycleDay は過去の記録からの日数しか返さず、未来の日付を作る関数は存在しない
// （averageCycleLength も「これまでの平均」であって次回予測ではない）。
// テストはロケール未設定（=日本語キーがそのまま返る）前提で日本語文字列を比較する。
import {
  cycleDay, averageCycleLength, isWaterRetentionWindow,
  normalizeStarts, recentCycles, menstrualBands, cycleSummary,
} from '../cycle';

describe('cycleDay', () => {
  const starts = ['2026-06-01', '2026-06-29', '2026-07-28'];

  it('開始日当日は1日目', () => {
    expect(cycleDay(starts, '2026-07-28')).toBe(1);
  });

  it('直近の開始日から数える（月をまたいでも正しい）', () => {
    // 6/29開始 → 7/1は3日目（6/29=1, 6/30=2, 7/1=3）
    expect(cycleDay(starts, '2026-07-01')).toBe(3);
    // 7/28開始 → 8/5は9日目（8月へ跨ぐ）
    expect(cycleDay(starts, '2026-08-05')).toBe(9);
  });

  it('最初の開始日より前の日付・未記録はnull（分からないことは言わない）', () => {
    expect(cycleDay(starts, '2026-05-31')).toBeNull();
    expect(cycleDay([], '2026-07-01')).toBeNull();
  });

  it('90日を超えて記録が途切れていたらnull（「周期200日目」とは言わない）', () => {
    expect(cycleDay(['2026-01-01'], '2026-03-31')).toBe(90);   // ちょうど90日目までは言う
    expect(cycleDay(['2026-01-01'], '2026-04-01')).toBeNull(); // 91日目からは黙る
  });

  it('順不同・重複・不正データが混じっても壊れない', () => {
    const dirty = ['2026-07-28', '2026-06-01', '2026-06-01', '2026-02-31', 'abc', '', '2026/07/01'] as string[];
    expect(normalizeStarts(dirty)).toEqual(['2026-06-01', '2026-07-28']);
    expect(cycleDay(dirty, '2026-07-30')).toBe(3);
    expect(cycleDay(starts, 'not-a-date')).toBeNull();
  });
});

describe('averageCycleLength', () => {
  it('連続する開始日の間隔の平均を四捨五入で返す', () => {
    // 28日・29日 → 平均28.5 → 29
    expect(averageCycleLength(['2026-06-01', '2026-06-29', '2026-07-28'])).toBe(29);
  });

  it('記録が1件以下ならnull（1周期ぶんも無いのに平均を名乗らない）', () => {
    expect(averageCycleLength(['2026-06-01'])).toBeNull();
    expect(averageCycleLength([])).toBeNull();
  });

  it('15〜60日から外れた間隔は打ち間違いとみなして平均に入れない', () => {
    // 6/1→6/3(2日・重複入力) は捨て、6/3→7/1(28日) だけを採る
    expect(averageCycleLength(['2026-06-01', '2026-06-03', '2026-07-01'])).toBe(28);
    // 採れる間隔がひとつも無ければnull
    expect(averageCycleLength(['2026-06-01', '2026-06-03'])).toBeNull();
  });
});

describe('isWaterRetentionWindow', () => {
  const starts = ['2026-07-28'];

  it('開始3日前〜開始後3日はtrue（境界を含む）', () => {
    expect(isWaterRetentionWindow(starts, '2026-07-25')).toBe(true); // 3日前ちょうど
    expect(isWaterRetentionWindow(starts, '2026-07-28')).toBe(true); // 開始日
    expect(isWaterRetentionWindow(starts, '2026-07-31')).toBe(true); // 3日後ちょうど
  });

  it('窓の外側はfalse（4日前・4日後）', () => {
    expect(isWaterRetentionWindow(starts, '2026-07-24')).toBe(false);
    expect(isWaterRetentionWindow(starts, '2026-08-01')).toBe(false);
  });

  it('未記録・不正な日付ではfalse（何も言わない側に倒す）', () => {
    expect(isWaterRetentionWindow([], '2026-07-28')).toBe(false);
    expect(isWaterRetentionWindow(starts, 'xxxx')).toBe(false);
  });
});

describe('recentCycles', () => {
  it('新しい順に返し、最新（進行中）の長さはnull', () => {
    const r = recentCycles(['2026-06-01', '2026-06-29', '2026-07-28'], 3);
    expect(r.map((c) => c.start)).toEqual(['2026-07-28', '2026-06-29', '2026-06-01']);
    expect(r[0].length).toBeNull();
    expect(r[1].length).toBe(29);
    expect(r[2].length).toBe(28);
  });
});

describe('menstrualBands', () => {
  it('開始日から5日間の帯になる', () => {
    expect(menstrualBands(['2026-07-28'])).toEqual([{ from: '2026-07-28', to: '2026-08-01' }]);
  });

  it('次の開始日が5日以内でも帯は重ならない', () => {
    expect(menstrualBands(['2026-07-28', '2026-07-31'])).toEqual([
      { from: '2026-07-28', to: '2026-07-30' },
      { from: '2026-07-31', to: '2026-08-04' },
    ]);
  });
});

describe('cycleSummary', () => {
  it('記録があれば周期日と平均、無ければ記録への誘い（断定も予測もしない）', () => {
    expect(cycleSummary(['2026-06-01', '2026-06-29', '2026-07-28'], '2026-08-01'))
      .toBe('周期5日目・これまでの平均29日');
    expect(cycleSummary(['2026-07-28'], '2026-08-01')).toBe('周期5日目');
    expect(cycleSummary([], '2026-08-01')).toBe('開始日を記録する');
  });
});
