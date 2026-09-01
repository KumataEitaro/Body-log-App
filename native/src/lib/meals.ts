// マイミール: 複数品目のセットを名前つきで保存し、1タップでトレイへ再記録する
// （1500人ペルソナ監査ペイン3位「定番食を毎回AIに通す」対応）。
// テーブルは supabase/migration-24.sql【ユーザー実行待ち】。
// 未適用のDBでも壊れない: 読み込み失敗は空配列＝チップ・管理節が出ないだけ。
import { supabase } from './supabase';
import { sumItems, type FoodItem } from './items';
import { t } from './i18n';

export type MyMeal = { id: string; name: string; items: FoodItem[] };

const MAX_MEALS = 20;

/** 本人のマイミール一覧（登録順）。テーブル未作成・通信失敗は空扱い（機能非表示） */
export async function listMyMeals(): Promise<MyMeal[]> {
  try {
    const { data, error } = await supabase.from('my_meals')
      .select('id,name,items').order('created_at', { ascending: true }).limit(MAX_MEALS);
    if (error || !data) return [];
    return (data as { id: string; name: unknown; items: unknown }[])
      .map((r) => ({
        id: String(r.id),
        name: String(r.name ?? '').trim(),
        items: Array.isArray(r.items) ? (r.items as FoodItem[]) : [],
      }))
      .filter((m) => m.name !== '' && m.items.length > 0);
  } catch { return []; }
}

/** セットを保存する。失敗はユーザー向け文言で返す（migration-24未適用でもここで止まるだけ） */
export async function saveMyMeal(uid: string, name: string, items: FoodItem[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const nm = String(name ?? '').trim();
  if (!nm || items.length === 0) return { ok: false, error: t('セット名を入力してください。') };
  try {
    const { error } = await supabase.from('my_meals').insert({ user_id: uid, name: nm, items });
    if (error) return { ok: false, error: t('マイミールを保存できませんでした。通信環境を確認してもう一度お試しください。') };
    return { ok: true };
  } catch {
    return { ok: false, error: t('マイミールを保存できませんでした。通信環境を確認してもう一度お試しください。') };
  }
}

/** 削除（Undoは呼び出し側が保存内容を控えて saveMyMeal で戻す） */
export async function deleteMyMeal(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('my_meals').delete().eq('id', id);
    return !error;
  } catch { return false; }
}

/** 名前変更（設定＞マイ食品の管理から） */
export async function renameMyMeal(id: string, name: string): Promise<boolean> {
  const nm = String(name ?? '').trim();
  if (!nm) return false;
  try {
    const { error } = await supabase.from('my_meals').update({ name: nm }).eq('id', id);
    return !error;
  } catch { return false; }
}

/** 既定のセット名 = 品目1つ目の名前＋「セット」 */
export function defaultMealName(items: FoodItem[]): string {
  const first = items[0]?.name?.trim();
  return first ? t('{name}セット', { name: first }) : t('マイミール');
}

/** セットの合計kcal（一覧・保存シートの表示用） */
export function mealKcal(items: FoodItem[]): number {
  return Math.round(sumItems(items).kcal);
}
