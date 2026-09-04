// 先の予定（飲み会・外食・チートデイ）を先回りで計画に織り込む。
//
// 【なぜ必要か】
// 「明日 飲み会がある」と分かっている日は、事前に少しずつ貯金しておけば当日を我慢しなくて済む。
// 計算そのものは lib/goal.ts の computePlan が既に持っている（未来の events の超過kcalを
// 目標日までに均等配分＝spread、または各イベント後N日で取り返す＝window）。
// 足りなかったのは **入口と可視化** だけだった:
//   ・登録が「概要 → 設定 → 目標設定」の奥（4タップ以上）で、当日には間に合わない
//   ・種類が「🍖 チートデイ」固定で、飲み会が無い（お酒の日は外食とも違う）
//   ・登録しても食事タブに「予定が近い」ことが一切出ない＝貯金が始まったのに気づけない
//
// このファイルは**純関数だけ**を持つ（DBにもAsyncStorageにも触れない）。
// 画面から切り離してテストできるようにするため。保存は events テーブル（date/title/extra_kcal）。
import { t } from './i18n';
import { addDays, daysBetween } from './goal';

/** 予定の種類。events.title の先頭絵文字で往復できるようにキーと絵文字を1対1にする */
export type EventKind = 'drink' | 'eatout' | 'cheat' | 'other';

export const EVENT_KINDS: readonly EventKind[] = ['drink', 'eatout', 'cheat', 'other'];

/** 種類ごとの既定の見込み超過kcal。
 *  飲み会が外食より大きいのは、アルコール自体のkcal（生ビール中1杯≒145kcal）に加えて
 *  〆や揚げ物が乗りやすく、満腹感の判断も鈍るため。控えめに見積もると当日に破綻するので、
 *  「少し多めに見ておいて、余ったら翌日が楽になる」側に倒す。 */
export const EVENT_DEFAULT_KCAL: Record<EventKind, number> = {
  drink: 900,
  eatout: 600,
  cheat: 1000,
  other: 500,
};

/** ダイアルの刻みと範囲（dayPlan.ts の EST_* と揃える） */
export const EVENT_KCAL_STEP = 100;
export const EVENT_KCAL_MIN = 100;
export const EVENT_KCAL_MAX = 3000;

export function clampEventKcal(n: number): number {
  if (!Number.isFinite(n)) return EVENT_DEFAULT_KCAL.other;
  const v = Math.round(n / EVENT_KCAL_STEP) * EVENT_KCAL_STEP;
  return Math.min(EVENT_KCAL_MAX, Math.max(EVENT_KCAL_MIN, v));
}

/** events.title に入れる絵文字。ここが種類の正本（DBに種類カラムを足さずに往復させる） */
const KIND_EMOJI: Record<EventKind, string> = {
  drink: '🍻',
  eatout: '🍽',
  cheat: '🍖',
  other: '📅',
};

export function eventKindLabel(kind: EventKind): string {
  switch (kind) {
    case 'drink': return t('飲み会');
    case 'eatout': return t('外食');
    case 'cheat': return t('チートデイ');
    default: return t('その他の予定');
  }
}

/** 保存用のタイトル（絵文字＋名前）。既存の「🍖 チートデイ」と同じ形を保つ */
export function eventTitleOf(kind: EventKind): string {
  return `${KIND_EMOJI[kind]} ${eventKindLabel(kind)}`;
}

/** 保存済みタイトルから種類を復元する。未知の絵文字・旧データは 'other' に寄せる（落とさない） */
export function eventKindOf(title: string | null | undefined): EventKind {
  const s = String(title ?? '');
  for (const k of EVENT_KINDS) {
    if (s.startsWith(KIND_EMOJI[k])) return k;
  }
  return 'other';
}

/** 日付チップの選択肢（今日・明日・明後日）。それ以外はカレンダーで選ぶ */
export function quickDates(todayISO: string): { iso: string; label: string }[] {
  return [
    { iso: todayISO, label: t('今日') },
    { iso: addDays(todayISO, 1), label: t('明日') },
    { iso: addDays(todayISO, 2), label: t('明後日') },
  ];
}

export type UpcomingEvent = { date: string; title: string; extra_kcal: number };

/**
 * 食事タブに出す「予定が近い」帯の中身。
 *
 * 出す条件を絞っているのは、帯が常設になると読まれなくなるため:
 *  ・今日を含めて `withinDays` 日以内の、いちばん近い1件だけ
 *  ・過去の予定は出さない（終わった予定の帯は何の行動にもつながらない）
 * 返り値が null なら帯を出さない。
 */
export function nextEvent(
  events: readonly UpcomingEvent[], todayISO: string, withinDays = 7,
): UpcomingEvent | null {
  const future = events
    .filter((e) => e.date >= todayISO && daysBetween(todayISO, e.date) <= withinDays)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return future[0] ?? null;
}

/**
 * 帯に出す一言。「あと何日か」と「そのために今日どうなっているか」を1行で言う。
 *
 * 当日は「今日は◯◯です」に切り替える（前日までの貯金は終わっていて、
 * 今日必要なのは我慢ではなく“予定どおり使う”ことなので、煽らない文面にする）。
 */
export function eventBandText(ev: UpcomingEvent, todayISO: string): string {
  const kind = eventKindOf(ev.title);
  const name = eventKindLabel(kind);
  const d = daysBetween(todayISO, ev.date);
  if (d <= 0) return t('今日は{name}の日です。ここまでの調整ぶんを使ってください', { name });
  if (d === 1) return t('明日は{name}。今日のぶんまで調整済みです', { name });
  return t('{d}日後に{name}。その日のぶんを少しずつ先に空けています', { d, name });
}

/**
 * 「この予定を入れると1日あたりどれだけ締まるか」の見積り（登録前のプレビュー用）。
 *
 * computePlan の spread（目標日まで均等）と window（イベント後N日で取り返す）に合わせる。
 * 目標が未設定（remainingDays が取れない）ときは null を返し、画面側は
 * 「目標を決めると、どれくらい調整が必要かも出せます」に切り替える。
 */
export function perDayAdjust(
  extraKcal: number, todayISO: string, eventISO: string,
  targetDateISO: string | null, absorbDays: number | null,
): number | null {
  const extra = Math.max(0, Math.round(extraKcal));
  if (extra <= 0) return 0;
  if (absorbDays && absorbDays > 0) {
    // window: イベントの翌日から absorbDays 日かけて取り返す
    return Math.round(extra / absorbDays);
  }
  if (!targetDateISO) return null;
  // spread: 今日から目標日までの残日数に均等配分（先回りで貯金する側）
  const remaining = daysBetween(todayISO, targetDateISO);
  if (remaining < 1) return null;
  return Math.round(extra / remaining);
}

/** プレビューの一言。null（目標未設定）のときは呼び出し側が別の文面を出す */
export function perDayAdjustText(perDay: number, absorbDays: number | null): string {
  if (perDay <= 0) return t('調整は必要ありません');
  if (absorbDays && absorbDays > 0) {
    return t('予定の翌日から{n}日かけて、1日あたり約{k}kcalずつ取り返します', { n: absorbDays, k: perDay });
  }
  return t('今日から目標日まで、1日あたり約{k}kcalずつ先に空けておきます', { k: perDay });
}
