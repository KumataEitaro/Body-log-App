// 成長グラフ・バランス集計が読む解析。
// 記録の書き方（自重・加重）を足したとき、ここが読めないと
// 「保存はできているのにグラフに出ない」という気づきにくい壊れ方をする。
import { parseTrainingText, trainingSeries, weeklyPartVolumes } from '../training';
import { weightLookup } from '../liftLog';
import { addCustomLift, removeCustomLift, getCustomLifts } from '../lifts';

describe('parseTrainingText', () => {
  it('通常の記録を読む', () => {
    expect(parseTrainingText('🏋️ ベンチプレス 80kg×8×3')).toEqual([
      { name: 'ベンチプレス', kg: 80, reps: 8, sets: 3 },
    ]);
  });

  it('加重（+10kg）の記録を読み、負荷は体重＋加重にする', () => {
    expect(parseTrainingText('🏋️ 懸垂 +10kg×8×3', 62)).toEqual([
      { name: '懸垂', kg: 72, reps: 8, sets: 3 },
    ]);
  });

  it('自重だけの記録も読む（グラフから消えない）', () => {
    expect(parseTrainingText('🏋️ 懸垂 自重×8×3', 62)).toEqual([
      { name: '懸垂', kg: 62, reps: 8, sets: 3 },
    ]);
  });

  it('筋トレ以外の記録は対象にしない', () => {
    expect(parseTrainingText('🏃 ウォーキング 30分（約120kcal消費）')).toEqual([]);
  });

  it('セット省略は1セット', () => {
    expect(parseTrainingText('🏋️ スクワット 100kg×5')[0].sets).toBe(1);
  });
});

describe('trainingSeries', () => {
  it('同じ日の複数記録はmaxKgが最大・volumeが合算', () => {
    const s = trainingSeries([
      { date: '2026-08-20', text: '🏋️ ベンチプレス 80kg×8×3' },
      { date: '2026-08-20', text: '🏋️ ベンチプレス 90kg×3×1' },
    ]);
    expect(s.get('ベンチプレス')).toEqual([
      { date: '2026-08-20', maxKg: 90, volume: 80 * 8 * 3 + 90 * 3 },
    ]);
  });

  it('自重種目はその日の体重で負荷を出す（体重が減ればグラフも下がる）', () => {
    const at = weightLookup([
      { date: '2026-01-10', weight: 70 },
      { date: '2026-08-20', weight: 62 },
    ]);
    const s = trainingSeries([
      { date: '2026-01-10', text: '🏋️ 懸垂 自重×8×3' },
      { date: '2026-08-20', text: '🏋️ 懸垂 自重×8×3' },
    ], at);
    expect(s.get('懸垂')!.map((p) => p.maxKg)).toEqual([70, 62]);
  });

  it('日付順に並ぶ', () => {
    const s = trainingSeries([
      { date: '2026-08-20', text: '🏋️ スクワット 100kg×5' },
      { date: '2026-08-18', text: '🏋️ スクワット 95kg×5' },
    ]);
    expect(s.get('スクワット')!.map((p) => p.date)).toEqual(['2026-08-18', '2026-08-20']);
  });
});

describe('weeklyPartVolumes', () => {
  const rows = [
    { date: '2026-08-17', text: '🏋️ ショルダープレス 60kg×8×2' },   // 月曜（今週）
    { date: '2026-08-19', text: '🏋️ ベンチプレス 80kg×8×3' },       // 水曜（今週）
    { date: '2026-08-11', text: '🏋️ ショルダープレス 50kg×8×2' },   // 先週
  ];

  it('週×部位で集計され、最新週が末尾に来る', () => {
    const w = require('../training').weeklyPartVolumes(rows, undefined, 2, '2026-08-21');
    expect(w).toHaveLength(2);
    expect(w[0].week).toBe('2026-08-10');
    expect(w[1].week).toBe('2026-08-17');
    expect(w[1].byPart.shoulder).toBe(60 * 8 * 2);
    expect(w[1].byPart.chest).toBe(80 * 8 * 3);
    expect(w[1].total).toBe(60 * 8 * 2 + 80 * 8 * 3);
    expect(w[0].byPart.shoulder).toBe(50 * 8 * 2);
  });

  it('記録がない週は0で埋める（休んだ週が見える）', () => {
    const w = require('../training').weeklyPartVolumes(rows, undefined, 4, '2026-08-21');
    expect(w[0].total).toBe(0);
    expect(w[1].total).toBe(0);
  });

  it('自重種目はその週の体重で実負荷に換算する', () => {
    const at = (d: string) => (d < '2026-08-17' ? 70 : 62);
    const w = require('../training').weeklyPartVolumes(
      [
        { date: '2026-08-18', text: '🏋️ 懸垂 自重×8×3' },
        { date: '2026-08-11', text: '🏋️ 懸垂 自重×8×3' },
      ], at, 2, '2026-08-21');
    expect(w[1].byPart.back).toBe(62 * 8 * 3);
    expect(w[0].byPart.back).toBe(70 * 8 * 3);
  });

  it('ユーザー追加の種目は「その他」に入る', () => {
    const w = require('../training').weeklyPartVolumes(
      [{ date: '2026-08-18', text: '🏋️ ジャンプスクワット 20kg×10×3' }], undefined, 1, '2026-08-21');
    expect(w[0].byPart.other).toBe(20 * 10 * 3);
  });
});

