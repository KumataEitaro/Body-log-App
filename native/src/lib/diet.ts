// 食事の制約（B-18）の設定の読み書き。docs/DIET-MODES.md §1 / §3。
//
// 正本はDBの profiles.diet_modes / diet_custom / diet_consent_at（migration-26）。
// ただし**辞書判定はオフラインでも動くことが前提**（§2）なので、読めた設定は
// AsyncStorageに写しておき、通信が無い起動でも警告が消えないようにする。
//
// migration-26 未適用のDBでも壊れない:
//   読み = select('*') で undefined → 空扱い（節は出るが常に未設定のまま）
//   書き = 列名を含むupdateが失敗したら available:false を返し、UIが理由を出す
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from './supabase';

/** 端末内キャッシュのキー（オフライン時の辞書判定に使う） */
const CACHE_KEY = 'bl-diet';

export type DietProfile = {
  /** 有効なプリセットキー（dietRules.tsのDietModeKey。未知値は判定側で無視される） */
  modes: string[];
  /** 自由記述の排除指定（AIへそのまま渡す・プレミアム） */
  custom: string;
  /** 免責同意の日時（ISO文字列）。null=未同意＝機能をONにできない */
  consentAt: string | null;
};

export const EMPTY_DIET: DietProfile = { modes: [], custom: '', consentAt: null };

/** 制約が1つも無い（＝警告の判定を走らせる必要がない）か */
export function isDietOff(p: DietProfile | null | undefined): boolean {
  return !p || p.consentAt == null || (p.modes.length === 0 && !p.custom.trim());
}

/** DBの行（型は信用しない）→ DietProfile */
export function fromRow(row: Record<string, unknown> | null | undefined): DietProfile {
  if (!row) return EMPTY_DIET;
  const raw = row.diet_modes;
  const modes = Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : [];
  const custom = typeof row.diet_custom === 'string' ? row.diet_custom : '';
  const consentAt = typeof row.diet_consent_at === 'string' ? row.diet_consent_at : null;
  return { modes, custom, consentAt };
}

// ===== モジュールスコープのキャッシュ（gate.ts と同じ作法） =====
// 食事タブは1日に何度も開くので、毎回profilesを引かない。
let cached: DietProfile = EMPTY_DIET;
let loaded = false;
let loading = false;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const snapshot = () => cached;
const emit = () => listeners.forEach((l) => l());

function setCached(next: DietProfile): void {
  cached = next;
  loaded = true;
  emit();
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next)).catch(() => {});
}

/** DBから読み直す（失敗時は端末キャッシュで代替＝オフラインでも辞書判定が動く） */
export async function loadDiet(force = false): Promise<DietProfile> {
  if (loading) return cached;
  if (loaded && !force) return cached;
  loading = true;
  try {
    // まず端末キャッシュ（通信を待たずに警告を出せるように）
    if (!loaded) {
      try {
        const s = await AsyncStorage.getItem(CACHE_KEY);
        if (s) {
          const j = JSON.parse(s) as Partial<DietProfile>;
          cached = {
            modes: Array.isArray(j.modes) ? j.modes.filter((m): m is string => typeof m === 'string') : [],
            custom: typeof j.custom === 'string' ? j.custom : '',
            consentAt: typeof j.consentAt === 'string' ? j.consentAt : null,
          };
          emit();
        }
      } catch { /* キャッシュが壊れていたら無視して素の状態から */ }
    }
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return cached;   // 未ログイン中は保留（ログイン後のマウントで再試行）
    // select('*') は列が無い環境でもエラーにならない（undefined→空扱い）
    const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) return cached;  // 通信断はキャッシュのまま（警告を黙って止めない）
    setCached(fromRow(data as Record<string, unknown> | null));
    return cached;
  } catch {
    return cached;
  } finally { loading = false; }
}

/**
 * 保存する。同意日時は「初回ONのとき」に呼び出し側が now を渡す（§3）。
 * 列が無いDBでは ok:false / reason:'no_column' を返し、UIが理由を出す。
 */
export async function saveDiet(next: DietProfile): Promise<{ ok: boolean; reason?: 'no_column' | 'failed' | 'no_session' }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return { ok: false, reason: 'no_session' };
    const { error } = await supabase.from('profiles').update({
      diet_modes: next.modes,
      diet_custom: next.custom.trim() || null,
      diet_consent_at: next.consentAt,
    }).eq('id', uid);
    if (error) {
      // migration-26 未適用: 機能ごと使えないことを呼び出し側に伝える（黙って成功に見せない）
      if (/diet_modes|diet_custom|diet_consent_at|column|schema/i.test(error.message)) {
        return { ok: false, reason: 'no_column' };
      }
      return { ok: false, reason: 'failed' };
    }
    setCached(next);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** 画面から使うフック。マウント時に1回だけDBを引き、以後はキャッシュを共有する */
export function useDiet(): DietProfile {
  const p = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { loadDiet().catch(() => {}); }, []);
  return p;
}

/** テスト用: キャッシュを初期状態に戻す */
export function __resetDietForTest(): void {
  cached = EMPTY_DIET; loaded = false; loading = false; listeners.clear();
}
