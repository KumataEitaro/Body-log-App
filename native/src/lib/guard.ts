// 安全ガードの共通ヘルパー（2026-08 1500人ペルソナ監査対応）。
//
// なぜ独立ファイルか: 体重の外れ値確認は保存経路が複数ある（クイック体重・トレイ保存・
// おかえりフロー・FAB）。各画面に判定式のコピーを持つと閾値がすぐズレるため、
// 判定と確認ダイアログをここに一本化する。
import { Alert } from 'react-native';
import { t } from './i18n';
import { MAX_WEEKLY_LOSS_KG, FAST_WEEKLY_LOSS_KG } from './deficit';

/**
 * 体重として受け付ける範囲(kg)。両端は含めない（20kg以下・300kg以上は打ち間違い）。
 * QA B-2: 体重の入力口が4つ（クイック入力・おかえりフロー・オンボーディング・ヘルスケア取込）
 * あり、それぞれ別々の閾値を持っていた。ここを唯一の正本にする。
 */
export const WEIGHT_RANGE = { min: 20, max: 300 } as const;

export function inWeightRange(kg: number | null | undefined): boolean {
  return kg != null && Number.isFinite(kg) && kg > WEIGHT_RANGE.min && kg < WEIGHT_RANGE.max;
}

/**
 * 体脂肪率として受け付ける範囲(%)。両端を含む。
 * 下限3%は男性の生存限界（必須脂肪）、上限70%は極端な高度肥満でも超えない値。
 * QA B-2: 体写真カードには範囲ガードが無く、「1234」を入れるとグラフが潰れていた。
 */
export const BODYFAT_RANGE = { min: 3, max: 70 } as const;

export function inBodyfatRange(pct: number | null | undefined): boolean {
  return pct != null && Number.isFinite(pct) && pct >= BODYFAT_RANGE.min && pct <= BODYFAT_RANGE.max;
}

/**
 * ウエストとして受け付ける範囲(cm)。両端は含めない。
 * 2026-09-18 に＋シートから体重と同じ手順で入れられるようにしたので、体重と同じく正本をここに置く。
 * 40cm 未満は成人ではありえず、200cm 超は測り間違い（インチと混同した 30〜40 は 40cm 未満で弾ける）。
 */
export const WAIST_RANGE = { min: 40, max: 200 } as const;

export function inWaistRange(cm: number | null | undefined): boolean {
  return cm != null && Number.isFinite(cm) && cm > WAIST_RANGE.min && cm < WAIST_RANGE.max;
}

/**
 * プロフィールの身長cm・年齢の範囲（両端を含む）。基礎代謝(Mifflin)の入力なので、
 * ここが別人の値だと「あと食べられる量」まで全部ズレる。
 * 100〜250cm はギネス級の身長も収まる幅、10〜120歳は利用規約の年齢下限より広い幅。
 */
export const HEIGHT_RANGE = { min: 100, max: 250 } as const;
export const AGE_RANGE = { min: 10, max: 120 } as const;

export function inHeightRange(cm: number | null | undefined): boolean {
  return cm != null && Number.isFinite(cm) && cm >= HEIGHT_RANGE.min && cm <= HEIGHT_RANGE.max;
}

export function inAgeRange(years: number | null | undefined): boolean {
  return years != null && Number.isFinite(years) && years >= AGE_RANGE.min && years <= AGE_RANGE.max;
}

/**
 * BMI18.5に相当する体重(kg)。目標体重のハード下限に使う。
 * 18.5はWHOの「低体重」境界。これを下回る目標は健康リスクが大きいため保存自体を止める。
 */
export function bmiFloorKg(heightCm: number): number {
  return Math.round(18.5 * (heightCm / 100) ** 2 * 10) / 10;
}

/**
 * 減量ペース(kg/週)。減量方向でない・期間が0日以下なら null（判定対象外）。
 * 週1kg超の減量は筋量・ホルモンへの負担が大きく、リバウンド率も高いため上限にする。
 */
export function weeklyLossPace(currentKg: number, targetKg: number, fromDate: string, toDate: string): number | null {
  const days = (Date.parse(toDate) - Date.parse(fromDate)) / 86400000;
  if (!(days > 0) || !(currentKg > targetKg)) return null;
  return (currentKg - targetKg) / (days / 7);
}

/**
 * 体重目標の安全判定（G1: BMI下限・減量ペース / G3: 妊娠・授乳中）。
 *
 * なぜ集約したか（QA P1-6）: 同じ `goals.target_weight` を書く経路が2つ（目標パネルと
 * AIコーチの承認カード）あるのに、判定式を持っていたのは目標パネルだけだった。
 * AIに「2週間で10kg落として」と頼めば BMI13 の目標がそのまま書き込めてしまう。
 * 判定を1本にして、書き込み経路が増えても同じ壁を通るようにする。
 *
 * 返り値は「弾く（ok:false）」か「通す（ok:true・注意文つきのことがある）」の2つだけ。
 * 呼び出し側が無言で終われないよう、弾くときは必ず理由を持たせる。
 */
export type WeightGoalInput = {
  /** 身長cm。未登録（null）ならBMI下限の判定だけスキップする */
  heightCm?: number | null;
  /** 現在の体重kg。未取得（null）ならペースと妊娠中の判定をスキップする */
  currentKg?: number | null;
  /** 目標体重kg */
  targetKg?: number | null;
  /** 目標日 YYYY-MM-DD。未指定（null）ならペース判定をスキップする */
  targetDate?: string | null;
  /** 判定の基準日 YYYY-MM-DD（JST） */
  today: string;
  /** 妊娠中・授乳中（profiles.maternity） */
  maternity?: boolean | null;
  /** ダイエット目的（lib/purpose の PurposeKey）。増量目的では減量ペースを見ない */
  purpose?: string | null;
};

