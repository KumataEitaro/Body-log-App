// 筋トレ記録を「日ごと」に扱うための層。
//
// 食事と同じ考え方にそろえている：
//   1回の記録（logs 1行）は「まとまり」として残したまま、中の種目を個別に足し引きできる。
//   食事の items[] に相当するのが、記録テキスト内の「ベンチプレス 80kg×8×3」の並び。
//
// 記録は logs.text に `🏋️ ベンチプレス 80kg×8×3、スクワット 100kg×5×3` の形で入っている。
// itemsカラムを使わずテキストなのは既存データがこの形で、RM換算もこれを読んでいるため。
// 1種目だけ消す・書き換えるにはテキストを組み直す必要があるので、その解析と再構築をここに置く。
//
// 【自重種目】懸垂やディップスは入力するkgが「加重」なので、実負荷は体重＋加重になる。
// 記録テキストでは加重を `+10kg`、加重なしを `自重` と書いて区別する。
// 昔の記録（`懸垂 10kg×8×3`）も加重の意味なので、実負荷の計算では同じに扱う。
import { bwRatioOf } from './lifts';

/**
 * 重量の書き方。
 *  abs  … その重量そのものが負荷（ベンチプレス 80kg）
 *  plus … 自重に足した加重（懸垂 +10kg）
 *  bw   … 加重なしの自重のみ（懸垂 自重）
 */
export type LiftMode = 'abs' | 'plus' | 'bw';

export type LiftEntry = {
  name: string;
  kg: number;     // absなら負荷そのもの、plusなら加重、bwなら0
  reps: number;
  sets: number;   // 省略時は1
  mode: LiftMode;
};

export type LiftRecord = { id: string; date: string; text: string };

export const LIFT_PREFIX = '🏋️ ';
const BW_WORD = '自重';

/** 記録テキストを種目ごとに分解する。読めない断片は落として、記録全体は捨てない */
export function parseLiftText(text: string): LiftEntry[] {
  const body = text.replace(/^🏋️\s*/, '');
  const out: LiftEntry[] = [];
  for (const part of body.split('、')) {
    // 「種目名 80kg×8×3」「種目名 +10kg×8×3」「種目名 自重×8×3」
    const m = part.trim().match(/^(.+?)\s+(?:自重|(\+)?([\d.]+)kg)(?:×(\d+))?(?:×(\d+))?$/);
    if (!m) continue;
    const isBw = m[3] === undefined;
    const kg = isBw ? 0 : Number(m[3]);
    if (!isBw && !(kg > 0)) continue;
    out.push({
      name: m[1].trim(),
      kg,
      reps: m[4] ? Number(m[4]) : 1,
      sets: m[5] ? Number(m[5]) : 1,
      mode: isBw ? 'bw' : m[2] ? 'plus' : 'abs',
    });
  }
  return out;
}

/**
 * 重量×回数×セットの表示（種目名を除いた部分）。
 * @param bwWord 「自重」の訳語。省略すると日本語のまま返す。
 *   DBに書く文字列は日本語固定でなければならない（訳語を保存すると解析が壊れる）ので、
 *   訳すのは画面に出すときだけ。既定値を日本語にしているのはそのため。
 */
export function liftSetLabel(e: LiftEntry, bwWord: string = BW_WORD): string {
  const w = e.mode === 'bw' ? bwWord : e.mode === 'plus' ? `+${e.kg}kg` : `${e.kg}kg`;
  return `${w}×${e.reps}${e.sets > 1 ? `×${e.sets}` : ''}`;
}

/** 1種目を保存形式の文字列にする（保存時と同じ表記にそろえる） */
export function liftPart(e: LiftEntry): string {
  return `${e.name} ${liftSetLabel(e)}`;
}

/** 種目の並びから記録テキストを組み直す。空なら空文字（＝記録を消す合図） */
export function liftTextFrom(entries: LiftEntry[]): string {
  const parts = entries
    .filter((e) => e.name.trim() && e.reps > 0 && (e.mode === 'bw' || e.kg > 0))
    .map(liftPart);
  return parts.length > 0 ? LIFT_PREFIX + parts.join('、') : '';
}

/**
 * 記録から1種目だけ取り除く。
 * 食事の removeItemAt と同じ考え方で、最後の1件を消したら記録そのものを消す。
 */
export function removeLiftAt(entries: LiftEntry[], index: number):
  { kind: 'delete' } | { kind: 'update'; text: string } {
  const rest = entries.filter((_, i) => i !== index);
  const text = liftTextFrom(rest);
  return text ? { kind: 'update', text } : { kind: 'delete' };
}

/**
 * 実際にかかった負荷(kg)。
 * 懸垂のような自重種目は「体重×係数 + 加重」。体重が分からないときは加重だけを返す。
 * 昔の `懸垂 10kg` も加重の意味なので abs/plus の区別なく体重を足す。
 */
export function effectiveKg(e: LiftEntry, bodyWeight?: number | null): number {
  const ratio = bwRatioOf(e.name);
  if (ratio > 0 && bodyWeight && bodyWeight > 0) {
    return Math.round((bodyWeight * ratio + e.kg) * 10) / 10;
  }
  return e.kg;
}

/** その種目の総挙上量（実負荷×回×セット）。日ごとの手応えを1つの数字で見せるため */
export function volumeOf(e: LiftEntry, bodyWeight?: number | null): number {
  return effectiveKg(e, bodyWeight) * e.reps * e.sets;
}

export type LiftDay = {
  date: string;
  records: { id: string; text: string; entries: LiftEntry[] }[];
  lifts: number;      // その日の種目数（同じ種目は1つと数える）
  sets: number;       // 総セット数
  volume: number;     // 総挙上量kg（自重種目はその日の体重で換算）
};

/**
 * 記録を日ごとにまとめる。並びは新しい日が先（履歴は直近から見るもの）。
 * @param weightAt 日付からその日の体重を引く関数。自重種目の負荷は体重で変わるので、
 *                 今日の体重で過去を計算しないように日付ごとに引く。
 */
export function groupLiftsByDay(rows: LiftRecord[], weightAt?: (date: string) => number | null): LiftDay[] {
  const byDate = new Map<string, LiftDay>();
  for (const r of rows) {
    const entries = parseLiftText(r.text);
    let d = byDate.get(r.date);
    if (!d) { d = { date: r.date, records: [], lifts: 0, sets: 0, volume: 0 }; byDate.set(r.date, d); }
    d.records.push({ id: r.id, text: r.text, entries });
  }
  for (const d of byDate.values()) {
    const w = weightAt ? weightAt(d.date) : null;
    const names = new Set<string>();
    for (const rec of d.records) {
      for (const e of rec.entries) {
        names.add(e.name);
        d.sets += e.sets;
        d.volume += volumeOf(e, w);
      }
    }
    d.lifts = names.size;
    d.volume = Math.round(d.volume);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * 日付から「その日以前の直近の体重」を引く関数を作る。
 * 毎日測る人ばかりではないので、記録がない日は直前の記録で埋める。
 */
export function weightLookup(rows: { date: string; weight: number | null }[]): (date: string) => number | null {
  const sorted = rows
    .filter((r) => r.weight != null && Number(r.weight) > 0)
    .map((r) => ({ date: r.date, w: Number(r.weight) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return (date: string) => {
    let found: number | null = null;
    for (const r of sorted) {
      if (r.date <= date) found = r.w;
      else break;
    }
    // その日より前の記録がなければ、いちばん古い記録で代用する（0にはしない）
    return found ?? (sorted.length > 0 ? sorted[0].w : null);
  };
}
