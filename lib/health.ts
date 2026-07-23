'use client';
// Apple ヘルスケア（HealthKit）連携。
// ネイティブアプリ（Capacitor）でのみ動作し、Web・旧ビルドでは全て安全に no-op になる。
// カスタムプラグイン（plugins/capacitor-health, jsName: 'Health'）を registerPlugin で橋渡しする。

import { getIsNative } from './native';

export type HealthLatest = {
  weight?: number; bodyFat?: number; waist?: number;
  weightDate?: string; bodyFatDate?: string; waistDate?: string;
};
export type HealthWrite = {
  date: string;
  weight?: number | null; bodyFat?: number | null; waist?: number | null;
  energy?: number | null; protein?: number | null; fat?: number | null; carbs?: number | null;
};

type HealthPlugin = {
  isAvailable(): Promise<{ available: boolean }>;
  requestAuthorization(): Promise<{ granted: boolean }>;
  readLatest(): Promise<HealthLatest>;
  readActiveEnergy(o: { date: string }): Promise<{ kcal: number }>;
  writeMetrics(o: Record<string, unknown>): Promise<{ written: number }>;
};

// プラグイン応答が返らない場合に固まらないためのタイムアウト付きラッパー
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
    p.then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
     .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
  });
}

let _plugin: HealthPlugin | null | undefined;
async function plugin(): Promise<HealthPlugin | null> {
  if (_plugin !== undefined) return _plugin;
  try {
    if (!(await getIsNative())) { _plugin = null; return null; }
    const { registerPlugin } = await import('@capacitor/core');
    _plugin = registerPlugin<HealthPlugin>('Health');
  } catch {
    _plugin = null;
  }
  return _plugin;
}

const LS_KEY = 'bodylog-health-on';
export function isHealthEnabled(): boolean {
  try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
}
export function setHealthEnabled(on: boolean): void {
  try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch { /* 無視 */ }
}

// ネイティブでヘルスケアが使えるか
export async function healthAvailable(): Promise<boolean> {
  const p = await plugin();
  if (!p) return false;
  try { return (await withTimeout(p.isAvailable(), 6000, { available: false })).available; } catch { return false; }
}

// 診断用: どこで止まっているかを可視化する（設定画面のデバッグ表示に使う）
export async function healthDiagnostics(): Promise<{ native: boolean; pluginListed: boolean; available: boolean | null; error: string | null }> {
  const out = { native: false, pluginListed: false, available: null as boolean | null, error: null as string | null };
  try {
    out.native = await getIsNative();
    if (!out.native) return out;
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    // 実行時にHealthプラグインが登録されているか
    out.pluginListed = typeof Capacitor.isPluginAvailable === 'function' ? Capacitor.isPluginAvailable('Health') : false;
    const p = registerPlugin<HealthPlugin>('Health');
    const r = await withTimeout(p.isAvailable(), 6000, { available: false });
    out.available = !!r?.available;
  } catch (e) {
    out.error = e instanceof Error ? (e.message || e.name) : String(e);
  }
  return out;
}

// 権限リクエスト（初回に許可シートが出る）
export async function healthRequestAuth(): Promise<boolean> {
  const p = await plugin();
  if (!p) return false;
  try { return (await withTimeout(p.requestAuthorization(), 20000, { granted: false })).granted; } catch { return false; }
}

// 権限要求の詳細（成功可否＋失敗理由）を返す。原因診断に使う。
export async function healthRequestAuthDetailed(): Promise<{ granted: boolean; error: string | null }> {
  const p = await plugin();
  if (!p) return { granted: false, error: 'ネイティブ/プラグインが利用できません' };
  const res = await Promise.race([
    p.requestAuthorization()
      .then((v) => ({ granted: !!v?.granted, error: null as string | null }))
      .catch((e: unknown) => ({ granted: false, error: e instanceof Error ? (e.message || e.name) : String(e) })),
    new Promise<{ granted: boolean; error: string | null }>((r) => setTimeout(() => r({ granted: false, error: '応答なし（20秒でタイムアウト）' }), 20000)),
  ]);
  return res;
}

// 最新の体重/体脂肪/ウエストを取り込む（連携ONのときだけ）
export async function healthPullLatest(): Promise<HealthLatest | null> {
  if (!isHealthEnabled()) return null;
  const p = await plugin();
  if (!p) return null;
  try { return await withTimeout(p.readLatest(), 10000, {} as HealthLatest); } catch { return null; }
}

// 指定日の消費エネルギー(kcal)を取得
export async function healthActiveEnergy(date: string): Promise<number | null> {
  if (!isHealthEnabled()) return null;
  const p = await plugin();
  if (!p) return null;
  try { return (await p.readActiveEnergy({ date })).kcal; } catch { return null; }
}

// その日の指標をヘルスケアへ書き出す（連携ONのときだけ・失敗しても無害）
export async function healthPushDay(w: HealthWrite): Promise<number> {
  if (!isHealthEnabled()) return 0;
  const p = await plugin();
  if (!p) return 0;
  try {
    const payload: Record<string, unknown> = { date: w.date };
    for (const k of ['weight', 'bodyFat', 'waist', 'energy', 'protein', 'fat', 'carbs'] as const) {
      const v = w[k];
      if (v != null && Number(v) > 0) payload[k] = Number(v);
    }
    if (Object.keys(payload).length <= 1) return 0;
    return (await withTimeout(p.writeMetrics(payload), 12000, { written: 0 })).written;
  } catch {
    return 0;
  }
}
