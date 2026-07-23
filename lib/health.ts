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
  try { return (await p.isAvailable()).available; } catch { return false; }
}

// 権限リクエスト（初回に許可シートが出る）
export async function healthRequestAuth(): Promise<boolean> {
  const p = await plugin();
  if (!p) return false;
  try { return (await p.requestAuthorization()).granted; } catch { return false; }
}

// 最新の体重/体脂肪/ウエストを取り込む（連携ONのときだけ）
export async function healthPullLatest(): Promise<HealthLatest | null> {
  if (!isHealthEnabled()) return null;
  const p = await plugin();
  if (!p) return null;
  try { return await p.readLatest(); } catch { return null; }
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
    return (await p.writeMetrics(payload)).written;
  } catch {
    return 0;
  }
}
