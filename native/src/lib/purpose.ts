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
import { todayJST } from './calc';

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
      if (!uid) return;
      await supabase.from('profiles').update({ purpose: key }).eq('id', uid);
      // サイクル履歴（B-5）もベストエフォート。失敗しても端末保存は成功のまま
      await recordPurposePeriod(uid, key);
    } catch { /* 端末保存が主なので無視 */ }
  })();
}

// ===== サイクル履歴（B-5・purpose_periods） =====
// バルク⇄カットの往復を期間として残し、サイクル単位の自己比較を可能にする。
// migration-20未適用（テーブルが無い）環境でも全機能が動くよう、
// ここは常にベストエフォート＝エラーは握りつぶしてサイクル機能だけ静かに諦める。
export type PurposePeriod = { purpose: string; started_at: string; ended_at: string | null };

async function recordPurposePeriod(uid: string, key: PurposeKey): Promise<void> {
  try {
    const today = todayJST();
    // 現在行（ended_at=null）を見る。無ければ初回＝現在の目的で1行作る
    const { data, error } = await supabase.from('purpose_periods')
      .select('id,purpose').is('ended_at', null)
      .order('started_at', { ascending: false }).limit(1);
    if (error) return; // テーブル未作成など。切替自体は端末＋profilesで完結している
    const open = (data as { id: string; purpose: string }[] | null)?.[0];
    if (open?.purpose === key) return; // 同じ目的の再選択は履歴にしない
    if (open) await supabase.from('purpose_periods').update({ ended_at: today }).eq('id', open.id);
    await supabase.from('purpose_periods').insert({ user_id: uid, purpose: key, started_at: today });
  } catch { /* ベストエフォート */ }
}

/** 全サイクル履歴を古い順で取得。テーブル未作成・オフラインはnull（＝機能を静かに非表示にする合図） */
export async function fetchPurposePeriods(): Promise<PurposePeriod[] | null> {
  try {
    const { data, error } = await supabase.from('purpose_periods')
      .select('purpose,started_at,ended_at').order('started_at', { ascending: true });
    if (error) return null;
    return (data as PurposePeriod[]) ?? [];
  } catch { return null; }
}

/** サイクルの呼び名（表示用・t()済み）。目的4種を増量/減量/ゆる維持の3系に畳む */
export function cycleLabel(key: string): string {
  if (key === 'bulk') return t('増量');
  if (key === 'easy') return t('ゆる維持');
  return t('減量');
}

export function getPurpose(): PurposeKey | null { return current; }

export function usePurpose(): PurposeKey | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getPurpose,
    getPurpose,
  );
}
