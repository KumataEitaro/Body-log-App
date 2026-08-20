// 筋トレ記録を「日ごと」に扱うための層。
//
// 食事と同じ考え方にそろえている：
//   1回の記録（logs 1行）は「まとまり」として残したまま、中の種目を個別に足し引きできる。
//   食事の items[] に相当するのが、記録テキスト内の「ベンチプレス 80kg×8×3」の並び。
//
// 記録は logs.text に `🏋️ ベンチプレス 80kg×8×3、スクワット 100kg×5×3` の形で入っている。
// itemsカラムを使わずテキストなのは既存データがこの形で、RM換算もこれを読んでいるため。
// 1種目だけ消す・書き換えるにはテキストを組み直す必要があるので、その解析と再構築をここに置く。

export type LiftEntry = {
  name: string;
  kg: number;
  reps: number;
  sets: number;   // 省略時は1
};

export type LiftRecord = { id: string; date: string; text: string };

export const LIFT_PREFIX = '🏋️ ';

/** 記録テキストを種目ごとに分解する。読めない断片は捨てずに落とさず無視する */
export function parseLiftText(text: string): LiftEntry[] {
  const body = text.replace(/^🏋️\s*/, '');
  const out: LiftEntry[] = [];
  for (const part of body.split('、')) {
    // 「種目名 80kg×8×3」。種目名に空白は入らない前提（canonは空白なし）
    const m = part.trim().match(/^(.+?)\s+([\d.]+)kg(?:×(\d+))?(?:×(\d+))?$/);
    if (!m) continue;
    const kg = Number(m[2]);
    if (!(kg > 0)) continue;
    out.push({ name: m[1].trim(), kg, reps: m[3] ? Number(m[3]) : 1, sets: m[4] ? Number(m[4]) : 1 });
  }
  return out;
}

/** 1種目を保存形式の文字列にする（保存時と同じ表記にそろえる） */
export function liftPart(e: LiftEntry): string {
  return `${e.name} ${liftSetLabel(e)}`;
}

/** 重量×回数×セットの表示（種目名を除いた部分） */
export function liftSetLabel(e: LiftEntry): string {
  return `${e.kg}kg×${e.reps}${e.sets > 1 ? `×${e.sets}` : ''}`;
}

/** 種目の並びから記録テキストを組み直す。空なら空文字（＝記録を消す合図） */
export function liftTextFrom(entries: LiftEntry[]): string {
  const parts = entries.filter((e) => e.name.trim() && e.kg > 0 && e.reps > 0).map(liftPart);
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

/** その種目の総挙上量（kg×回×セット）。日ごとの手応えを1つの数字で見せるため */
export function volumeOf(e: LiftEntry): number {
  return e.kg * e.reps * e.sets;
}

export type LiftDay = {
  date: string;
  records: { id: string; text: string; entries: LiftEntry[] }[];
  lifts: number;      // その日の種目数（同じ種目は1つと数える）
  sets: number;       // 総セット数
  volume: number;     // 総挙上量kg
};

/** 記録を日ごとにまとめる。並びは新しい日が先（履歴は直近から見るもの） */
export function groupLiftsByDay(rows: LiftRecord[]): LiftDay[] {
  const byDate = new Map<string, LiftDay>();
  for (const r of rows) {
    const entries = parseLiftText(r.text);
    let d = byDate.get(r.date);
    if (!d) { d = { date: r.date, records: [], lifts: 0, sets: 0, volume: 0 }; byDate.set(r.date, d); }
    d.records.push({ id: r.id, text: r.text, entries });
  }
  for (const d of byDate.values()) {
    const names = new Set<string>();
    for (const rec of d.records) {
      for (const e of rec.entries) {
        names.add(e.name);
        d.sets += e.sets;
        d.volume += volumeOf(e);
      }
    }
    d.lifts = names.size;
    d.volume = Math.round(d.volume);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
