// AIが提案した目標変更を、DBに書く前に検証する。
//
// この層を作った理由：
// 「AIの提案を承認して目標を書き換える」のは、アプリの中でいちばん壊れると困る操作なのに、
// 失敗しても画面には何も出ない作りになっていた（押しても無反応）。
// 原因は正規表現の書き間違い1つだったが、同じ「無言で失敗する」形は他にもいくつも作れる。
//
// そこで方針を2つ決めた：
//  1. 検証はここに集め、必ず「通った理由」か「弾いた理由」のどちらかを返す。
//     呼び出し側が黙って return できる余地を作らない。
//  2. AIの出力は信用しない。桁を間違えた値（たんぱく質 22g/kg 等）や
//     存在しない日付（2026-13-45）を、そのまま目標として書き込ませない。
import { t } from './i18n';

/** AIが提案した献立の1品（食事トレイの品目と同じ形） */
export type MealItem = { name: string; qty: string; kcal: number; p: number; f: number; c: number };

/** AIが返す目標変更の提案。サーバ側の許可リストと同じ種類だけを扱う */
export type CoachAction =
  | { kind: 'pfc'; protein_per_kg?: number; fat_per_kg?: number; label: string }
  | { kind: 'weight'; target_weight?: number; target_date?: string; label: string }
  | { kind: 'training'; name: string; target_kg: number; label: string }
  | { kind: 'meal'; label: string; items: MealItem[] };

/** 検証を通った書き込み内容。どのテーブルに何を書くかまで確定させる */
export type ApplyPlan =
  | { table: 'goals'; patch: Record<string, number | string> }
  | { table: 'training_goals'; name: string; targetKg: number }
  // 献立はDBに書かない。食事トレイに載せるだけで、確定は本人の✓保存
  | { table: 'tray'; items: MealItem[] };

export type Validated = { ok: true; plan: ApplyPlan } | { ok: false; reason: string };

// 値の許容範囲。AIが桁を間違えた提案をそのまま目標にしないための下限・上限。
// 極端な人でも収まる幅にしてあり、これを外れる提案は提案そのものがおかしい。
const RANGE = {
  proteinPerKg: [0.5, 4],     // g/kg（除脂肪ではなく体重あたり）
  fatPerKg: [0.2, 2],         // g/kg
  targetWeight: [25, 300],    // kg
  targetKg: [1, 500],         // 挙上重量kg（世界記録級でも500未満）
  nameLen: 40,                // 種目名の長さ
  itemKcal: [0, 2000],        // 献立1品のkcal
  itemGram: [0, 300],         // 献立1品のP/F/C(g)
  mealItems: [1, 8],          // 献立の品数
  mealKcal: 3500,             // 献立全体のkcal上限（1食としてありえない値を弾く）
  dateYears: 10,              // 目標日は今日〜10年後まで
} as const;

const inRange = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;

