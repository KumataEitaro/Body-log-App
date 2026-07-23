'use client';
// Apple ヘルスケア（HealthKit）連携。
// ネイティブアプリ（Capacitor）でのみ動作し、Web・旧ビルドでは全て安全に no-op になる。
// 重要: 動的 import は WebView + Service Worker 環境で稀に応答が返らず固まるため使わない。
// ネイティブが必ず注入している window.Capacitor を「同期」で参照してプラグインを得る。

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

type CapGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  registerPlugin?: <T>(name: string) => T;
  Plugins?: Record<string, unknown>;
};

function cap(): CapGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
}

// ネイティブか（同期・window.Capacitor 直参照。動的importしない）
export function healthIsNative(): boolean {
  return !!cap()?.isNativePlatform?.();
}

// Health プラグインのプロキシを同期で取得（固まらない）
function getPlugin(): HealthPlugin | null {
  const c = cap();
  if (!c?.isNativePlatform?.()) return null;
  try {
    // 既に登録済みならそれを、無ければ registerPlugin で生成（どちらも同期）
    const existing = c.Plugins?.Health as HealthPlugin | undefined;
    if (existing) return existing;
    if (typeof c.registerPlugin === 'function') return c.registerPlugin<HealthPlugin>('Health');
  } catch { /* 無視 */ }
  return null;
}

// プラグイン応答が返らない場合に固まらないためのタイムアウト付きラッパー
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
    p.then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
     .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
  });
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
  const p = getPlugin();
  if (!p) return false;
  try { return (await withTimeout(p.isAvailable(), 6000, { available: false })).available; } catch { return false; }
}

// 権限リクエスト（初回に許可シートが出る）
export async function healthRequestAuth(): Promise<boolean> {
  const p = getPlugin();
  if (!p) return false;
  try { return (await withTimeout(p.requestAuthorization(), 20000, { granted: false })).granted; } catch { return false; }
}

// 各ネイティブ呼び出しを個別に「必ず結果が返る」形でテストし、どこで固まるかを可視化する。
export async function healthSelfTest(onStep: (msg: string) => void): Promise<void> {
  const race = <T,>(pr: Promise<T>, ms: number) =>
    Promise.race<{ v: T } | { e: unknown } | { t: true }>([
      pr.then((v) => ({ v })).catch((e) => ({ e })),
      new Promise((r) => setTimeout(() => r({ t: true }), ms)),
    ]);
  const show = (r: { v?: unknown; e?: unknown; t?: true }) =>
    ('v' in r) ? JSON.stringify(r.v)
      : ('t' in r) ? '⏱応答なし'
      : `⚠${(r as { e: unknown }).e instanceof Error ? ((r as { e: Error }).e.message || (r as { e: Error }).e.name) : String((r as { e: unknown }).e)}`;

  const c = cap();
  if (!c) { onStep('window.Capacitor が無い（Web/ブラウザ）'); return; }
  if (!c.isNativePlatform?.()) { onStep('ネイティブではありません（ブラウザ表示）'); return; }
  const listed = c.isPluginAvailable?.('Health');
  const p = getPlugin();
  if (!p) { onStep(`プラグイン取得失敗（isPluginAvailable=${listed}）`); return; }

  onStep(`登録=${listed} / ②isAvailable確認中…`);
  const a = await race(p.isAvailable(), 8000);
  onStep(`登録=${listed} / ②avail=${show(a)} / ③許可要求中（シートが出ます）…`);

  const r = await race(p.requestAuthorization(), 15000);
  onStep(`②avail=${show(a)} / ③auth=${show(r)} / ④読取中…`);

  const l = await race(p.readLatest(), 8000);
  onStep(`②avail=${show(a)} / ③auth=${show(r)} / ④read=${show(l)}`);
}

// 最新の体重/体脂肪/ウエストを取り込む（連携ONのときだけ）
export async function healthPullLatest(): Promise<HealthLatest | null> {
  if (!isHealthEnabled()) return null;
  const p = getPlugin();
  if (!p) return null;
  try { return await withTimeout(p.readLatest(), 10000, {} as HealthLatest); } catch { return null; }
}

// 指定日の消費エネルギー(kcal)を取得
export async function healthActiveEnergy(date: string): Promise<number | null> {
  if (!isHealthEnabled()) return null;
  const p = getPlugin();
  if (!p) return null;
  try { return (await p.readActiveEnergy({ date })).kcal; } catch { return null; }
}

// その日の指標をヘルスケアへ書き出す（連携ONのときだけ・失敗しても無害）
export async function healthPushDay(w: HealthWrite): Promise<number> {
  if (!isHealthEnabled()) return 0;
  const p = getPlugin();
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
