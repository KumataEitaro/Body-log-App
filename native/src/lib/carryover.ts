// 食べすぎ・少なすぎの「繰り越し調整」（carry-over・2026-09-21）。純関数だけ（保存・フックは lib/carryPrefs.ts）。
//
// 【何をするか】ある日の摂取が目標から大きくずれた（|摂取 − 目標| > CARRY_THRESHOLD）とき、
// そのずれを翌日から N 日（既定 7・ユーザーが変えられる）に分けて目標に織り込む。
//   ・+1,000kcal 食べすぎ → 翌日から7日、目標を −143kcal/日
//   ・−700kcal 少なすぎ   → 翌日から7日、目標を +100kcal/日
// 「体重は1日ではなく週・月の収支で決まる」（lib/deficit.ts）を、数字の側から実際に支える。
//
// 【なぜ events テーブルに載せるか】チートデイ（先の予定）と同じ「日付と kcal を持つ1行」で、
// computePlan / dailyAllowance の前で足すだけ。kind='carry' で区別し、取り返す日数は行ごとに固定する
// （absorb_days）。あとで既定日数を変えても、承認済みの調整は承認した時の約束のまま動く。
//
// 【なぜ額を承認時に固定するか】「その日の実摂取 − 目標」を毎日再計算して返済額にする方式だと、
// 調整後の目標を守った日が「少なすぎ」に見えて逆向きの調整を生む（振動する）。
// 台帳（events の行）に固定額で積み、翌日以降の判定は「調整込みの目標」に対して行うので振動しない。
//
// 【判定の非対称】超過はその日の途中でも確定できる（食べたものは戻らない）ので当日に聞ける。
// 不足は1日が終わるまで分からない（昼の時点では誰でも「不足」）ので翌朝、起床後に聞く。
// 1品しか記録の無い日の不足は「記録が少ない」可能性が高いので聞かない（CARRY_MIN_ENTRIES）。
//
// 【UI の流儀】確認は Alert（モーダル）ではなく、ヒーロー直下の非モーダルなカード（lib/logCards.ts で調停）。
// Apple HIG は「日常的な情報にアラートを使わない」。文面は責めない（MacroFactor 流 adherence-neutral）。
import { addDays, daysBetween, type PlanEvent } from './goal';

export type EventKind = 'plan' | 'carry';
/** events テーブルの1行。kind / absorb_days は migration-35 以降（無い旧DBでは undefined＝plan 扱い） */
export type EventRow = PlanEvent & { id: string; kind?: string | null; absorb_days?: number | null };

/** |摂取 − 目標| がこれを超えたら「ずれ」とみなす（kcal）。以下は 1日の誤差の範囲（deficit.ts の OVER_MID_MAX と同じ帯） */
export const CARRY_THRESHOLD = 500;
export const CARRY_DAYS_DEFAULT = 7;
export const CARRY_DAYS_OPTIONS: readonly number[] = [3, 5, 7, 10, 14];
export const CARRY_DAYS_MAX = 60;
/** 不足を「本当に少なかった」と見るための、その日の食事記録の最低件数 */
export const CARRY_MIN_ENTRIES = 2;
/** DB に入れる title。表示は kind で分岐するので訳さない（識別にも使わない＝識別は kind 列） */
export const CARRY_TITLE = '⚖️ 調整';

export type CarryMode = 'ask' | 'auto' | 'off';

export function isCarry(e: { kind?: string | null } | null | undefined): boolean {
  return e?.kind === 'carry';
}

/** events の行を「先の予定（plan）」と「繰り越し調整（carry）」に分ける。kind の無い旧行は plan */
export function splitEvents<T extends { kind?: string | null }>(rows: readonly T[]): { plans: T[]; carries: T[] } {
  const plans: T[] = [];
  const carries: T[] = [];
  for (const r of rows) (isCarry(r) ? carries : plans).push(r);
  return { plans, carries };
}

export function clampCarryDays(n: unknown, fallback = CARRY_DAYS_DEFAULT): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 1) return fallback;
  return Math.min(CARRY_DAYS_MAX, v);
}

