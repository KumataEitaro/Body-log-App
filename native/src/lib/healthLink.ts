// ヘルスケア連携の「判断」だけを集めた純関数群（ネイティブ依存なし・jestで固定する）。
//
// 実際のHealthKit呼び出しは lib/health.ts、購読者への通知は lib/healthStore.ts。
// ここには「連携状態をどう決めるか」「再許可が要るか」「体重をどちらを正とするか」
// という規則だけを置く。規則が1か所にあると、画面ごとの判定がズレない。

/** 連携状態。unavailable=HealthKitが無い環境（Android・Expo Go）／unlinked=未連携／linked=連携済み */
export type HealthLinkState = 'unavailable' | 'unlinked' | 'linked';

/** AsyncStorage: 初回の requestAuthorization が成功した時点で '1' を立てる（恒久） */
export const HEALTH_LINKED_KEY = 'bl-health-linked';
/** AsyncStorage: 体重は手入力を優先する（'1'=優先・未設定=OFF） */
export const HEALTH_PREFER_MANUAL_WEIGHT_KEY = 'bl-health-prefer-manual-weight';
/** AsyncStorage: 最終同期の時刻（epoch ms・文字列） */
export const HEALTH_LAST_SYNC_KEY = 'bl-health-last-sync';

/**
 * 連携状態の決定。available=isHealthDataAvailable()、linkedFlag=保存済みフラグ。
 * フラグが立っていても端末にHealthKitが無ければ unavailable（機種変更でAndroidへ移った等）。
 */
export function resolveLinkState(available: boolean, linkedFlag: boolean): HealthLinkState {
  if (!available) return 'unavailable';
  return linkedFlag ? 'linked' : 'unlinked';
}

/**
 * READ_TYPES に型を足した後、既存ユーザーに追加ぶんの許可ダイアログを自動で出すべきか。
 * HKAuthorizationRequestStatus: 0=unknown / 1=shouldRequest / 2=unnecessary
 * （@kingstinct/react-native-healthkit v14 src/types/Auth.ts）。
 * shouldRequest のときだけ true。unknown は「判定不能」なので黙って何もしない
 * （起動ごとにダイアログが出る事故を避ける＝安全側）。
 */
export function needsReauth(requestStatus: number | null | undefined): boolean {
  return Number(requestStatus) === 1;
}

/** 体重の取り込み判断に使う材料。at はいずれも epoch ms */
export type WeightImportInput = {
  /** HealthKitのその日の最終サンプル */
  hk: { kg: number; at: number };
  /** 同日の手入力の体重（無ければ null） */
  manual: { kg: number; at: number } | null;
  /** 同日に既に取り込んだHealthKit体重（無ければ null） */
  imported: { kg: number; at: number } | null;
  /** 設定「体重は手入力を優先」 */
  preferManual: boolean;
};

export type WeightImportDecision =
  | 'write'                 // 取り込む（新規 or 既存のHK行を更新）
  | 'skip-prefer-manual'    // 手入力があり、設定で手入力優先
  | 'skip-manual-newer'     // 手入力の方が新しい（HKが古い値を持っている）
  | 'skip-unchanged'        // 既に同じサンプルを取り込んである
  | 'skip-invalid';         // 値が壊れている（0以下・NaN・現実的でない）

/**
 * 体重の自動取り込みの優先規則（1日1値・「新しい方が正」）。
 *   1. 値が壊れていれば取り込まない（20〜300kgの外はスケールの誤計測とみなす）
 *   2. 手入力がある日:
 *        設定「手入力を優先」ON → 取り込まない
 *        OFF → HealthKitの計測時刻が手入力より新しいときだけ上書き（同時刻は手入力を残す）
 *   3. 既に取り込んだHK値がある日: 同じ時刻・同じ値なら何もしない（無駄な書き込みを避ける）
 *   4. それ以外は取り込む
 * 「手入力より新しければ上書き」にするのは、朝アプリに入れた後で夜スマート体重計に乗った
 * ようなケースで、より新しい実測を正とするため。逆にHKが持っているのが朝の古い値なら手入力が残る。
 */
