// APIルートの認証: Web(Cookie)とネイティブアプリ(Authorization: Bearer)の両対応。
// React Native版はCookieを持たないため、SupabaseのアクセストークンをBearerヘッダで送ってくる。
import { createClient as createBareClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createClient as createCookieClient } from '@/lib/supabase/server';

export async function getApiAuth(req: Request): Promise<{ supabase: SupabaseClient; user: User | null }> {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    // トークンをそのままRLSに効かせる（このクライアントでのDB操作は本人権限になる）
    const supabase = createBareClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: { user } } = await supabase.auth.getUser(token);
    return { supabase, user };
  }
  // 従来どおりCookieセッション（Web版）
  const supabase = await createCookieClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}
