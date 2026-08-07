// 個人データからの傾向分析エンジン。
// ① 過食リスクの事前検知: 行動科学の既知パターン（連続赤字→反動過食など）を土台に、
//    本人の過去データが貯まるほど個人統計（曜日癖・赤字耐性）が効いてくるルールベース設計。
//    ※数週間のデータでの機械学習は当てにならないため、v1は「理由を言葉で説明できる」判定に徹する。
// ② 食材×体の反応: 品目DB（logs.items）と体重系列から「食べた翌日の体重変化」の傾向を食材別に集計。
//    相関であって因果ではないため、n数と差分を必ず添えて提示する。

import { detectStruggle } from '@/lib/adaptive';

// ===== 日次特徴量 =====

export type InsightDay = {
  date: string;              // YYYY-MM-DD 昇順
  intake: number | null;     // 摂取kcal（未記録はnull）
  p: number | null;          // たんぱく質g
  diff: number | null;       // 摂取−目安（+超過/−赤字）
  mood?: string | null;
  text?: string | null;
};

export const BINGE_OVER_KCAL = 400;   // これ以上の超過は「食べ過ぎ日」とみなす
export const DEFICIT_KCAL = -300;     // これ以下は「大きめの赤字日」

export function isBingeDay(d: InsightDay): boolean {
  if (d.diff != null && d.diff >= BINGE_OVER_KCAL) return true;
  return detectStruggle([d.mood, d.text]) === 'binge';
}

// 末尾（＝直近）から続く「大きめ赤字」の連続日数。未記録日は不明なので打ち切る
export function deficitStreak(days: InsightDay[]): number {
  let n = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d.diff == null || d.diff > DEFICIT_KCAL) break;
    n++;
  }
  return n;
}

// 過去の食べ過ぎ日それぞれの「直前の連続赤字日数」（個人の赤字耐性の推定に使う）
export function preBingeStreaks(days: InsightDay[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < days.length; i++) {
    if (!isBingeDay(days[i])) continue;
    out.push(deficitStreak(days.slice(0, i)));
  }
  return out;
}

// ===== 過食リスクの判定 =====

export type RiskReason = { key: string; text: string };
export type BingeRisk = { level: 'low' | 'elevated' | 'high'; score: number; reasons: RiskReason[] };

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 今日の過食リスクを判定する。
 * @param days 昨日までの日次データ（昇順・直近3〜4週間ぶんを想定）
 * @param todayDow 今日の曜日 (0=日)
 */
export function assessBingeRisk(days: InsightDay[], todayDow: number): BingeRisk {
  const reasons: RiskReason[] = [];
  let score = 0;
  if (days.length === 0) return { level: 'low', score: 0, reasons };

  // R1: 連続赤字（我慢の蓄積は反動過食の最大の予兆）
  const streak = deficitStreak(days);
  if (streak >= 3) {
    score += 2;
    reasons.push({ key: 'streak', text: `${streak}日連続で大きめの赤字（−300kcal超）が続いています` });
    const pre = preBingeStreaks(days).filter((n) => n > 0);
    if (pre.length >= 2) {
      const avg = Math.round((pre.reduce((a, b) => a + b, 0) / pre.length) * 10) / 10;
      if (streak >= avg) {
        score += 1;
        reasons.push({ key: 'personal-streak', text: `あなたの過去の食べ過ぎは、平均${avg}日連続赤字の後に起きています` });
      }
    }
  }

  // R2: 昨日の赤字が特に大きい
  const y = days[days.length - 1];
  if (y?.diff != null && y.diff <= -600) {
    score += 1;
    reasons.push({ key: 'big-deficit', text: `昨日は特に大きな赤字（−${Math.abs(Math.round(y.diff)).toLocaleString()}kcal）でした` });
  }

  // R3: たんぱく質不足が2日以上（満腹感が持続しにくく食欲が乱れやすい）
  const last2 = days.slice(-2);
  const lowP = last2.filter((d) => d.intake != null && d.intake > 0 && d.p != null && (d.p * 4) / d.intake < 0.15);
  if (last2.length === 2 && lowP.length === 2) {
    score += 1;
    reasons.push({ key: 'low-protein', text: 'たんぱく質が2日続けて不足気味です（食欲が乱れやすい状態）' });
  }

  // R4: 曜日の癖（個人統計。食べ過ぎが3回以上あり、半分以上が今日と同じ曜日）
  const binges = days.filter(isBingeDay);
  if (binges.length >= 3) {
    const sameDow = binges.filter((d) => new Date(d.date + 'T00:00:00').getDay() === todayDow).length;
    const share = sameDow / binges.length;
    if (share >= 0.5) {
      score += 2;
      reasons.push({ key: 'dow', text: `過去の食べ過ぎの${Math.round(share * 100)}%が${DOW_JA[todayDow]}曜日に起きています` });
    }
  }

  // R5: 昨日「つらい」サイン（ストレスは過食の直接トリガー）
  if (y && detectStruggle([y.mood, y.text]) === 'hard') {
    score += 2;
    reasons.push({ key: 'stress', text: '昨日「つらい」のサインがありました' });
  }

  const level = score >= 4 ? 'high' : score >= 2 ? 'elevated' : 'low';
  return { level, score, reasons };
}

