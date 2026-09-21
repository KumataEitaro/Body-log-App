// AI 使用回数（ai_usage）の加算を **service role** で行う（2026-09-18・QA P1-7 後半／TODO B14）。
//
// 【なぜ】以前は各 API ルートが利用者本人の権限（RLS: auth.uid() = user_id）で ai_usage を upsert していた。
// 本人が書けるということは、**アプリを介さず自分の行を count=0 に戻せる**ということでもある。
// 課金を点火したあと（A9）に、この抜け道で日次上限を無限にリセットされると売上に直結する。
// migration-34.sql で本人の書き込みを RLS から外し（SELECT だけ残す）、加算はここ1か所に集める。
//
// 【呼び方】応答を返したあと（`after()`）に呼ぶ。失敗しても解析結果は既に返っているので握りつぶす。
// service role キーが無い環境（ローカル等）では本人権限のクライアントで従来どおり書く＝開発は止めない。
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';

export type AiUsageKind = 'text' | 'photo' | 'coach';

export type AiUsageRow = {
  count?: number | null;
  text_count?: number | null;
  photo_count?: number | null;
  coach_count?: number | null;
} | null | undefined;

/** いまの行 → 1回ぶん加算した行（純関数。テストで固定する） */
export function nextUsage(current: AiUsageRow, kind: AiUsageKind): { count: number; text_count: number; photo_count: number; coach_count: number } {
  const n = (v: number | null | undefined) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    count: n(current?.count) + 1,
    text_count: n(current?.text_count) + (kind === 'text' ? 1 : 0),
    photo_count: n(current?.photo_count) + (kind === 'photo' ? 1 : 0),
    coach_count: n(current?.coach_count) + (kind === 'coach' ? 1 : 0),
  };
}

function serviceClient(): SupabaseClient | null {
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!svcKey || !url) return null;
  return createServiceClient(url, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * ai_usage を1回ぶん加算する。
 * @param fallback service role が無い環境で使う本人権限のクライアント（開発用）。本番では使われない
 */
export async function bumpAiUsage(
  userId: string, date: string, kind: AiUsageKind, current: AiUsageRow, fallback?: SupabaseClient,
): Promise<void> {
  const row = { user_id: userId, date, ...nextUsage(current, kind) };
  const client = serviceClient() ?? fallback;
  if (!client) return;
  try {
    await client.from('ai_usage').upsert(row);
  } catch { /* 計上の失敗は利用者に見せない（解析結果は既に返している） */ }
}
