// 過食の引き金レポート
// 「食べすぎた日」の前後に何が起きていたかを、本人のデータだけから洗い出す。
// 相関であって因果ではない点は表示側で必ず明記すること。
import { isBingeDay, type InsightDay } from './insights';

export type AnalysisDay = InsightDay & {
  weight?: number | null;   // その日の体重kg
  sleepH?: number | null;   // 睡眠時間h（ヘルスケア連携時のみ）
  exKcal?: number | null;   // その日の運動消費kcal
};

export type Trigger = {
  key: string;
  label: string;      // 見出し（例: 前日に食事を我慢しすぎた）
  detail: string;     // 補足（例: 前日が-300kcal以下だった日）
  withRate: number;   // 条件に当てはまる日の過食率(0-1)
  withoutRate: number;
  lift: number;       // withRate / withoutRate（何倍起きやすいか）
  n: number;          // 条件に当てはまった日数
  hits: number;       // うち過食した日数
};

export type AfterEffect = {
  chainRate: number | null;      // 翌日も食べすぎる割合
  logDropRate: number | null;    // 翌日に記録が途切れる割合
  weightDelta: number | null;    // 翌日の体重変化の平均kg
  recoverDays: number | null;    // 体重が過食前の水準に戻るまでの平均日数
};

export type BingeReport = {
  totalDays: number;
  bingeDays: number;
  triggers: Trigger[];          // liftの大きい順（有意なものだけ）
  after: AfterEffect;
  dowRates: { dow: number; rate: number; n: number }[]; // 0=日
  enough: boolean;              // 判断に足るデータがあるか
};

const MIN_DAYS = 21;   // これ未満は傾向を出さない
const MIN_N = 3;       // 条件該当がこれ未満の引き金は捨てる
const MIN_LIFT = 1.4;  // これ未満の差は「傾向あり」と言わない

function rate(days: AnalysisDay[], pred: (d: AnalysisDay, i: number) => boolean, all: AnalysisDay[]): { n: number; hits: number } {
  let n = 0;
  let hits = 0;
  all.forEach((d, i) => {
    if (!pred(d, i)) return;
    n += 1;
    if (isBingeDay(d)) hits += 1;
  });
  void days;
  return { n, hits };
}

/** 条件Xがある日とない日で、過食の起きやすさを比べる */
function compare(all: AnalysisDay[], key: string, label: string, detail: string,
                 pred: (d: AnalysisDay, i: number) => boolean): Trigger | null {
  const withIt = rate(all, pred, all);
  const withoutIt = rate(all, (d, i) => !pred(d, i), all);
  if (withIt.n < MIN_N || withoutIt.n < MIN_N) return null;
  const withRate = withIt.hits / withIt.n;
  const withoutRate = withoutIt.hits / withoutIt.n;
  if (withRate === 0) return null;
  // 分母0を避けつつ、比較対象が0%なら大きめの倍率として扱う
  const lift = withoutRate === 0 ? 3 : withRate / withoutRate;
  if (lift < MIN_LIFT) return null;
  return { key, label, detail, withRate, withoutRate, lift, n: withIt.n, hits: withIt.hits };
}

