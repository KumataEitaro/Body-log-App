// よく食べる食品を検出して「マイ食品に登録しませんか？」と案内するための記録と判定。
//
// 保存するのは端末内（AsyncStorage）だけ。APIも追加のDB書き込みも発生しない。
// 端末を変えるとカウントは引き継がれないが、提案が遅れるだけで害はないため許容する。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { foodKey, foodBaseName, foodPortion } from './foodName';
import type { FoodItem } from './items';

const SEEN_KEY = 'bl-food-seen';
const DECLINED_KEY = 'bl-food-suggest-declined';
const SHOWN_KEY = 'bl-food-suggest-shown';

const KEEP_DAYS = 14;      // 出現履歴を保持する日数
const WINDOW_DAYS = 7;     // 判定に使う直近の日数
// 何日ぶん出たら提案するか（同じ日の複数回は1回）。
// 3日だと体感が遅すぎた（βフィードバック: 出ない、と言われる）ので2日へ。
// 誤検知しても「あとで」で二度と出ない＋登録済みは除外なので、緩めのコストは低い
const NEED_DAYS = 2;

/** 分量ごとの実績値。最頻の分量を代表値に選ぶために持つ */
type PortionStat = { portion: string; n: number; kcal: number; p: number; f: number; c: number };

export type SeenEntry = {
  name: string;              // 表示用の名前（分量を落としたもの）
  dates: string[];           // 出現した日付（重複なし・新しい順）
  portions: PortionStat[];   // 分量ごとの回数と栄養値
};

export type Seen = Record<string, SeenEntry>;

export type Suggestion = {
  key: string;
  name: string;
  portion: string;   // 登録フォームの「単位」の初期値
  days: number;      // 直近WINDOW_DAYS日のうち何日ぶん出たか
  kcal: number; p: number; f: number; c: number;
};

function daysAgo(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

/** 分量ごとの統計へ1回分を足す */
function addPortion(list: PortionStat[], it: FoodItem): PortionStat[] {
  const portion = foodPortion(it.name) ?? '';
  const kcal = Number(it.kcal) || 0;
  const p = Number(it.p) || 0;
  const f = Number(it.f) || 0;
  const c = Number(it.c) || 0;
  const hit = list.find((x) => x.portion === portion);
  if (hit) {
    // 同じ分量なら回数を増やし、栄養値は最新で上書き（AIの推定が改善されることがある）
    hit.n += 1; hit.kcal = kcal; hit.p = p; hit.f = f; hit.c = c;
    return list;
  }
  return [...list, { portion, n: 1, kcal, p, f, c }];
}

/**
 * 保存した品目を出現表へ記録する。
 * 同じ日に何回食べても1日ぶんとして数える（朝昼晩の3回で誤検知しないため）。
 */
export async function recordItems(items: FoodItem[], date: string): Promise<void> {
  if (!items || items.length === 0) return;
  const seen = await readJson<Seen>(SEEN_KEY, {});

  for (const it of items) {
    const key = foodKey(it.name);
    if (!key) continue;                       // 分量だけの行など
    const name = foodBaseName(it.name);
    if (!name) continue;

    const cur: SeenEntry = seen[key] ?? { name, dates: [], portions: [] };
    cur.name = name;                          // 最後に見た形で更新
    if (!cur.dates.includes(date)) cur.dates = [date, ...cur.dates];
    cur.dates = cur.dates
      .filter((d) => daysAgo(d, date) <= KEEP_DAYS)   // 古い日付は捨てる
      .slice(0, KEEP_DAYS);
    cur.portions = addPortion(cur.portions, it);
    seen[key] = cur;
  }

  try { await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* 提案が遅れるだけ */ }
}

/** 最頻の分量（同数なら回数が多い方＝先に見つかった方）を代表値にする */
function representative(e: SeenEntry): PortionStat | null {
  if (e.portions.length === 0) return null;
  return [...e.portions].sort((a, b) => b.n - a.n)[0];
}

/** 直近WINDOW_DAYS日のうち、何日ぶん出たか */
export function daysInWindow(e: SeenEntry, today: string): number {
  return e.dates.filter((d) => {
    const gap = daysAgo(d, today);
    return gap >= 0 && gap < WINDOW_DAYS;
  }).length;
}

/**
 * 案内を出すべき1件を返す。条件を満たすものが無ければnull。
 * existingNames はすでにマイ食品にある名前（同名の登録は制約違反になるため除外する）。
 */
export async function pickSuggestion(existingNames: string[], today: string): Promise<Suggestion | null> {
  const shownOn = await readJson<string | null>(SHOWN_KEY, null);
  if (shownOn === today) return null;               // 1日1件まで

  const [seen, declined] = await Promise.all([
    readJson<Seen>(SEEN_KEY, {}),
    readJson<string[]>(DECLINED_KEY, []),
  ]);

  const taken = new Set(existingNames.map((n) => foodKey(n)));
  const cands: Suggestion[] = [];

  for (const [key, e] of Object.entries(seen)) {
    if (declined.includes(key)) continue;           // 一度断られたら出さない
    if (taken.has(key)) continue;                   // すでに登録済み
    const days = daysInWindow(e, today);
    if (days < NEED_DAYS) continue;
    const rep = representative(e);
    if (!rep || rep.kcal <= 0) continue;            // 栄養値が無いと自動入力できない
    cands.push({
      key, name: e.name, portion: rep.portion,
      days, kcal: rep.kcal, p: rep.p, f: rep.f, c: rep.c,
    });
  }

  if (cands.length === 0) return null;
  // 出現日数がいちばん多いもの。同数なら直近に食べた方
  cands.sort((a, b) => {
    if (b.days !== a.days) return b.days - a.days;
    const la = seen[a.key].dates[0] ?? '';
    const lb = seen[b.key].dates[0] ?? '';
    return lb.localeCompare(la);
  });
  return cands[0];
}

/** 案内を出したことを記録する（1日1件の制御） */
export async function markShown(today: string): Promise<void> {
  try { await AsyncStorage.setItem(SHOWN_KEY, JSON.stringify(today)); } catch { /* 無視 */ }
}

/** 「あとで」を選ばれた食品を覚える（二度と勧めない） */
export async function markDeclined(key: string): Promise<void> {
  const list = await readJson<string[]>(DECLINED_KEY, []);
  if (list.includes(key)) return;
  try { await AsyncStorage.setItem(DECLINED_KEY, JSON.stringify([...list, key])); } catch { /* 無視 */ }
}

// ===== テスト用（純粋な判定部分を状態なしで検証できるようにする） =====
export const _internal = { representative, daysInWindow, NEED_DAYS, WINDOW_DAYS, KEEP_DAYS };
