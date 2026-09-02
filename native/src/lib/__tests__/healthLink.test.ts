// ヘルスケア連携の判断規則（lib/healthLink.ts）を固定する。
// 要件: 一度連携したら「連携する」ボタンは二度と出ない／型追加時だけ自動で再許可／
//       体重は「新しい方が正」（手入力優先トグルで手入力を守れる）
import {
  resolveLinkState, needsReauth, decideWeightImport, latestPerDay, weightSourceId, isHealthKitSource,
  changeKindOf, formatLastSync, BACKGROUND_DELIVERY_TYPES, BACKGROUND_DELIVERY_FREQUENCY,
} from '../healthLink';
import { __resetHealthStore, bumpHealthVersion, healthStoreState, setHealthLinkState } from '../healthStore';

describe('resolveLinkState: 連携状態は1か所で決める', () => {
  it('HealthKitが無い環境（Android・Expo Go）はフラグに関係なく unavailable', () => {
    expect(resolveLinkState(false, false)).toBe('unavailable');
    expect(resolveLinkState(false, true)).toBe('unavailable');
  });
  it('iOS: フラグ無し=unlinked／フラグ有り=linked（以後ボタンは出ない）', () => {
    expect(resolveLinkState(true, false)).toBe('unlinked');
    expect(resolveLinkState(true, true)).toBe('linked');
  });
});

describe('needsReauth: READ_TYPESに型を足したときだけ自動で再許可', () => {
  it('shouldRequest(1) のみ true。unnecessary(2)・unknown(0)・null は false（毎回ダイアログを出さない）', () => {
    expect(needsReauth(1)).toBe(true);
    expect(needsReauth(2)).toBe(false);
    expect(needsReauth(0)).toBe(false);
    expect(needsReauth(null)).toBe(false);
    expect(needsReauth(undefined)).toBe(false);
  });
});

describe('decideWeightImport: 体重の優先規則', () => {
  const T0 = Date.UTC(2026, 8, 2, 0, 0, 0);   // 09:00 JST
  const hk = { kg: 64.2, at: T0 + 12 * 3600_000 };   // 21:00 JST の計測

  it('手入力が無い日は取り込む', () => {
    expect(decideWeightImport({ hk, manual: null, imported: null, preferManual: false })).toBe('write');
  });
  it('手入力あり・手入力優先ON → 触らない', () => {
    expect(decideWeightImport({ hk, manual: { kg: 64.8, at: T0 }, imported: null, preferManual: true })).toBe('skip-prefer-manual');
  });
  it('手入力あり・OFF → HealthKitの方が新しければ上書き', () => {
    expect(decideWeightImport({ hk, manual: { kg: 64.8, at: T0 }, imported: null, preferManual: false })).toBe('write');
  });
  it('手入力あり・OFF → 手入力の方が新しい（同時刻を含む）なら手入力を残す', () => {
    expect(decideWeightImport({ hk, manual: { kg: 64.8, at: hk.at + 60_000 }, imported: null, preferManual: false })).toBe('skip-manual-newer');
    expect(decideWeightImport({ hk, manual: { kg: 64.8, at: hk.at }, imported: null, preferManual: false })).toBe('skip-manual-newer');
  });
  it('既に同じサンプル（同時刻・同値）を取り込んであれば書かない（無駄な書き込みを避ける）', () => {
    expect(decideWeightImport({ hk, manual: null, imported: { kg: 64.2, at: hk.at }, preferManual: false })).toBe('skip-unchanged');
    // 値が変わっていれば（体重計の再計測）更新する
    expect(decideWeightImport({ hk, manual: null, imported: { kg: 63.9, at: hk.at }, preferManual: false })).toBe('write');
    // 時刻が新しくなっていれば更新する
    expect(decideWeightImport({ hk, manual: null, imported: { kg: 64.2, at: hk.at - 3600_000 }, preferManual: false })).toBe('write');
  });
  it('壊れた値（20kg未満・300kg超・NaN）は取り込まない', () => {
    expect(decideWeightImport({ hk: { kg: 0, at: T0 }, manual: null, imported: null, preferManual: false })).toBe('skip-invalid');
    expect(decideWeightImport({ hk: { kg: 350, at: T0 }, manual: null, imported: null, preferManual: false })).toBe('skip-invalid');
    expect(decideWeightImport({ hk: { kg: NaN, at: T0 }, manual: null, imported: null, preferManual: false })).toBe('skip-invalid');
    expect(decideWeightImport({ hk: { kg: 64, at: NaN }, manual: null, imported: null, preferManual: false })).toBe('skip-invalid');
  });
});

