// 運動ぶんを目標カロリーへ **手動で** 反映する（2026-09-24）。
//
// 【何を変えたか】以前は設定「アクティブカロリーを目標に反映する」を ON にすると、ヘルスケアの
// アクティブ実測（歩数・Apple Watch のワークアウト）が読まれた瞬間に目標が自動で動いた。
// さらに「ヘルスケアから取り込む」でワークアウトを logs に入れると、その adj が目標に足され、
// アクティブ実測にも同じ運動が含まれているので**二重に**数えられていた。
//
// 熊田さん（2026-09-24）「Apple Watchから取り込む挙動と、目標カロリーを更新する挙動は分けて。
// 後者は自動にしないで。手動にして。もともと考慮してる運動量を二重でカウントしないようにして」
//
// 【新しい約束】
//   ・取り込む＝記録するだけ。目標は動かない（lib/day.ts isImportedExercise で自動加算から除外）
//   ・目標に足すのは、運動タブ「きょうの動き」の**ボタンを押したとき**だけ。額は押した時点で固定し、
//     entries.active_kcal（日ごと・同期される）に保存する。食事タブの目標＝
//       BMR × 生活係数 ＋ アプリで手記録した運動（dayExerciseKcal）＋ active_kcal
//   ・二重計上しない: 足せる額 = max(0, アクティブ実測 − BMR×(生活係数−1) − 手記録の運動kcal)
//       − BMR×(生活係数−1) … 日常の動きは生活係数として既に目標に入っている（lib/activeKcal.ts の式）
//       − 手記録の運動kcal … 手で記録した運動はその記録として既に目標に入っている（実測にも含まれる）
//   ・過去日の実効目標（収支カード・繰り越し調整の判定）も entries.active_kcal を足して組む。
//     以前は当日のヒーローだけが上乗せを含み、翌日の判定は含まなかったので「運動して多く食べた日」が
//     翌朝「+584kcal 食べすぎ」と誤判定されていた（スクショ 2026-09-24）
import { activeKcalGoalBonus } from './activeKcal';
import { resolveBurnKcal, type BurnSource } from './stepsKcal';
import { supabase } from './supabase';
import { t } from './i18n';

export type ActiveCandidate = { source: Exclude<BurnSource, 'recorded'>; kcal: number } | null;

/**
 * いま「目標に反映する」を押したら足せる額。ヘルスケアの実測も歩数も無い（＝アプリ記録だけ）なら null。
 * @param manualKcal その日にアプリで手記録した運動kcal（dayExerciseKcal・取込ぶんは含まない）
 */
export function activeApplyCandidate(input: {
  measured: number | null; steps: number | null; weightKg: number;
  bmr: number; lifeFactor: number; manualKcal: number;
}): ActiveCandidate {
  const burn = resolveBurnKcal({ measured: input.measured, steps: input.steps, weightKg: input.weightKg, recorded: 0 });
  if (burn.source === 'recorded') return null;
  const bonus = activeKcalGoalBonus(burn.kcal, input.bmr, input.lifeFactor);
  const manual = Number.isFinite(input.manualKcal) ? Math.max(0, Math.round(input.manualKcal)) : 0;
  return { source: burn.source, kcal: Math.max(0, Math.round(bonus - manual)) };
}

/** 列が無い旧DB（migration-36 未適用）のエラーか */
export function isMissingActiveKcalColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === 'PGRST204' || /active_kcal|column|schema/i.test(String(err.message ?? ''));
}

/** その日に反映済みの額（entries.active_kcal）。無い・読めない・列が無い → 0 */
export async function readAppliedActive(date: string): Promise<number> {
  try {
    const { data, error } = await supabase.from('entries').select('active_kcal').eq('date', date).maybeSingle();
    if (error) return 0;
    const v = Number((data as { active_kcal?: number | null } | null)?.active_kcal ?? 0);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  } catch { return 0; }
}

/**
 * 反映する（kcal）／取り消す（null）。entries の行が無い日は行を作る（他の列は既定値。
 * あとで食事を保存しても lib/sync.ts は active_kcal を触らないので、値は残る）。
 */
export async function writeAppliedActive(uid: string, date: string, kcal: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = kcal == null || !(kcal > 0) ? null : Math.round(kcal);
  try {
    const { error } = await supabase.from('entries')
      .upsert({ user_id: uid, date, active_kcal: v }, { onConflict: 'user_id,date' });
    if (error) {
      return { ok: false, error: isMissingActiveKcalColumn(error)
        ? t('反映を保存できませんでした（データベースの更新 migration-36 が未適用の可能性）。')
        : t('設定に失敗しました。もう一度お試しください。') };
    }
    return { ok: true };
  } catch { return { ok: false, error: t('設定に失敗しました。もう一度お試しください。') }; }
}