export function analyzeBinge(days: AnalysisDay[]): BingeReport {
  const all = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  const logged = all.filter((d) => d.intake != null);
  const bingeDays = all.filter(isBingeDay).length;
  const enough = logged.length >= MIN_DAYS && bingeDays >= 2;

  const prev = (i: number): AnalysisDay | null => (i > 0 ? all[i - 1] : null);
  const dowOf = (d: AnalysisDay) => new Date(d.date + 'T00:00:00').getDay();

  // たんぱく質の「少ない日」の基準は本人の中央値（絶対値ではなく相対で見る）
  const ps = logged.map((d) => d.p ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
  const pMedian = ps.length ? ps[Math.floor(ps.length / 2)] : 0;

  const candidates: (Trigger | null)[] = [
    compare(all, 'prev-deficit', '前日に我慢しすぎた', '前日が目標より300kcal以上少なかった日',
      (_d, i) => { const p = prev(i); return !!p && p.diff != null && p.diff <= -300; }),
    compare(all, 'prev-lowprotein', '前日のたんぱく質が少なかった', `前日のたんぱく質が${Math.round(pMedian)}g未満だった日`,
      (_d, i) => { const p = prev(i); return !!p && pMedian > 0 && p.p != null && p.p < pMedian; }),
    compare(all, 'prev-unlogged', '前日の記録が途切れていた', '前日に食事の記録がなかった日',
      (_d, i) => { const p = prev(i); return !!p && p.intake == null; }),
    compare(all, 'prev-lowmood', '前日の気分が落ちていた', '前日の気分が5段階で2以下だった日',
      (_d, i) => { const p = prev(i); return !!p && moodScore(p.mood) != null && (moodScore(p.mood) as number) <= 2; }),
    compare(all, 'low-sleep', '睡眠が短かった', '前日の睡眠が6時間未満だった日',
      (_d, i) => { const p = prev(i); return !!p && p.sleepH != null && p.sleepH < 6; }),
    compare(all, 'weekend', '週末だった', '金・土・日',
      (d) => [5, 6, 0].includes(dowOf(d))),
    compare(all, 'streak-deficit', '赤字が3日続いたあと', '前3日がすべて目標より少なかった日',
      (_d, i) => i >= 3 && [1, 2, 3].every((k) => { const p = all[i - k]; return p && p.diff != null && p.diff < 0; })),
    compare(all, 'hard-exercise', '前日に運動を頑張った', '前日の運動消費が300kcal以上だった日',
      (_d, i) => { const p = prev(i); return !!p && p.exKcal != null && p.exKcal >= 300; }),
  ];

  const triggers = candidates.filter((x): x is Trigger => x !== null).sort((a, b) => b.lift - a.lift);

  // ===== 過食の「後」に何が起きるか =====
  const bIdx: number[] = [];
  all.forEach((d, i) => { if (isBingeDay(d)) bIdx.push(i); });
  let chain = 0;
  let drop = 0;
  let nextCount = 0;
  const wDeltas: number[] = [];
  const recovers: number[] = [];
  for (const i of bIdx) {
    const next = all[i + 1];
    if (!next) continue;
    nextCount += 1;
    if (isBingeDay(next)) chain += 1;
    if (next.intake == null) drop += 1;
    if (all[i].weight != null && next.weight != null) wDeltas.push(Number(next.weight) - Number(all[i].weight));
    // 体重が過食日の水準以下に戻るまでの日数
    const base = all[i].weight;
    if (base != null) {
      for (let k = 1; k <= 7 && all[i + k]; k++) {
        const w = all[i + k].weight;
        if (w != null && Number(w) <= Number(base)) { recovers.push(k); break; }
      }
    }
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const after: AfterEffect = {
    chainRate: nextCount ? chain / nextCount : null,
    logDropRate: nextCount ? drop / nextCount : null,
    weightDelta: avg(wDeltas),
    recoverDays: avg(recovers),
  };

  // ===== 曜日別 =====
  const dowRates = [0, 1, 2, 3, 4, 5, 6].map((dow) => {
    const xs = all.filter((d) => dowOf(d) === dow);
    const hits = xs.filter(isBingeDay).length;
    return { dow, rate: xs.length ? hits / xs.length : 0, n: xs.length };
  });

  return { totalDays: logged.length, bingeDays, triggers, after, dowRates, enough };
}

/** 気分の記録（"4/5" 形式や絵文字）を1〜5の数値へ */
export function moodScore(mood?: string | null): number | null {
  if (!mood) return null;
  const m = String(mood).match(/([1-5])\s*\/\s*5/);
  if (m) return Number(m[1]);
  const faces = ['😫', '😕', '😐', '🙂', '😄'];
  for (let i = 0; i < faces.length; i++) if (String(mood).includes(faces[i])) return i + 1;
  return null;
}
