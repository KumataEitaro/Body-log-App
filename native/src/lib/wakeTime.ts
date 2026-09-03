// 起床時刻（設定 > 通知の先頭）と「朝の窓」の判定。純関数＋端末保存。
//
// ■ なにを解決するか（熊田さんの指摘・2026-09-04）
// 「深夜に、翌日に聞くべき気分や過食アラートが出る。朝起きた時にしたい。時間をコントロールしたい。
//   食事入力も同じ。生活リズムは人によって違うから」
// 0:30 にアプリを開くと、JSTの日付はすでに次の日なので「新しい日の朝のカード」
// （気分・気づきアラート・今日の予定ヒアリング）が出る。本人の体感ではまだ「昨日の夜」なので、
// 答える気になれないうえ、朝に見たいものを深夜に使い切ってしまう（1日1回のものが多い）。
//
// ■ なぜ「1日の区切り」ではなく「窓」で解くのか（ここが肝・触る前に読むこと）
// 素直な解き方は「論理的な今日」を 4:00 起点にすること。しかしそれは `todayJST()` の意味を変える。
// todayJST() は23ファイルから呼ばれ、`logs.date` / `entries.date` の列そのもの・ストリーク・
// 週集計・特徴量の日付キー・AsyncStorage のキー名（`bl-day-plan:<date>` など）に直結している。
// 意味を変えると**すでに保存されたデータの解釈が変わる**（＝過去の記録が別の日に移る）。
// 提出直前に踏む橋ではないので、今回は
//   ① 朝に出すものの「時間の窓」を本人が決められるようにする（このファイル）
//   ② 深夜の食事記録に「前日として記録」の逃げ道を作る（`previousDayTarget`）
// の2つだけをやる。区切り自体をユーザー設定にする話は docs/TODO.md B9 に起票してある。
//
// ■ 窓の考え方
//  ・起床時刻 `wake` から `spanHours`（既定5時間）を「朝」とする（`isMorningWindow`）
//  ・起床時刻より前で、かつ朝の窓の中でもない時間帯は「本人の体感ではまだ前日の続き」（`beforeWake`）。
//    ここでは朝のものを出さない
//  ・夜勤の人（起床23:00 など）でも壊れないよう、判定は必ず**日付を跨ぐ形**で書く
//    （23:00 起床なら朝の窓は 23:00〜翌4:00）
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** 端末保存のキー（値は 'HH:mm'・ゼロ埋め） */
export const WAKE_TIME_KEY = 'bl-wake-time';

/** 既定の起床時刻。日本の平均起床時刻に近く、従来の朝の通知（8:00）より前に置ける */
export const WAKE_TIME_DEFAULT = '07:00';

/** 「朝」とみなす長さ（時間）。起床から5時間＝7:00起床なら 7:00〜12:00 */
export const MORNING_SPAN_HOURS = 5;

/** 設定ピッカーの刻み（分） */
export const WAKE_STEP_MIN = 15;

/**
 * 記録リマインダーの既定時刻の算出に使うオフセット（時間）。
 * 起床から14時間後＝寝る少し前。既定7:00なら21:00で、従来の既定値とちょうど一致する
 * （＝この変更で既存ユーザーの既定は動かない）
 */
export const REMINDER_OFFSET_HOURS = 14;

/** 時刻（時0-23・分0-59） */
export type Hm = { h: number; m: number };

const MIN_PER_DAY = 24 * 60;

/** 既定値の {h,m}（parse 済み・不正値のフォールバック先） */
export const WAKE_DEFAULT_HM: Hm = { h: 7, m: 0 };

/**
 * 'HH:mm' / 'H:mm' → {h,m}。壊れた値・範囲外は null。
 * null を返すのは「静かに間違った時刻で判定する」より安全だから（呼び出し側で既定へ寄せる）
 */
export function parseWakeTime(s: string | null | undefined): Hm | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(mi)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, m: mi };
}

