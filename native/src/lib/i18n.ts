// 多言語対応（フォールバック方式）
// キーは日本語の原文そのもの。辞書に無ければ日本語をそのまま返すため、
// 翻訳が未完成でも日本語UIは絶対に壊れない（段階的に辞書を足していける）。
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { EN } from '@/content/i18n/en';

export type LocaleCode = 'ja' | 'en' | 'zh' | 'ko' | 'es' | 'fr' | 'de' | 'pt' | 'id' | 'th' | 'vi';

export const LOCALES: { code: LocaleCode; label: string }[] = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'th', label: 'ไทย' },
  { code: 'vi', label: 'Tiếng Việt' },
];

type Dict = Record<string, string>;
// 現状は英語辞書のみ同梱。他言語は辞書ファイルを足せば即座に有効になる。
const DICTS: Partial<Record<LocaleCode, Dict>> = { en: EN };

const KEY = 'bl-locale';
let locale: LocaleCode = 'ja';
let explicit = false; // ユーザーが手動で選んだか（端末言語の追従を止める）
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function detectDeviceLocale(): LocaleCode {
  try {
    const tag = (getLocales()[0]?.languageCode || 'ja').toLowerCase();
    const hit = LOCALES.find((l) => l.code === tag);
    return hit ? hit.code : 'en'; // 未対応言語は英語で見せる（日本語のままより親切）
  } catch { return 'ja'; }
}

export async function loadLocale(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved && LOCALES.some((l) => l.code === saved)) {
      locale = saved as LocaleCode;
      explicit = true;
    } else {
      locale = detectDeviceLocale();
    }
  } catch {
    locale = 'ja';
  }
  emit();
}

export async function setLocale(code: LocaleCode): Promise<void> {
  locale = code;
  explicit = true;
  emit();
  try { await AsyncStorage.setItem(KEY, code); } catch { /* 表示は既に切り替わっている */ }
}

export function getLocale(): LocaleCode { return locale; }
export function isExplicitLocale(): boolean { return explicit; }

export function useLocale(): LocaleCode {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getLocale,
    getLocale,
  );
}

/**
 * 翻訳。キーは日本語原文。
 * t('保存する') → ja:'保存する' / en:'Save' / 辞書に無い言語:日本語のまま
 * 変数は {n} 形式で差し込む: t('あと{n}g', { n: 51 })
 */
export function t(ja: string, vars?: Record<string, string | number>): string {
  let out = locale === 'ja' ? ja : (DICTS[locale]?.[ja] ?? DICTS.en?.[ja] ?? ja);
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

// AI系APIに渡す言語コード（サーバー側で回答言語を切り替える）
export function apiLang(): string { return locale; }