/** 有限の数値だけを通す。文字列の "2.2" は通し、"2.2g" や NaN や null は弾く */
function num(v: unknown): number | null {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 実在する日付かどうか。
 * 正規表現の形だけ見ると 2026-13-45 が通ってしまうので、組み立て直して一致を確かめる。
 */
export function isRealDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 目標日として妥当か（実在する日付で、今日以降・遠すぎない） */
function checkTargetDate(v: unknown, todayISO: string): { ok: true; date: string } | { ok: false; reason: string } {
  if (!isRealDate(v)) return { ok: false, reason: t('目標日の形式が正しくありません。') };
  if (v < todayISO) return { ok: false, reason: t('目標日が過去になっています。') };
  const limit = String(Number(todayISO.slice(0, 4)) + RANGE.dateYears) + todayISO.slice(4);
  if (v > limit) return { ok: false, reason: t('目標日が遠すぎます。') };
  return { ok: true, date: v };
}

/**
 * AIの提案を検証し、書き込める形にして返す。
 * 弾く場合は必ず理由を返す（呼び出し側が無言で終われないようにするため）。
 */
export function validateAction(a: unknown, todayISO: string): Validated {
  if (a == null || typeof a !== 'object') return { ok: false, reason: t('提案の内容を読み取れませんでした。') };
  const act = a as Record<string, unknown>;

  switch (act.kind) {
    case 'pfc': {
      const patch: Record<string, number> = {};
      // 「変更しない側のキーは省略」仕様なので、片方だけの提案も正しい
      const p = num(act.protein_per_kg);
      const f = num(act.fat_per_kg);
      if (p != null) {
        if (!inRange(p, RANGE.proteinPerKg)) {
          return { ok: false, reason: t('たんぱく質の提案値（{v}g/kg）が現実的な範囲を超えています。', { v: p }) };
        }
        patch.protein_per_kg = p;
      }
      if (f != null) {
        if (!inRange(f, RANGE.fatPerKg)) {
          return { ok: false, reason: t('脂質の提案値（{v}g/kg）が現実的な範囲を超えています。', { v: f }) };
        }
        patch.fat_per_kg = f;
      }
      // 両方欠けていると「何も変えない更新」になり、成功したのに何も起きない状態になる
      if (Object.keys(patch).length === 0) {
        return { ok: false, reason: t('変更する値が提案に含まれていませんでした。') };
      }
      return { ok: true, plan: { table: 'goals', patch } };
    }

    case 'weight': {
      const patch: Record<string, number | string> = {};
      const w = num(act.target_weight);
      if (w != null) {
        if (!inRange(w, RANGE.targetWeight)) {
          return { ok: false, reason: t('目標体重（{v}kg）が現実的な範囲を超えています。', { v: w }) };
        }
        patch.target_weight = w;
      }
      if (act.target_date != null && act.target_date !== '') {
        const d = checkTargetDate(act.target_date, todayISO);
        if (!d.ok) return { ok: false, reason: d.reason };
        patch.target_date = d.date;
      }
      if (Object.keys(patch).length === 0) {
        return { ok: false, reason: t('変更する値が提案に含まれていませんでした。') };
      }
      return { ok: true, plan: { table: 'goals', patch } };
    }

    case 'training': {
      const name = typeof act.name === 'string' ? act.name.trim() : '';
      if (!name) return { ok: false, reason: t('種目名が提案に含まれていませんでした。') };
      if (name.length > RANGE.nameLen) return { ok: false, reason: t('種目名が長すぎます。') };
      const kg = num(act.target_kg);
      if (kg == null) return { ok: false, reason: t('目標重量が提案に含まれていませんでした。') };
      if (!inRange(kg, RANGE.targetKg)) {
        return { ok: false, reason: t('目標重量（{v}kg）が現実的な範囲を超えています。', { v: kg }) };
      }
      return { ok: true, plan: { table: 'training_goals', name, targetKg: kg } };
    }

    case 'meal': {
      // 献立はDBに書かないが、トレイに載れば✓保存で記録になるため数値は同じ厳しさで見る
      const raw = Array.isArray(act.items) ? act.items : null;
      if (!raw || raw.length < RANGE.mealItems[0] || raw.length > RANGE.mealItems[1]) {
        return { ok: false, reason: t('献立の品目を読み取れませんでした。') };
      }
      const items: MealItem[] = [];
      let total = 0;
      for (const it of raw as Record<string, unknown>[]) {
        const name = typeof it?.name === 'string' ? it.name.trim().slice(0, RANGE.nameLen) : '';
        if (!name) return { ok: false, reason: t('献立に名前のない品目が含まれていました。') };
        const kcal = num(it.kcal); const gp = num(it.p); const gf = num(it.f); const gc = num(it.c);
        if (kcal == null || !inRange(kcal, RANGE.itemKcal)) {
          return { ok: false, reason: t('献立のカロリーが現実的な範囲を超えています。') };
        }
        for (const g of [gp, gf, gc]) {
          if (g == null || !inRange(g, RANGE.itemGram)) {
            return { ok: false, reason: t('献立の栄養素が現実的な範囲を超えています。') };
          }
        }
        total += kcal;
        items.push({
          name,
          qty: typeof it.qty === 'string' && it.qty.trim() ? it.qty.trim().slice(0, 20) : '×1',
          kcal: Math.round(kcal), p: Math.round(gp!), f: Math.round(gf!), c: Math.round(gc!),
        });
      }
      if (total > RANGE.mealKcal) return { ok: false, reason: t('献立のカロリーが現実的な範囲を超えています。') };
      return { ok: true, plan: { table: 'tray', items } };
    }

    default:
      // 知らない種類は書き込まない。増えた種類を実装し忘れても、無言では終わらせない
      return { ok: false, reason: t('この提案（{kind}）にはまだ対応していません。「概要」タブから設定してください。', { kind: String(act.kind ?? '不明') }) };
  }
}

/** 表示できる提案か（押しても何も起きないボタンを出さないための事前判定） */
export function isApplicable(a: unknown, todayISO: string): boolean {
  return validateAction(a, todayISO).ok;
}