/** {h,m} → 'HH:mm'（保存・表示の正規形。時もゼロ埋めする＝文字列比較で並ぶ） */
export function fmtWakeTime(hm: Hm): string {
  return `${String(hm.h).padStart(2, '0')}:${String(hm.m).padStart(2, '0')}`;
}

/** 壊れた値を既定へ寄せた {h,m}（設定の読み出し口で使う） */
export function wakeOrDefault(s: string | null | undefined): Hm {
  return parseWakeTime(s) ?? WAKE_DEFAULT_HM;
}

/** {h,m} → その日の0時からの分。壊れた値は既定として扱わず NaN にせず 0 に丸める（判定を止めないため） */
function minutesOf(hm: Hm | null | undefined): number {
  if (!hm || !Number.isFinite(hm.h) || !Number.isFinite(hm.m)) return 0;
  const v = Math.round(hm.h) * 60 + Math.round(hm.m);
  return ((v % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
}

/**
 * 起床から経過した分（0〜1439）。**日付を跨いでも正しい**のがこの関数の仕事。
 * 例: 起床23:00・いま1:00 → 120分（2時間前に起きた）
 */
export function minutesSinceWake(nowHm: Hm, wake: Hm): number {
  const d = minutesOf(nowHm) - minutesOf(wake);
  return ((d % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
}

/** 次の起床時刻までの分（0〜1439）。ちょうど起床時刻なら0 */
export function minutesToWake(nowHm: Hm, wake: Hm): number {
  const d = minutesOf(wake) - minutesOf(nowHm);
  return ((d % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
}

/**
 * 「朝」の時間帯か（起床時刻から spanHours の間）。
 * 起床23:00・span5 なら 23:00〜翌4:00 が朝。境界は **[wake, wake+span)**（開始は含む・終端は含まない）
 */
export function isMorningWindow(nowHm: Hm, wake: Hm, spanHours = MORNING_SPAN_HOURS): boolean {
  const span = Math.max(0, Math.min(24, Number.isFinite(spanHours) ? spanHours : MORNING_SPAN_HOURS)) * 60;
  if (span <= 0) return false;
  if (span >= MIN_PER_DAY) return true;
  return minutesSinceWake(nowHm, wake) < span;
}

/**
 * 起床時刻より前＝**本人の体感ではまだ前日の続き**か。true の間は「朝に出すもの」を出さない。
 *
 * 定義は「暦の上で起床時刻より前」かつ「朝の窓の中でもない」。
 * 2つ目の条件が必要なのは夜勤の人のため: 起床23:00 の人にとって 1:00 は起床2時間後＝朝であって
 * 「まだ前日」ではない。暦の分数だけで比べると 1:00 < 23:00 で前日扱いになり、朝のカードが
 * 1日のほぼ全部で消える（＝機能が死ぬ）。朝の窓を先に見ることでそれを防ぐ。
 */
export function beforeWake(nowHm: Hm, wake: Hm, spanHours = MORNING_SPAN_HOURS): boolean {
  if (isMorningWindow(nowHm, wake, spanHours)) return false;
  return minutesOf(nowHm) < minutesOf(wake);
}

/** 朝の窓の終わり（表示用の 'HH:mm'）。設定のサブ文言や docs の説明に使う */
export function morningEndHm(wake: Hm, spanHours = MORNING_SPAN_HOURS): string {
  const end = (minutesOf(wake) + Math.round(spanHours * 60)) % MIN_PER_DAY;
  return fmtWakeTime({ h: Math.floor(end / 60), m: end % 60 });
}

/**
 * 記録リマインダーの**既定**時刻（時のみ）。起床＋14時間＝寝る少し前。
 * すでに本人が選んだ時刻がある場合はそちらが優先（この関数は未選択時にしか使わない）＝
 * 「本人の選択を上書きしない」
 */
export function defaultReminderHour(wake: Hm): number {
  const h = (Math.round(wake.h) + REMINDER_OFFSET_HOURS) % 24;
  return ((h % 24) + 24) % 24;
}

// ===== 深夜の食事記録を「前日」に寄せる（②） =====

/** 'YYYY-MM-DD' の前日。壊れた入力は null（呼び出し側は「前日として記録」を出さない） */
export function shiftIsoDate(dateISO: string, days: number): string | null {
  if (typeof dateISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  const ms = Date.parse(`${dateISO}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms + days * 86400000);
  if (!Number.isFinite(d.getTime())) return null;
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 深夜の食事を「前日として記録」できるか。できるなら**保存先の日付**（前日の 'YYYY-MM-DD'）、
 * できないなら null。
 *
 * 出す条件は `beforeWake` が true のときだけ（0:30 に食べたラーメンは本人の感覚では「昨日の夜食」）。
 * **既定は今日のまま**にしてあり、この関数は「チップを出してよいか」と「押したときの行き先」を
 * 答えるだけ。勝手に前日へ寄せない理由は、日付の意味をアプリが勝手に決めないため
 * （区切りを動かさないという今回の線引きと同じ理由）。
 *
 * @param viewDate 表示中の日付（'YYYY-MM-DD'）。今日以外を見ているときは出さない
 * @param nowHm    いまの時刻
 * @param wake     起床時刻
 * @param todayISO 「今日」（既定は viewDate と同じ扱い＝呼び出し側が今日を渡す）
 */
export function previousDayTarget(viewDate: string, nowHm: Hm, wake: Hm, todayISO = viewDate): string | null {
  if (viewDate !== todayISO) return null;              // 過去日を編集中に「前日として」は意味が二重になる
  if (!beforeWake(nowHm, wake)) return null;           // 深夜（起床前）だけの逃げ道
  return shiftIsoDate(viewDate, -1);
}

// ===== 端末保存（AsyncStorage）と購読 =====
// 設定を変えた瞬間に食事タブのカード判定へ反映させたいので、purpose.ts と同じ作法で
// モジュールスコープに1つ持ち、useSyncExternalStore で配る。
// 起床時刻は「本人が決めた生活リズム」なので端末内だけに置く（DBへは送らない＝AIにも渡らない）。

let current = WAKE_TIME_DEFAULT;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** 起動時に1回読む（_layout.tsx の safeBoot から）。壊れた値なら既定のまま */
export async function loadWakeTime(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(WAKE_TIME_KEY);
    const p = parseWakeTime(v);
    if (p) { current = fmtWakeTime(p); emit(); }
  } catch { /* 既定（7:00）のまま。窓が既定で動くだけなので機能は止まらない */ }
}

/** 起床時刻を保存して即座に画面へ反映する。不正値は既定へ寄せる */
export function setWakeTime(hm: Hm | string): void {
  const p = typeof hm === 'string' ? parseWakeTime(hm) : parseWakeTime(fmtWakeTime(hm));
  const next = fmtWakeTime(p ?? WAKE_DEFAULT_HM);
  if (next === current) return;
  current = next;
  emit();
  AsyncStorage.setItem(WAKE_TIME_KEY, next).catch(() => { /* 端末保存の失敗は次回起動で既定に戻るだけ */ });
}

/** いまの起床時刻（'HH:mm'）。同期で読める＝レンダー中の判定に使える */
export function getWakeTime(): string { return current; }

/** いまの起床時刻（{h,m}） */
export function getWakeHm(): Hm { return wakeOrDefault(current); }

/** 起床時刻の購読（'HH:mm'）。設定を変えた瞬間にカードの出し分けが変わる */
export function useWakeTime(): string {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    getWakeTime,
    getWakeTime,
  );
}

/**
 * 端末保存を直接読む（通知の予約など、ストアが読み込まれる前に走る経路のため）。
 * 画面からは useWakeTime() を使うこと
 */
export async function readWakeHm(): Promise<Hm> {
  try { return wakeOrDefault(await AsyncStorage.getItem(WAKE_TIME_KEY)); } catch { return WAKE_DEFAULT_HM; }
}
