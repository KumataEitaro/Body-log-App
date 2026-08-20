// Vercel上のAI API（食事解析・コーチ）をBearerトークンで呼ぶ。
import { supabase } from '@/lib/supabase';

const API = process.env.EXPO_PUBLIC_API_BASE || 'https://bodylog-orcin.vercel.app';

// AI解析は数秒〜十数秒かかるが、それ以上待たせても成功しない。
// タイムアウトが無いとfetchが永久に解決せず、ローディング表示が消えないまま操作不能になる。
const TIMEOUT_MS = 45_000;

export type ApiResult<T> = {
  ok: boolean;
  status: number;
  json: T | null;
  /** 通信自体が成立しなかった理由。timeout=時間切れ / offline=回線・DNS等 */
  failure?: 'timeout' | 'offline';
};

export async function apiPost<T = Record<string, unknown>>(
  path: string, body: unknown, timeoutMs: number = TIMEOUT_MS,
): Promise<ApiResult<T>> {
  // AbortControllerで時間切れを作る（RNのfetchにtimeoutオプションは無い）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // セッション取得も固まりうるのでtry内に入れる（期限切れトークンの更新で待つことがある）
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError';
    return { ok: false, status: 0, json: null, failure: aborted ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);   // 成功時にタイマーを残すとアプリが起きたままになる
  }
}
