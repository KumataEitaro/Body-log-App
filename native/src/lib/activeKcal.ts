// アクティブカロリー（Appleヘルスケアの実測消費）を目標kcalへ反映するかどうか。
//
// ■ なぜ「任意設定」なのか
// 運動タブ「きょうの動き」の消費は、これまでアプリに手で記録した運動（logs.adj）だけを
// 見ていた。そのため「10,013歩なのに消費0kcal」という明らかに不合理な表示が出た（βFB）。
// 歩いたぶんはヘルスケアが実測で持っているので、表示はそれを主にする。
// ただし「表示する」と「目標（=あと食べられる量）に足す」は別問題。足すと歩いた分だけ
// 食べられる量が増え、痩せにくくなる人が必ず出る。だから足すかどうかは本人に決めてもらう
// （既定OFF＝これまでの挙動から一切変わらない）。
//
// ■ 二重計上をどう避けるか（この式のいちばん大事なところ）
// 既存の目標kcalは
//     目標 = BMR × 生活係数(life_factor) + EX_ADD[ex] + adj
// で計算している（lib/calc.ts targetKcal）。ここで life_factor（既定1.3）は
// 「基礎代謝の上に、日常生活で動くぶんを何割か乗せる」係数であり、
// **通勤・買い物・家事レベルの日常活動はすでに目標に入っている**。
// 一方ヘルスケアのアクティブエネルギーは「安静時を超えて消費したぶん」の実測で、
// 日常の歩行もそこに含まれる。したがってアクティブ全量を足すと、
// 日常活動ぶんを life_factor とアクティブの二重で数えることになる。
//
// そこで「その人の日常活動の想定値」を
//     想定日常活動 = BMR × (life_factor − 1)
// （例: BMR 1,700・係数1.3 → 1,700 × 0.3 = 510kcal）と見なし、
//     上乗せ = max(0, アクティブkcal − 想定日常活動)
// つまり **想定より多く動いた分だけ** を目標に足す。
// - 想定内（デスクワークで在宅の日など）は 0 ＝目標は今までどおり
// - 想定を超えて歩いた日だけ、その超過分が「あと食べられる量」に乗る
// - 係数が高い人（もともとよく動く前提で目標が多い人）は上乗せが起きにくい
//   ＝すでに目標に織り込まれているのだから、これが正しい
// max(0, ...) でマイナスにしないのは、「動かなかった日は目標を削る」までやると
// 記録が罰になり、続かなくなるため（アプリ全体の「1日の欠けで全崩壊させない」方針）。
//
// 精度そのものは追わない（アクティブの実測とMETs換算の手記録は重複しうるが、
// 差分の厳密計算はしない＝過剰に賢くしない）。UIで重複の可能性を1行断っている。
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { readActiveEnergyCached, healthAvailable, readActivitySummary, type HealthDaySummary } from './health';

/** 「アクティブカロリーを目標に反映する」の保存キー（設定画面と各タブで共有・未設定=OFF） */
export const ACTIVE_KCAL_TO_GOAL_KEY = 'bl-active-kcal-to-goal';

/**
 * 目標kcalへ上乗せするアクティブぶん（kcal・整数・0以上）。
 *
 * @param activeKcal ヘルスケアのアクティブエネルギー実測（その日の合計）
 * @param bmr        Mifflin-St JeorのBMR
 * @param lifeFactor profiles.life_factor（既定1.3）
 *
 * 式: max(0, activeKcal − BMR × (lifeFactor − 1))
 * 「BMR × (lifeFactor − 1)」はすでに目標に入っている日常活動ぶんの想定値。
 * 詳しい根拠はファイル冒頭のコメント参照。
 */
