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

export function logTitle(l: FeedLog): string {
  const items = (l.items as FoodItem[]) || [];
  if (l.text?.startsWith('🏋️')) return l.text.replace(/^🏋️ /, '');
  if (l.text?.startsWith('🏃')) return l.text.replace(/^🏃 /, '');
  if (items.length > 0) {
    const names = items.slice(0, 3).map((it) => (it.qty && it.qty !== '×1' ? `${it.name} ${it.qty}` : it.name)).join('、');
    return names + (items.length > 3 ? ` ほか${items.length - 3}品` : '');
  }
  if (l.kcal != null) return String(l.text || t('食事（概算）')).replace(/^（|）$/g, '').slice(0, 60);
  if (l.weight != null) return `体重 ${Number(l.weight).toFixed(1)}kg`;
  if (l.ex && l.ex !== 'オフ') return `運動 ${l.ex}`;
  return String(l.text || l.mood || t('記録')).slice(0, 60);
}
