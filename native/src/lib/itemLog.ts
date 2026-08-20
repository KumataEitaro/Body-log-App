// 「何を・いつ・どれだけ食べたか」を品目単位で取り出す層。
//
// DBは1回の食事＝1レコードで、その中にitems配列を持つ。
// この形は「何を一緒に食べたか」を保てる利点があるが、分析するには
// 品目を1件ずつに開いた列が必要になる。ここがその変換を担う。
//
// 既存のbuildItemDaysは「その日に食べた品目名の集合」しか作らず、
// 時刻と栄養量を捨てていたため、時間帯の分析や量の比較ができなかった。
import { foodKey, foodBaseName } from './foodName';
import type { FoodItem } from './items';

/** 分析に使う1品目の記録。1回の食事に3品あれば3件になる */
export type ItemEntry = {
  logId: string;      // どの食事に属していたか（同じ食事の品目をたどれる）
  date: string;       // YYYY-MM-DD（JST）
  at: string | null;  // 記録時刻のISO文字列。時間帯の分析に使う
  hour: number | null;// 0-23（JST）。nullは時刻不明
  key: string;        // 照合キー（分量表記を落として正規化したもの）
  name: string;       // 表示名（分量を落としたもの）
  qty: string;        // 元の分量表記（'400g' など）
  kcal: number; p: number; f: number; c: number;
};

type LogRow = {
  id: string;
  date: string;
  at?: string | null;
  items?: FoodItem[] | null;
};

/** JSTの時刻(0-23)を取り出す。取れなければnull */
function hourJST(at: string | null | undefined): number | null {
  if (!at) return null;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  // JSTはUTC+9固定（日本のみ対象のため夏時間の考慮は不要）
  return new Date(ms + 9 * 3600_000).getUTCHours();
}

/** 食事レコードの配列を、品目1件ずつの列に開く */
export function toItemEntries(rows: LogRow[]): ItemEntry[] {
  const out: ItemEntry[] = [];
  for (const r of rows) {
    for (const it of r.items ?? []) {
      const raw = String(it?.name ?? '');
      const key = foodKey(raw);
      if (!key) continue;               // 分量だけの行など、品目として扱えないもの
      out.push({
        logId: r.id,
        date: r.date,
        at: r.at ?? null,
        hour: hourJST(r.at),
        key,
        name: foodBaseName(raw) || raw,
        qty: String(it?.qty ?? ''),
        kcal: Number(it?.kcal) || 0,
        p: Number(it?.p) || 0,
        f: Number(it?.f) || 0,
        c: Number(it?.c) || 0,
      });
    }
  }
  return out;
}

/** 品目ごとの集計。よく食べるもの順に並べるために使う */
export type ItemSummary = {
  key: string;
  name: string;
  times: number;      // 食べた回数（同じ日の複数回も数える）
  days: number;       // 食べた日数
  totalKcal: number;
  avgKcal: number;    // 1回あたり
  avgP: number; avgF: number; avgC: number;
  lastDate: string;   // 最後に食べた日
  hours: number[];    // 食べた時刻の一覧（時間帯の傾向を見るため）
};

export function summarizeItems(entries: ItemEntry[]): ItemSummary[] {
  const map = new Map<string, ItemEntry[]>();
  for (const e of entries) {
    const arr = map.get(e.key) ?? [];
    arr.push(e);
    map.set(e.key, arr);
  }

  const out: ItemSummary[] = [];
  for (const [key, list] of map) {
    const times = list.length;
    const days = new Set(list.map((x) => x.date)).size;
    const totalKcal = list.reduce((a, x) => a + x.kcal, 0);
    const sum = (f: (x: ItemEntry) => number) => list.reduce((a, x) => a + f(x), 0);
    const r1 = (n: number) => Math.round(n * 10) / 10;
    out.push({
      key,
      name: list[list.length - 1].name,   // 最後に見た表記を採用
      times, days,
      totalKcal: Math.round(totalKcal),
      avgKcal: Math.round(totalKcal / times),
      avgP: r1(sum((x) => x.p) / times),
      avgF: r1(sum((x) => x.f) / times),
      avgC: r1(sum((x) => x.c) / times),
      lastDate: list.reduce((m, x) => (x.date > m ? x.date : m), list[0].date),
      hours: list.map((x) => x.hour).filter((h): h is number => h != null),
    });
  }
  // 回数が多い順。同数なら直近に食べた方を先に
  return out.sort((a, b) => (b.times - a.times) || (a.lastDate < b.lastDate ? 1 : -1));
}

/** 時間帯の区分（朝・昼・夕・夜）。食習慣の傾向を見るための粗い分類 */
export type MealSlot = 'morning' | 'noon' | 'evening' | 'night';

export function slotOf(hour: number): MealSlot {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 16) return 'noon';
  if (hour >= 16 && hour < 21) return 'evening';
  return 'night';   // 21時〜翌4時。夜食の把握に使う
}

/** 品目が主にどの時間帯に食べられているか（最多の区分と、その割合） */
export function mainSlot(hours: number[]): { slot: MealSlot; share: number } | null {
  if (hours.length === 0) return null;
  const count = new Map<MealSlot, number>();
  for (const h of hours) {
    const s = slotOf(h);
    count.set(s, (count.get(s) ?? 0) + 1);
  }
  const [slot, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return { slot, share: n / hours.length };
}

/**
 * 食事レコードから1品目だけを取り除いた結果を組む。
 * 呼び出し側はこの結果でDBを更新する（全品を消す場合はレコードごと削除）。
 *
 * 合計値（kcal/p/f/c）は残った品目から必ず再計算する。
 * ここを引き算で済ませると、AIの推定値と合計がずれた記録で誤差が残り続ける。
 */
export type RemoveResult =
  | { kind: 'delete' }                                                   // 品目が無くなる＝レコードを消す
  | { kind: 'update'; items: FoodItem[]; kcal: number; p: number; f: number; c: number };

export function removeItemAt(items: FoodItem[], index: number): RemoveResult {
  const rest = items.filter((_, i) => i !== index);
  if (rest.length === 0) return { kind: 'delete' };
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const sum = (f: (x: FoodItem) => number) => r1(rest.reduce((a, x) => a + (Number(f(x)) || 0), 0));
  return {
    kind: 'update',
    items: rest,
    kcal: Math.round(rest.reduce((a, x) => a + (Number(x.kcal) || 0), 0)),
    p: sum((x) => x.p), f: sum((x) => x.f), c: sum((x) => x.c),
  };
}
