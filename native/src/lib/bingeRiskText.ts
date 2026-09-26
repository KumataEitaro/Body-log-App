// 過食リスク v2 の文言（lib/bingeRisk.ts は t() を持たない純関数なので、表示用の翻訳はここに置く）。
// 辞書抽出（scripts/i18n-keys.js）は t('リテラル') しか拾えないため、RISK_FEATURES の label と
// 同じ日本語原文をここで一度リテラルとして書く（lib/correlate.ts conditionLabel と同じ流儀）。
import { t } from './i18n';
import { riskFeatureLabel, type RiskTier } from './bingeRisk';

/** 特徴キー → 現在の言語の理由文。未知のキーは label（日本語原文）をそのまま */
export function riskReasonText(key: string): string {
  switch (key) {
    case 'prev_deficit': return t('前日が目標より300kcal以上少なかった');
    case 'deficit_streak3': return t('3日つづけて目標未満だった');
    case 'prev_binge': return t('前日に食べすぎた');
    case 'binge_recent': return t('この1週間に食べすぎがあった');
    case 'prev_unlogged': return t('前日の記録が途切れていた');
    case 'sleep_short': return t('昨夜の睡眠が6時間未満');
    case 'sleep_debt': return t('睡眠不足が5時間以上たまっている');
    case 'mood_low': return t('気分が低め（前日2以下・または3日平均2.5以下）');
    case 'fri_sat': return t('金曜・土曜');
    case 'prev_low_protein': return t('前日のたんぱく質が普段より少なかった');
    case 'prev_late_eating': return t('前日は夜（20時以降）に3割以上食べた');
    case 'prev_few_meals': return t('前日の食事が2回以下だった');
    case 'luteal': return t('生理周期の後半（15日目以降）');
    case 'planned_event': return t('今日は外食・飲み会の予定');
    case 'prev_hard_exercise': return t('前日に運動を頑張った');
    case 'weight_up': return t('体重が1週間で0.5kg以上増えた');
    case 'stress_high': return t('今朝のストレスが高め');
    case 'prev_craving_high': return t('昨夜、食べたい気持ちが強かった');
    case 'prev_alcohol': return t('前日にお酒があった');
    case 'rhr_high': return t('安静時心拍がいつもより高い');
    case 'hrv_low': return t('心拍変動（HRV）がいつもより低い');
    case 'resp_high': return t('睡眠中の呼吸数がいつもより高い');
    case 'wrist_temp_high': return t('手首温がいつもより高い');
  }
  return t(riskFeatureLabel(key));
}

/** 段ごとの見出し（従来カードの2文言を段に写す） */
export function riskTierTitle(tier: RiskTier): string {
  return tier === 'warning' ? t('🌪 今日は食欲が爆発しやすい状態です') : t('🌤 今日は食欲が乱れやすいかも');
}

/** 夜の渇望チェックの選択肢 0–3（非審判の語で。数字は見せない） */
export function cravingLabel(level: 0 | 1 | 2 | 3): string {
  switch (level) {
    case 0: return t('落ち着いている');
    case 1: return t('少しある');
    case 2: return t('けっこうある');
    default: return t('抑えるのがつらい');
  }
}

/** 朝の気ぜわしさ 0–3 */
export function stressLabel(level: 0 | 1 | 2 | 3): string {
  switch (level) {
    case 0: return t('落ち着き');
    case 1: return t('少し');
    case 2: return t('けっこう');
    default: return t('かなり');
  }
}