// ダンベル種目（片側入力 `片側20kg`）と、部位つきで追加した種目の集計（2026-09-24）。
// 最大重量・推定1RMは片側のまま、ボリュームだけ両側ぶん＝この非対称をここで固定する
describe('片側入力（ダンベル）とユーザー追加種目の部位', () => {
  afterEach(async () => {
    for (const n of [...getCustomLifts()]) await removeCustomLift(n);
  });

  it('parseTrainingText: 片側の重さはそのまま kg・side=true', () => {
    expect(parseTrainingText('🏋️ ダンベルプレス 片側20kg×8×3')).toEqual([
      { name: 'ダンベルプレス', kg: 20, reps: 8, sets: 3, side: true },
    ]);
  });

  it('trainingSeries: maxKg は片側のまま・volume は両側ぶん・side が立つ', () => {
    const s = trainingSeries([
      { date: '2026-09-24', text: '🏋️ ダンベルプレス 片側20kg×8×3' },
      { date: '2026-09-24', text: '🏋️ ダンベルプレス 片側22.5kg×5' },
    ]);
    expect(s.get('ダンベルプレス')).toEqual([
      { date: '2026-09-24', maxKg: 22.5, volume: 40 * 8 * 3 + 45 * 5, side: true },
    ]);
  });

  it('trainingSeries: マーカーの無い旧記録は side を持たず、その重さそのものとして数える', () => {
    const s = trainingSeries([{ date: '2026-09-24', text: '🏋️ ダンベルプレス 40kg×8×3' }]);
    expect(s.get('ダンベルプレス')).toEqual([{ date: '2026-09-24', maxKg: 40, volume: 40 * 8 * 3 }]);
  });

  it('weeklyPartVolumes: 片側入力は両側ぶんで部位に積む', () => {
    const w = weeklyPartVolumes([{ date: '2026-08-18', text: '🏋️ サイドレイズ 片側8kg×15×3' }], undefined, 1, '2026-08-21');
    expect(w[0].byPart.shoulder).toBe(16 * 15 * 3);
    expect(w[0].total).toBe(16 * 15 * 3);
  });

  it('weeklyPartVolumes: ユーザー追加種目は選んだ部位に入る（その他に落ちない）', async () => {
    await addCustomLift('ヒップアブダクション', { part: 'legs' });
    await addCustomLift('ダンベルカール', { part: 'arm', dumbbell: true });
    const w = weeklyPartVolumes([
      { date: '2026-08-18', text: '🏋️ ヒップアブダクション 30kg×15×3' },
      { date: '2026-08-18', text: '🏋️ ダンベルカール 片側12kg×10×3' },
      { date: '2026-08-18', text: '🏋️ 知らない種目 20kg×10' },
    ], undefined, 1, '2026-08-21');
    expect(w[0].byPart.legs).toBe(30 * 15 * 3);
    expect(w[0].byPart.arm).toBe(24 * 10 * 3);
    expect(w[0].byPart.other).toBe(20 * 10);
    expect(w[0].total).toBe(30 * 15 * 3 + 24 * 10 * 3 + 20 * 10);
  });

  it('weeklyPartVolumes: 追加種目の自重（体重が負荷）もその週の体重で部位に積む', async () => {
    await addCustomLift('マッスルアップ', { bodyweight: true, part: 'back' });
    const w = weeklyPartVolumes([{ date: '2026-08-18', text: '🏋️ マッスルアップ 自重×5×3' }], () => 62, 1, '2026-08-21');
    expect(w[0].byPart.back).toBe(62 * 5 * 3);
  });
});