// ===== 食材×翌日体重の関連分析 =====

export type ItemDay = { date: string; names: string[] };       // その日に食べた品目名（重複なし）
export type WeightPoint = { date: string; weight: number };
export type FoodEffect = {
  name: string;
  withN: number;      // 食べた日のうち体重差が取れた日数
  withoutN: number;   // 食べなかった日（記録日）のうち体重差が取れた日数
  withAvg: number;    // 食べた翌日の平均体重変化 kg
  withoutAvg: number; // 食べなかった翌日の平均体重変化 kg
  effect: number;     // withAvg − withoutAvg（負=食べた翌日の方が下がりやすい）
};

export function normalizeItemName(s: string): string {
  return String(s ?? '').normalize('NFKC').trim().replace(/\s+/g, '');
}

function nextDate(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// logsの生データ（date×items）を日単位にまとめる
export function buildItemDays(rows: { date: string; items?: { name?: string }[] | null }[]): ItemDay[] {
  const byDate = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const it of r.items || []) {
      const n = normalizeItemName(it?.name || '');
      if (n.length < 2) continue;
      if (!byDate.has(r.date)) byDate.set(r.date, new Set());
      byDate.get(r.date)!.add(n);
    }
  }
  return [...byDate.entries()].map(([date, names]) => ({ date, names: [...names] })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * 食材ごとに「食べた翌日の体重変化」と「食べなかった翌日の体重変化」を比べる。
 * 統計的に弱い項目はn数の下限で除外する（withN>=4 かつ withoutN>=6 かつ 食べた日>=5）。
 */
export function foodWeightEffects(itemDays: ItemDay[], weights: WeightPoint[]): FoodEffect[] {
  const wMap = new Map(weights.map((w) => [w.date, w.weight]));
  // 体重差が計算できる記録日: その日と翌日の両方に体重がある
  const deltas = new Map<string, number>(); // date -> 翌日への変化kg
  for (const d of itemDays) {
    const w0 = wMap.get(d.date);
    const w1 = wMap.get(nextDate(d.date));
    if (w0 != null && w1 != null) deltas.set(d.date, Math.round((w1 - w0) * 1000) / 1000);
  }
  if (deltas.size < 10) return []; // データ不足時は何も主張しない

  // 品目の出現日数
  const eatenDays = new Map<string, string[]>();
  for (const d of itemDays) {
    for (const n of d.names) {
      if (!eatenDays.has(n)) eatenDays.set(n, []);
      eatenDays.get(n)!.push(d.date);
    }
  }

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const out: FoodEffect[] = [];
  for (const [name, dates] of eatenDays) {
    if (dates.length < 5) continue; // 5日以上食べた品目のみ
    const dateSet = new Set(dates);
    const withD: number[] = [];
    const withoutD: number[] = [];
    for (const [d, delta] of deltas) {
      if (dateSet.has(d)) withD.push(delta);
      else withoutD.push(delta);
    }
    if (withD.length < 4 || withoutD.length < 6) continue;
    const withAvg = Math.round(avg(withD) * 1000) / 1000;
    const withoutAvg = Math.round(avg(withoutD) * 1000) / 1000;
    out.push({
      name, withN: withD.length, withoutN: withoutD.length,
      withAvg, withoutAvg,
      effect: Math.round((withAvg - withoutAvg) * 1000) / 1000,
    });
  }
  return out.sort((a, b) => a.effect - b.effect); // 下がりやすい順
}
