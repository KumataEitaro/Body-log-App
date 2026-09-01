// OAuthコールバックURL（bodylog://auth-callback?...）の解釈を純関数に分離。
// Google SSOの「戻り」はPKCEのcode / implicitのトークン / エラーの3形態があり、
// 取りこぼすと「認証したのにアプリが無反応」という最悪のUXになるため、
// ここを網羅的にテストする（βフィードバック 2026-09-02のSSO調査より）。
export type AuthCallbackResult =
  | { kind: 'code'; code: string }
  | { kind: 'tokens'; access_token: string; refresh_token: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

export function parseAuthCallback(url: string): AuthCallbackResult {
  let query: URLSearchParams;
  try { query = new URL(url).searchParams; } catch { return { kind: 'none' }; }
  const frag = new URLSearchParams(url.split('#')[1] ?? '');

  // エラーはクエリにもフラグメントにも乗り得る（Supabaseはotp_expired等をフラグメントで返す）
  const err = query.get('error_description') || query.get('error')
    || frag.get('error_description') || frag.get('error');
  if (err) return { kind: 'error', message: err.replace(/\+/g, ' ') };

  const code = query.get('code');
  if (code) return { kind: 'code', code };

  const access_token = frag.get('access_token');
  const refresh_token = frag.get('refresh_token');
  if (access_token && refresh_token) return { kind: 'tokens', access_token, refresh_token };

  return { kind: 'none' };
}
