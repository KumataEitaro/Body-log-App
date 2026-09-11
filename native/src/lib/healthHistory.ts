// 歩数・睡眠の「過去日の詳しい記録」（feat/health-history・2026-09-10）で使う純関数。
//
// 概要タブの歩数・睡眠詳細は「今日から直近7日」しか見られず、過去日の記録を確認できなかった
// （熊田さんβFB「日付選択（食事・運動タブ）と同じUIで過去日に移動し、詳しい記録を見たい」）。
// 日付の並び・HealthKitへ渡す時間窓・見出しの文言といった「間違うと1日ズレる」規則を
// ここに閉じて jest で固定し、components/HealthDetail.tsx は表示だけを持つ。
//
// 日付文字列は 'YYYY-MM-DD'（JST）。計算は UTC の暦で行う（JSTは夏時間が無く固定オフセットなので、
// 日付だけの加減算はタイムゾーンに依存しない。lib/jst.ts と同じ考え方）。
import { t } from '@/lib/i18n';

const p2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' を n 日ずらす（負で過去）。壊れた入力はそのまま返す */
export function shiftYmd(d: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
}

/** end を末尾とする n 日ぶんの日付列（古い→新しい）。n<=0 は空 */
export function daysEndingAt(end: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftYmd(end, -i));
  return out;
}

/** 'YYYY-MM-DD' → 'M/D'（ゼロ埋めなし）。壊れた入力は空文字 */
export function mdOf(d: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${Number(m[1])}/${Number(m[2])}` : '';
}

/**
 * 睡眠ブロックの見出し。今日なら従来どおり「昨夜の睡眠」、過去日なら「{m}/{d} の睡眠」
 * （睡眠は「起きた日」に計上する流儀なので、{m}/{d} はその朝に起きた睡眠を指す）
 */
export function sleepHeading(viewDate: string, today: string): string {
  if (viewDate === today) return t('昨夜の睡眠');
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(viewDate);
  return t('{m}/{d} の睡眠', { m: m ? Number(m[1]) : 0, d: m ? Number(m[2]) : 0 });
}

/** その日を含む週の月曜（週別バランス・WeekStepsBar と同じ月曜起点） */
export function weekMondayOf(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return shiftYmd(d, -((dt.getUTCDay() + 6) % 7));
}

/**
 * HealthKit に渡す読み取り窓。endDate（'YYYY-MM-DD'・JST）を末尾とする days 日ぶん＝
 * start は (endDate − (days−1)) の 0:00 JST、end は endDate の翌日 0:00 JST（排他）。
 * endDate 省略時は呼び出し側が従来どおり「今日から」の窓（end=now）を使う。
 */
export function activityRange(days: number, endDate: string): { start: Date; end: Date } {
  const n = Math.max(1, Math.floor(days));
  const startYmd = shiftYmd(endDate, -(n - 1));
  return {
    start: new Date(`${startYmd}T00:00:00+09:00`),
    end: new Date(`${shiftYmd(endDate, 1)}T00:00:00+09:00`),
  };
}

export type DayRecord = { date: string; steps: number; sleepH: number; activeKcal: number };

/**
 * 日付列の各日に対応する記録を並べる。無い日は 0 埋め（表は必ず n 行になり、
 * 「記録が無い日」も行として見える＝過去日を辿ったときに日付が飛ばない）
 */
export function fillDays<T extends DayRecord>(records: T[], dates: string[]): DayRecord[] {
  const map = new Map(records.map((r) => [r.date, r] as const));
  return dates.map((date) => {
    const r = map.get(date);
    return r ? { date: r.date, steps: r.steps, sleepH: r.sleepH, activeKcal: r.activeKcal }
      : { date, steps: 0, sleepH: 0, activeKcal: 0 };
  });
}

/** その日に何か記録があるか（歩数・睡眠・アクティブのどれか >0） */
export function hasDayRecord(r: DayRecord | null | undefined): boolean {
  return !!r && (r.steps > 0 || r.sleepH > 0 || r.activeKcal > 0);
}
