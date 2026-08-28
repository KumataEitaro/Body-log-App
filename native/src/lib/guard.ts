// 安全ガードの共通ヘルパー（2026-08 1500人ペルソナ監査対応）。
//
// なぜ独立ファイルか: 体重の外れ値確認は保存経路が複数ある（クイック体重・トレイ保存・
// おかえりフロー・FAB）。各画面に判定式のコピーを持つと閾値がすぐズレるため、
// 判定と確認ダイアログをここに一本化する。
import { Alert } from 'react-native';
import { t } from './i18n';

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
    Alert.alert(
      t('前回から大きく変わっています（{prev}kg → {next}kg）。この値で合っていますか？', {
        prev: Number(prev).toFixed(1), next: Number(next).toFixed(1),
      }),
      undefined,
      [
        // 「入力し直す」を先頭（cancel）に置く: 誤入力の可能性が高い場面では戻る方を選びやすく
        { text: t('入力し直す'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('保存する'), onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}