/** ずれ extraKcal を days 日に分けた1日ぶん（符号はずれと同じ。正=食べすぎの返済） */
export function carryPerDay(extraKcal: number, days: number): number {
  return Math.round((Number(extraKcal) || 0) / clampCarryDays(days));
}

function windowOf(c: { absorb_days?: number | null }, defaultDays: number): number {
  return c.absorb_days != null && Number(c.absorb_days) > 0 ? clampCarryDays(c.absorb_days) : clampCarryDays(defaultDays);
}

type CarryLike = { date: string; extra_kcal: number; kind?: string | null; absorb_days?: number | null };

/**
 * その日（todayISO）の必要赤字に足す調整kcal。正=食べる量を減らす（超過の返済）、負=増やす（不足の取り戻し）。
 * 調整は**翌日から**なので、その日と同じ日付の行は含めない。窓（行の absorb_days、無ければ defaultDays）を過ぎた行も含めない。
 */
export function carryToday(carries: readonly CarryLike[], todayISO: string, defaultDays: number): number {
  let sum = 0;
  for (const c of carries) {
    if (!isCarry(c) || c.date >= todayISO) continue;
    const days = windowOf(c, defaultDays);
    const k = daysBetween(c.date, todayISO);
    if (k < 1 || k > days) continue;
    sum += (Number(c.extra_kcal) || 0) / days;
  }
  return Math.round(sum);
}

export type ActiveCarry = {
  id: string; date: string; extra_kcal: number;
  days: number;       // 何日に分けるか
  perDay: number;     // 1日ぶん（符号はずれと同じ）
  daysLeft: number;   // 今日を含めて残り何日効くか（当日の行＝明日から days 日）
  endDate: string;    // 最後に効く日
};

/** 目標画面の「いま調整中」一覧。当日の行（明日から効く）も含め、窓を過ぎたものは出さない。新しい日付が先 */
export function activeCarries(carries: readonly EventRow[], todayISO: string, defaultDays: number): ActiveCarry[] {
  const out: ActiveCarry[] = [];
  for (const c of carries) {
    if (!isCarry(c)) continue;
    const days = windowOf(c, defaultDays);
    const k = daysBetween(c.date, todayISO);
    if (k < 0 || k > days) continue;
    const extra = Math.round(Number(c.extra_kcal) || 0);
    out.push({
      id: c.id, date: c.date, extra_kcal: extra, days,
      perDay: carryPerDay(extra, days),
      daysLeft: days - Math.max(k, 1) + 1,
      endDate: addDays(c.date, days),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export type CarryDetect = {
  date: string;
  delta: number;            // 摂取 − 目標（正=食べすぎ）
  kind: 'over' | 'under';
  days: number;
  perDay: number;           // 1日ぶん（符号は delta と同じ）
};

/**
 * その日の「ずれ」を判定する。null なら何も聞かない。
 *  - 未記録（intake null）は穴埋め（backfill）の担当なので null
 *  - |ずれ| が閾値以下なら null（1日の誤差の範囲）
 *  - 不足は「1日が終わってから」（sameDay なら null）かつ記録が CARRY_MIN_ENTRIES 件以上あるときだけ
 */
export function detectCarry(input: {
  date: string;
  intake: number | null | undefined;
  allowance: number;
  entries: number;
  days: number;
  threshold?: number;
  sameDay?: boolean;
}): CarryDetect | null {
  const th = input.threshold ?? CARRY_THRESHOLD;
  if (input.intake == null || !Number.isFinite(Number(input.intake)) || !Number.isFinite(input.allowance)) return null;
  const delta = Math.round(Number(input.intake) - input.allowance);
  if (Math.abs(delta) <= th) return null;
  if (delta < 0) {
    if (input.sameDay) return null;
    if (!(input.entries >= CARRY_MIN_ENTRIES)) return null;
  }
  const days = clampCarryDays(input.days);
  return { date: input.date, delta, kind: delta > 0 ? 'over' : 'under', days, perDay: carryPerDay(delta, days) };
}

/** 「+1,000」「−700」の形（表示用。ハイフンではなくマイナス記号） */
export function signedKcal(n: number): string {
  const v = Math.round(n);
  return `${v < 0 ? '−' : '+'}${Math.abs(v).toLocaleString()}`;
}
