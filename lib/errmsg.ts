// ユーザー向けエラーメッセージの整形。
// 方針: 画面に出すのは短い日本語のみ（選択言語への置換はDomTranslatorが自動で行う）。
// Supabase/fetch/プラグイン等の英語の生エラーは画面に出さず、consoleにだけ残す。
// ※メッセージはDomTranslatorの翻訳対象になるよう80文字以内に収めること。

export const JA_TEXT_RE = /[぀-ゟ゠-ヿ㐀-鿿]/;

export function friendlyError(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e);
  console.log('[error detail]', raw);
  return JA_TEXT_RE.test(raw) ? raw : fallback;
}

// 認証エラーのよくあるパターンを日本語化（それ以外は汎用文言）
export function friendlyAuthError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  console.log('[auth] error:', m);
  if (/invalid login/i.test(m)) return 'メールまたはパスワードが違います。';
  if (/email not confirmed/i.test(m)) return 'メールの確認が未完了です。確認メールのリンクを開いてください。';
  if (/already registered/i.test(m)) return 'このメールアドレスは登録済みです。ログインしてください。';
  if (/rate limit|too many/i.test(m)) return '試行回数が多すぎます。少し待ってから再試行してください。';
  if (/weak password|at least/i.test(m)) return 'パスワードが短すぎます。6文字以上にしてください。';
  if (JA_TEXT_RE.test(m)) return m;
  return 'ログインに失敗しました。通信環境を確認して再試行してください。';
}
