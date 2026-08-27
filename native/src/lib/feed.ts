// ログ行の表示ヘルパー（食事/体重/筋トレ/運動/気分をアイコン＋人間向けタイトルに整形）
// DBの生テキストや「（メモなし）」をそのまま見せないための共通層。log.tsxとchanges.tsxで共用
import { type FoodItem } from './items';
import { t } from '@/lib/i18n';

export type FeedLog = {
  items?: FoodItem[] | null;
  kcal?: number | null;
  weight?: number | null;
  ex?: string | null;
  text?: string | null;
  mood?: string | null;
};

export function logIcon(l: FeedLog): string {
  const items = (l.items as FoodItem[]) || [];
  if (l.text?.startsWith('🏋️')) return '🏋️';
  if (l.text?.startsWith('🏃')) return '🏃';
  if (items.length > 0 || l.kcal != null) return '🍽';
  if (l.weight != null) return '⚖️';
  if (l.ex && l.ex !== 'オフ') return '🏃';
  if (l.mood) return '💭';
  return '📝';
}

// この行が「気分だけの記録」なら1〜5を返す（食事や体重を伴う行はnull）。
// 表示側はこの値があるとき分数テキストではなく顔＋ドットで描く。
export function moodLevelOf(l: FeedLog): 1 | 2 | 3 | 4 | 5 | null {
  if (logIcon(l) !== '💭' || !l.mood) return null;
  const m = String(l.mood).match(/([1-5])\s*\/\s*5/);
  if (m) return Number(m[1]) as 1 | 2 | 3 | 4 | 5;
  const faces = ['😫', '😕', '😐', '🙂', '😄']; // 旧データ（絵文字時代）の互換
  for (let i = 0; i < faces.length; i++) if (String(l.mood).includes(faces[i])) return (i + 1) as 1 | 2 | 3 | 4 | 5;
  return null;
}

export function logTitle(l: FeedLog): string {
  const items = (l.items as FoodItem[]) || [];
  if (l.text?.startsWith('🏋️')) return l.text.replace(/^🏋️ /, '');
  if (l.text?.startsWith('🏃')) return l.text.replace(/^🏃 /, '');
  if (items.length > 0) {
    const names = items.slice(0, 3).map((it) => (it.qty && it.qty !== '×1' ? `${it.name} ${it.qty}` : it.name)).join('、');
    return names + (items.length > 3 ? ` ほか${items.length - 3}品` : '');
  }
  if (l.kcal != null) return String(l.text || t('食事（概算）')).replace(/^（|）$/g, '').slice(0, 60);
  if (l.weight != null) return t('体重 {n}kg', { n: Number(l.weight).toFixed(1) });
  if (l.ex && l.ex !== 'オフ') return `運動 ${l.ex}`;
  // 気分は「4/5」の分数を見せない（テキスト消費箇所＝削除確認Alert等でもドットにする）
  const lv = moodLevelOf(l);
  if (lv != null) return `${t('気分')} ${'●'.repeat(lv)}${'○'.repeat(5 - lv)}`;
  return String(l.text || l.mood || t('記録')).slice(0, 60);
}