export function decideWeightImport(i: WeightImportInput): WeightImportDecision {
  const kg = Number(i.hk.kg);
  if (!Number.isFinite(kg) || kg < 20 || kg > 300 || !Number.isFinite(i.hk.at)) return 'skip-invalid';
  if (i.manual) {
    if (i.preferManual) return 'skip-prefer-manual';
    if (i.hk.at <= i.manual.at) return 'skip-manual-newer';
  }
  if (i.imported && i.imported.at === i.hk.at && Math.abs(i.imported.kg - kg) < 0.05) return 'skip-unchanged';
  return 'write';
}

/** 取り込み元の照合に使う logs.source_id。体重は 'hk:bm:<日付>'（1日1行に集約・更新で上書き） */
export function weightSourceId(date: string): string {
  return `hk:bm:${date}`;
}

/** source_id がHealthKit由来か（手入力との区別に使う） */
export function isHealthKitSource(sourceId: string | null | undefined): boolean {
  return typeof sourceId === 'string' && sourceId.startsWith('hk:');
}

/**
 * サンプル列（時刻順不問）から「日ごとの最終値」を選ぶ。dateKey は呼び出し側がJST変換を渡す。
 * 同一日で複数あれば計測時刻が最も遅いものを採用（体重計に2回乗った日は後の方）。
 */
export function latestPerDay<T extends { at: number; kg: number }>(
  samples: readonly T[],
  dateKey: (at: number) => string,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const s of samples) {
    if (!Number.isFinite(s.at) || !Number.isFinite(s.kg)) continue;
    const d = dateKey(s.at);
    const cur = out.get(d);
    if (!cur || s.at > cur.at) out.set(d, s);
  }
  return out;
}

/**
 * バックグラウンド配信を有効にする型（HKUpdateFrequency.hourly）。
 * immediate は電池消費が大きく、審査でも「必要性の説明」を求められやすいため避ける。
 * 歩数・アクティブkcal・体重・睡眠だけで十分（ワークアウトは手動取込のまま＝勝手に記録を増やさない）。
 */
export const BACKGROUND_DELIVERY_TYPES = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierBodyMass',
  'HKCategoryTypeIdentifierSleepAnalysis',
] as const;

/** HKUpdateFrequency（@kingstinct v14 types/Background.ts）: 1=immediate 2=hourly 3=daily 4=weekly */
export const BACKGROUND_DELIVERY_FREQUENCY = 2;

/**
 * 変更イベントの型識別子 → 無効化すべきキャッシュの種類。
 * 体重は表示キャッシュを持たない（entriesへ取り込むのが仕事）ので 'weight' として別扱い。
 */
export type HealthChangeKind = 'steps' | 'active' | 'sleep' | 'weight' | 'workout' | 'other';
export function changeKindOf(typeIdentifier: string): HealthChangeKind {
  switch (typeIdentifier) {
    case 'HKQuantityTypeIdentifierStepCount': return 'steps';
    case 'HKQuantityTypeIdentifierActiveEnergyBurned': return 'active';
    case 'HKCategoryTypeIdentifierSleepAnalysis': return 'sleep';
    case 'HKQuantityTypeIdentifierBodyMass': return 'weight';
    case 'HKWorkoutTypeIdentifier': return 'workout';
    default: return 'other';
  }
}

/**
 * 「最終同期」の表示用。同じ日なら HH:MM、別の日なら M/D HH:MM。null は「まだ」。
 * now を注入できるようにしてテスト可能にしている。
 */
export function formatLastSync(at: number | null, now: number = Date.now()): string | null {
  if (at == null || !Number.isFinite(at)) return null;
  const d = new Date(at);
  const n = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return same ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
