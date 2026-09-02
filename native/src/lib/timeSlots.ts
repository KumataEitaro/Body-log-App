// 「食べた時間」の純関数群（docs/INSIGHTS-ENGINE.md §4）。
//
// ■ なぜ時刻を本人に選ばせるのか
// これまで logs.at はDBの now() 任せだった。つまり「保存した時刻」であって「食べた時刻」ではない。
// 昼に食べたものを夜まとめて記録すれば夜食に見えるし、過去日の記録は当日の操作時刻が入る
// （＝嘘の時刻）。特徴量の time_slots（8区分）も食べる時間帯の分析（朝/昼/夜）も at を読むので、
// 入力の時点で「いつ食べたか」を本人に1タップで選ばせて at に明示的に入れる。
//
// ■ 8区分（§4）
// 早朝(4–7)/朝(7–10)/午前(10–12)/昼(12–14)/午後(14–17)/夕(17–20)/夜(20–23)/深夜(23–4)。
// 既存の朝/昼/夜（lib/itemLog.ts slotOf・4区分）は「食べる時間帯」カードと法則が使っているので
// そのまま残し、こちらは特徴量用の細かい区分として別に置く（名前は同じ slotOf だがモジュールが違う）。

/** 8区分の時間帯。配列の順＝1日の流れ（深夜だけ日付をまたぐ） */
export type TimeSlot8 =
  | 'earlyMorning'   // 早朝 4–7
  | 'morning'        // 朝   7–10
  | 'forenoon'       // 午前 10–12
  | 'noon'           // 昼   12–14
  | 'afternoon'      // 午後 14–17
  | 'evening'        // 夕   17–20
  | 'night'          // 夜   20–23
  | 'lateNight';     // 深夜 23–4

export const TIME_SLOTS_8: readonly TimeSlot8[] = [
  'earlyMorning', 'morning', 'forenoon', 'noon', 'afternoon', 'evening', 'night', 'lateNight',
];

/**
 * 時(0-23)→8区分。境界は「開始を含み終了を含まない」（7時ちょうどは朝、23時ちょうどは深夜）。
 * 範囲外・非数は深夜扱いにせず 'lateNight' を返すのではなく、0–23に丸めてから判定する
 * （24は翌0時＝深夜、負数は0時＝深夜）。
 */
export function slotOf(hour: number): TimeSlot8 {
  const h = Number.isFinite(hour) ? ((Math.floor(hour) % 24) + 24) % 24 : 0;
  if (h >= 4 && h < 7) return 'earlyMorning';
  if (h >= 7 && h < 10) return 'morning';
  if (h >= 10 && h < 12) return 'forenoon';
  if (h >= 12 && h < 14) return 'noon';
  if (h >= 14 && h < 17) return 'afternoon';
  if (h >= 17 && h < 20) return 'evening';
  if (h >= 20 && h < 23) return 'night';
  return 'lateNight';   // 23–翌4
}

/** 8区分の添字（features.ts の time_slots 配列と同じ並び） */
export function slotIndexOf(hour: number): number {
  return TIME_SLOTS_8.indexOf(slotOf(hour));
}

// ===== トレイの「食べた時間」チップ =====

/** チップに並べる候補時刻（'H:mm'）。「いま」は今日を見ているときだけ別枠で出す */
export const MEAL_TIME_PRESETS: readonly string[] = ['7:00', '12:00', '15:00', '19:00', '22:00'];

/** 「いま」を表す特別値（保存時は at を送らずDBの now() に任せる＝いちばん正確） */
export const MEAL_TIME_NOW = 'now';

/** 過去日の既定。現在時刻を入れるのは嘘になるので、昼で仮置きして本人に直してもらう */
export const MEAL_TIME_PAST_DEFAULT = '12:00';

/** 時刻ピッカーの刻み（分） */
export const MEAL_TIME_STEP_MIN = 15;

/**
 * チップの選択状態から、保存に使う時刻を決める。
 *   selected=null（未操作）→ 今日なら「いま」、過去日なら 12:00
 *   selected='now' でも過去日を見ているなら 12:00（過去日に「いま」は存在しない）
 *   それ以外は選んだ 'H:mm' をそのまま
 */
export function resolveMealTime(selected: string | null, isToday: boolean): string {
  if (selected == null || selected === MEAL_TIME_NOW) {
    return isToday ? MEAL_TIME_NOW : MEAL_TIME_PAST_DEFAULT;
  }
  return selected;
}

/** 'H:mm' / 'HH:mm' → {h, m}。壊れた文字列は null */
export function parseHm(hm: string): { h: number; m: number } | null {
  const mt = /^(\d{1,2}):(\d{2})$/.exec(String(hm).trim());
  if (!mt) return null;
  const h = Number(mt[1]);
  const m = Number(mt[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

/** {h, m} → 'H:mm'（表示もこの形。7:00 のように時は0埋めしない・分は2桁） */
export function fmtHm(h: number, m: number): string {
  return `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * 表示中の日付（YYYY-MM-DD・JST）と選んだ時刻（'H:mm'）から logs.at を組む。
 * 日本のみ対象なので JST=UTC+9 固定（夏時間なし）。戻りはUTCのISO文字列
 * （timestamptz にそのまま入る）。時刻が壊れていれば null（呼び出し側は DB now() に任せる）
 */
export function buildAtJST(date: string, hm: string): string | null {
  const t = parseHm(hm);
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}:00+09:00`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/** ISO時刻 → JSTの 'H:mm'（「書き換える」で元の記録の時刻を既定にするため）。壊れていれば null */
export function hmJST(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms + 9 * 3600_000);
  return fmtHm(d.getUTCHours(), d.getUTCMinutes());
}

/** 分を step 刻みに丸める（ピッカーの初期値用。59分→60分は繰り上げて次の時へ） */
export function roundHm(h: number, m: number, step = MEAL_TIME_STEP_MIN): { h: number; m: number } {
  const total = Math.round((h * 60 + m) / step) * step;
  const wrapped = ((total % 1440) + 1440) % 1440;
  return { h: Math.floor(wrapped / 60), m: wrapped % 60 };
}