export type WeightGoalAssessment =
  /** warn: 保存は通すが一言添える（週0.5〜1kgのやや速いペース） */
  | { ok: true; warn?: string }
  | { ok: false; reason: string };

export function assessWeightGoal(input: WeightGoalInput): WeightGoalAssessment {
  const { heightCm, currentKg, targetKg, targetDate, today, maternity, purpose } = input;
  if (targetKg == null || !Number.isFinite(targetKg)) return { ok: true };

  // G1: BMI18.5未満になる目標はハードロック（身長未登録ならこのチェックだけスキップ）
  if (heightCm != null && Number.isFinite(heightCm) && heightCm > 0) {
    const floor = bmiFloorKg(heightCm);
    if (targetKg < floor) {
      return {
        ok: false,
        reason: t('その目標は体に負担が大きすぎます。BMI18.5（{kg}kg）を下回る目標は設定できません。', { kg: floor.toFixed(1) }),
      };
    }
  }

  // G3: 妊娠・授乳中は減量方向の目標（目標体重<現在体重）を受け付けない
  if (maternity === true && currentKg != null && targetKg < currentKg) {
    return { ok: false, reason: t('妊娠・授乳中は減量目標を設定できません。いまは維持と栄養が最優先です。') };
  }

  // G1: 週1kg超の減量ペースはハードロック。週0.5〜1kgは警告だけ添えて保存は許可。
  // 増量目的（bulk）は減量方向の目標自体が例外なので、ペースの上限は当てない
  if (currentKg != null && targetDate && purpose !== 'bulk') {
    const pace = weeklyLossPace(currentKg, targetKg, today, targetDate);
    if (pace != null && pace > MAX_WEEKLY_LOSS_KG) {
      return { ok: false, reason: t('そのペースは速すぎます。週1kg以内になるよう、日付か目標を調整してください。') };
    }
    if (pace != null && pace >= FAST_WEEKLY_LOSS_KG) {
      return { ok: true, warn: t('やや速いペースです（週あたり約{n}kg）。体調の変化に気をつけて進めましょう。', { n: pace.toFixed(1) }) };
    }
  }
  return { ok: true };
}

/**
 * 体重の外れ値判定: 前回記録から±15%以上ずれているか。
 * 58.2→82.5 のような打ち間違いが1件入るだけでグラフと計画計算が壊れるため、
 * 保存前に一度だけ本人に確かめる。前回値が無ければ判定しない（初回記録を邪魔しない）。
 */
export function isOutlierWeight(prev: number | null | undefined, next: number): boolean {
  if (prev == null || !(prev > 0) || !(next > 0)) return false;
  return Math.abs(next - prev) / prev >= 0.15;
}

/**
 * 外れ値なら確認Alertを出し、本人の選択を返す（true=このまま保存 / false=入力し直す）。
 * 外れ値でなければ確認なしで即true（通常の保存を1タップも増やさない）。
 */
export function confirmOutlierWeight(prev: number | null | undefined, next: number): Promise<boolean> {
  if (!isOutlierWeight(prev, next)) return Promise.resolve(true);
  return new Promise((resolve) => {
    // **必ず1回だけ決着させる**（2026-09-15・Android 監査）。
    // この確認は ＋シート（Modal 表示中）からも呼ばれる。Android の Alert は
    // 現在の Activity が取れないと **何も表示せず console.warn だけ**して終わる
    // （ReactAndroid DialogModule → Libraries/Alert/Alert.js の errorCallback）。
    // JS 側には失敗が返らないので、ボタンの onPress でしか resolve しない作りだと
    // Promise が永久に pending になり、「体重を記録」ボタンが押しっぱなしで固まる。
    // 表示できなかった場合の逃げ道として onDismiss と保険のタイマーを置く。
    let done = false;
    const settle = (v: boolean) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    // 出せなかった／ユーザーが触れない状態が続いたら「保存しない」に倒す（誤入力の可能性が高い場面なので安全側）
    const timer = setTimeout(() => settle(false), 30_000);
    Alert.alert(
      t('前回から大きく変わっています（{prev}kg → {next}kg）。この値で合っていますか？', {
        prev: Number(prev).toFixed(1), next: Number(next).toFixed(1),
      }),
      undefined,
      [
        // 「入力し直す」を先頭（cancel）に置く: 誤入力の可能性が高い場面では戻る方を選びやすく
        { text: t('入力し直す'), style: 'cancel', onPress: () => settle(false) },
        { text: t('保存する'), onPress: () => settle(true) },
      ],
      // Android で戻るキー等により閉じられたときも必ず決着させる
      { cancelable: false, onDismiss: () => settle(false) },
    );
  });
}

/**
 * アカウント削除の確認語が入力されたか。
 * 表示ラベル「確認のため「削除」と入力」は各言語へ翻訳されるため、比較も翻訳後の語（t('削除')）で
 * 行う。日本語の原文「削除」はどの言語でも常に受け付ける。
 * 以前は原文との完全一致だけだったので、英語UIで placeholder どおり "Delete" と打っても
 * ボタンが有効にならない行き止まりだった（2026-09-02 自己監査）。
 */
export function deleteConfirmMatches(input: string, localizedWord: string = t('削除')): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  const v = norm(input);
  if (!v) return false;
  return v === norm('削除') || v === norm(localizedWord);
}