export function activeKcalGoalBonus(activeKcal: number, bmr: number, lifeFactor: number): number {
  const active = Number(activeKcal);
  const b = Number(bmr);
  const lf = Number(lifeFactor);
  // 入力が壊れている（未ロードのプロフィール等）ときは上乗せしない＝安全側に倒す
  if (!Number.isFinite(active) || active <= 0) return 0;
  if (!Number.isFinite(b) || b <= 0) return 0;
  // 係数が1未満（あり得ないが手入力DBの事故）なら想定日常活動0として扱う
  const assumedDaily = Number.isFinite(lf) && lf > 1 ? b * (lf - 1) : 0;
  return Math.max(0, Math.round(active - assumedDaily));
}

/** 「アクティブカロリーを目標に反映する」設定（既定OFF）。設定画面から戻ったら追従するようフォーカスごとに読み直す */
export function useActiveKcalToGoal(): boolean {
  const [on, setOn] = useState(false);
  const read = useCallback(() => {
    AsyncStorage.getItem(ACTIVE_KCAL_TO_GOAL_KEY).then((v) => setOn(v === '1')).catch(() => {});
  }, []);
  useEffect(() => { read(); }, [read]);
  useFocusEffect(read);
  return on;
}

/**
 * その日のアクティブkcal（ヘルスケア実測）。連携なし・非対応環境・読み取り失敗はnull。
 * 読み取りはlib/health.ts側でキャッシュしているので、画面が増えても実際のHealthKit問い合わせは増えない。
 */
export function useActiveKcal(date: string): number | null {
  const [kcal, setKcal] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    if (!healthAvailable()) { setKcal(null); return; }
    readActiveEnergyCached(14).then((days) => {
      if (!alive) return;
      if (days == null) { setKcal(null); return; }
      setKcal(days.find((d) => d.date === date)?.kcal ?? 0);
    }).catch(() => {});
    return () => { alive = false; };
  }, [date]);
  return kcal;
}

// ===== 歩数（食事タブのヒーロー用・運動タブと同じ3段階のための材料） =====
// 運動タブ「きょうの動き」は lib/stepsKcal.ts resolveBurnKcal で
//   ① 実測>0 → 実測 ／ ② 実測0で歩数>0 → 歩数から推定 ／ ③ どちらも無し → 記録のみ
// の3段階にしている。食事タブの「歩いたぶん +Nkcal」も同じ3段階に揃えないと、
// Apple Watchが無い人は運動タブでは推定が出るのにヒーローの上乗せは0のまま、という食い違いが出る。
// 歩数の読み取りは readActivitySummary（歩数＋睡眠＋アクティブ）しか無く lib/health.ts は
// 触れないので、ここで15分キャッシュして画面遷移ごとの HealthKit 問い合わせを抑える。
const STEPS_TTL_MS = 15 * 60 * 1000;
let stepsCache: { at: number; data: HealthDaySummary[] | null } | null = null;
let stepsInflight: Promise<HealthDaySummary[] | null> | null = null;

/** 直近14日の日別サマリー（キャッシュ付き・同時呼び出しは1本に合流）。非対応環境・失敗はnull */
async function readStepsCached(): Promise<HealthDaySummary[] | null> {
  const now = Date.now();
  if (stepsCache && now - stepsCache.at < STEPS_TTL_MS) return stepsCache.data;
  if (stepsInflight) return stepsInflight;
  stepsInflight = (async () => {
    const r = await readActivitySummary(14);
    const data = 'error' in r ? null : r;
    stepsCache = { at: Date.now(), data };
    return data;
  })().finally(() => { stepsInflight = null; });
  return stepsInflight;
}

/**
 * その日の歩数（ヘルスケア）。連携なし・非対応環境・読み取り失敗はnull、
 * 読めたが記録が無い日は0（resolveBurnKcal は 0 を「歩数なし」として③へ落とす）
 */
export function useStepsOfDay(date: string): number | null {
  const [steps, setSteps] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    if (!healthAvailable()) { setSteps(null); return; }
    readStepsCached().then((days) => {
      if (!alive) return;
      if (days == null) { setSteps(null); return; }
      setSteps(days.find((d) => d.date === date)?.steps ?? 0);
    }).catch(() => {});
    return () => { alive = false; };
  }, [date]);
  return steps;
}
