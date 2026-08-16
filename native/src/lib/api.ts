// Vercel上のAI API（食事解析・コーチ）をBearerトークンで呼ぶ。
import { supabase } from '@/lib/supabase';

const API = process.env.EXPO_PUBLIC_API_BASE || 'https://bodylog-orcin.vercel.app';

export async function apiPost<T = Record<string, unknown>>(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: T | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}
