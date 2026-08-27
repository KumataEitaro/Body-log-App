// 大きいkcalの桁表現。「k」は英語圏では自然だが、日本・中華圏は万、韓国は만が
// 4桁区切りの生活感覚（−42.3kより−4.2万kcalが直感的）。
// Intl.NumberFormatのcompact表記はHermesで環境差があるため、辞書ベースで分岐する。
import { getLocale } from './i18n';

// 表示用に数字と単位を分けて返す（大きい数字＋小さい単位のスタイルを保つため）
export function bigKcalParts(v: number): { num: string; unit: string } {
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const loc = getLocale();
  const man = loc === 'ja' || loc === 'zh' ? '万' : loc === 'ko' ? '만' : null;
  if (man) {
    if (abs >= 10000) return { num: `${sign}${(abs / 10000).toFixed(1)}`, unit: man };
    return { num: `${sign}${Math.round(abs).toLocaleString()}`, unit: '' };
  }
  if (abs >= 1000) return { num: `${sign}${(abs / 1000).toFixed(1)}`, unit: 'k' };
  return { num: `${sign}${Math.round(abs)}`, unit: '' };
}
