// ダイエット目的。
//
// P=2.0g/kg という既定値は「筋肉を守りながら減量」には根拠のある値だが、
// ゆるく痩せたい人には過剰で、外部AIに「多すぎ」と指摘される混乱が実際に起きた。
// 既定値が間違っているのではなく、目的依存の値を一律で配っていたのが問題。
// 目的を最初に選んでもらい、PFC係数の既定とAI相談の前提をそこから決める。
//
// DBに保存するのはkey（英字・翻訳非依存）。ラベルは表示時にt()へ通す。
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { t } from './i18n';

export type PurposeKey = 'cut_lean' | 'cut_std' | 'easy' | 'bulk';

export type Purpose = {
  key: PurposeKey;
  label: string;   // 表示時に t() へ通す（日本語原文キー）
  desc: string;
  p: number;       // たんぱく質 g/kg
  f: number;       // 脂質 g/kg
};

// 係数の根拠: 減量中の筋量維持はP1.6〜2.4g/kgが支持される。
// ゆる減量は推奨量(0.9)より少し上に置き、続けやすさを優先する。
export const PURPOSES: Purpose[] = [
  { key: 'cut_lean', label: '筋肉を守りながらしっかり減量', desc: 'トレーニングと高たんぱくで筋量を守る', p: 2.0, f: 0.8 },
  { key: 'cut_std',  label: 'バランスよく減量', desc: '無理のない標準バランスで着実に', p: 1.6, f: 0.9 },
  { key: 'easy',     label: 'ゆるく健康的に', desc: '厳密さより続けやすさを優先', p: 1.2, f: 1.0 },
  { key: 'bulk',     label: '筋肉をつける', desc: '増量期。たんぱく質と総量を確保', p: 1.8, f: 1.0 },
];

export function purposeOf(key: string | null | undefined): Purpose | null {
  if (!key) return null;
  return PURPOSES.find((p) => p.key === key) ?? null;
}

export function purposeLabel(key: string | null | undefined): string {
  const p = purposeOf(key);
  return p ? t(p.label) : '';
}

// ===== 選択の保持（端末に即保存＋DBへはベストエフォート） =====
// 端末保存が主なのは、目的はオンボーディング（DB列がまだ無い環境もある）で選ぶため。
// DB側はAI相談の文脈用で、書ければ書く（migration未適用でも機能が止まらない）。
const KEY = 'bl-purpose';

let current: PurposeKey | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadPurpose(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v && PURPOSES.some((p) => p.key === v)) { current = v as PurposeKey; emit(); }
  } catch { /* 未選択のまま */ }
}

export function setPurpose(key: PurposeKey): void {
  current = key;
  emit();
  AsyncStorage.setItem(KEY, key).catch(() => {});
  // DBへはベストエフォート（列が無い・オフラインでも端末側は機能する）
  (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (uid) await supabase.from('profiles').update({ purpose: key }).eq('id', uid);
    } catch { /* 端末保存が主なので無視 */ }
  })();
}

export function getPurpose(): PurposeKey | null { return current; }

export function usePurpose(): PurposeKey | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getPurpose,
    getPurpose,
  );
}