describe('latestPerDay: 日ごとの最終値', () => {
  const day = (at: number) => new Date(at).toISOString().slice(0, 10);
  it('同じ日に複数あれば計測時刻が最も遅いもの（順不同で渡してもよい）', () => {
    const d = Date.UTC(2026, 8, 1, 0, 0, 0);
    const m = latestPerDay([
      { kg: 65.0, at: d + 20 * 3600_000 },
      { kg: 65.4, at: d + 7 * 3600_000 },
      { kg: 64.9, at: d + 86400_000 + 7 * 3600_000 },
    ], day);
    expect(m.size).toBe(2);
    expect(m.get('2026-09-01')?.kg).toBe(65.0);
    expect(m.get('2026-09-02')?.kg).toBe(64.9);
  });
  it('NaN のサンプルは捨てる', () => {
    expect(latestPerDay([{ kg: NaN, at: 1 }, { kg: 60, at: NaN }], day).size).toBe(0);
  });
});

describe('source_id: HealthKit由来と手入力の区別', () => {
  it("体重は 'hk:bm:<日付>'（1日1行）。hk: で始まるものがHealthKit由来", () => {
    expect(weightSourceId('2026-09-02')).toBe('hk:bm:2026-09-02');
    expect(isHealthKitSource('hk:bm:2026-09-02')).toBe(true);
    expect(isHealthKitSource('hk:ABC-UUID')).toBe(true);
    expect(isHealthKitSource(null)).toBe(false);
    expect(isHealthKitSource('')).toBe(false);
  });
});

describe('変更イベント→キャッシュ種別・バックグラウンド配信の設定', () => {
  it('型識別子を種類へ写す（未知は other）', () => {
    expect(changeKindOf('HKQuantityTypeIdentifierStepCount')).toBe('steps');
    expect(changeKindOf('HKQuantityTypeIdentifierActiveEnergyBurned')).toBe('active');
    expect(changeKindOf('HKCategoryTypeIdentifierSleepAnalysis')).toBe('sleep');
    expect(changeKindOf('HKQuantityTypeIdentifierBodyMass')).toBe('weight');
    expect(changeKindOf('HKWorkoutTypeIdentifier')).toBe('workout');
    expect(changeKindOf('HKQuantityTypeIdentifierHeartRate')).toBe('other');
  });
  it('背景配信は歩数・アクティブ・体重・睡眠の4種・hourly(2)。ワークアウトは含めない（勝手に記録を増やさない）', () => {
    expect([...BACKGROUND_DELIVERY_TYPES]).toEqual([
      'HKQuantityTypeIdentifierStepCount', 'HKQuantityTypeIdentifierActiveEnergyBurned',
      'HKQuantityTypeIdentifierBodyMass', 'HKCategoryTypeIdentifierSleepAnalysis',
    ]);
    expect(BACKGROUND_DELIVERY_FREQUENCY).toBe(2);   // immediate(1) は電池・審査の観点で避ける
    expect((BACKGROUND_DELIVERY_TYPES as readonly string[]).includes('HKWorkoutTypeIdentifier')).toBe(false);
  });
});

describe('formatLastSync: 最終同期の表示', () => {
  it('null は未同期（null）・同じ日は HH:MM・別の日は M/D HH:MM', () => {
    expect(formatLastSync(null)).toBeNull();
    const now = new Date(2026, 8, 2, 15, 0, 0).getTime();
    expect(formatLastSync(new Date(2026, 8, 2, 9, 5, 0).getTime(), now)).toBe('09:05');
    expect(formatLastSync(new Date(2026, 7, 31, 22, 30, 0).getTime(), now)).toBe('8/31 22:30');
  });
});

describe('healthStore: 世代番号で購読者に知らせる', () => {
  beforeEach(() => __resetHealthStore());
  it('bumpHealthVersion で version が進み lastKind が残る。同じ状態の setLinkState は何も変えない', () => {
    expect(healthStoreState().version).toBe(0);
    bumpHealthVersion('steps');
    bumpHealthVersion('weight');
    expect(healthStoreState().version).toBe(2);
    expect(healthStoreState().lastKind).toBe('weight');
    setHealthLinkState('linked');
    expect(healthStoreState().link).toBe('linked');
    expect(healthStoreState().loaded).toBe(true);
  });
});
