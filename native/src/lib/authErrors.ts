// ログイン／新規登録の失敗理由 → 利用者向けの一文（純関数・2026-09-21）。
//
// 【背景】TestFlight 1.1.13 は Supabase の接続先が埋め込まれていないビルドだったが、画面には
// 「ログインに失敗しました。通信環境を確認してください。」しか出ず、電波があるのに直しようがなかった。
// 失敗の理由を全部「通信」に丸めると、設定不備・パスワード違い・メール未確認・回数制限のどれなのか
// 本人にも開発者にも分からない。「通信」と言うのは本当に通信が失敗したときだけにし、
// それ以外は理由を短く添える（Google ログインの error 分岐と同じ流儀）。
//
// 【列挙攻撃への配慮】「未登録」と「パスワード違い」は Supabase が区別して返さない（Invalid login credentials）。
// ここでもその区別はしない。新規登録への導線（signupHint）を添えるだけ。
import { t } from './i18n';

export type AuthKind = 'login' | 'signup';
export type AuthErrorLike = { message?: string | null; status?: number | null; name?: string | null } | string | null | undefined;

export type AuthMessage = {
  text: string;
  /** ログイン失敗時に「初めての方は新規登録へ」を出す */
  signupHint?: boolean;
};

/** 接続先がビルドに入っていないときの文（ログイン画面に常時出す。設定画面の起動時エラー記録にも同じ原因が残る） */
export function configMissingMessage(): string {
  return t('このビルドにはサーバーの接続先が入っていません。開発者向け: EXPO_PUBLIC_SUPABASE_URL の埋め込みを確認してください。');
}

function messageOf(err: AuthErrorLike): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  return String(err.message ?? '');
}

/** 通信そのものの失敗か（supabase-js は fetch 失敗を AuthRetryableFetchError で返す） */
export function isNetworkAuthError(err: AuthErrorLike): boolean {
  if (err == null || typeof err === 'string') return /network request failed|failed to fetch|fetch failed|networkerror|timed? ?out|ECONN|ENOTFOUND|could not connect/i.test(messageOf(err));
  if (err.name === 'AuthRetryableFetchError') return true;
  if (err.status === 0) return true;
  return /network request failed|failed to fetch|fetch failed|networkerror|timed? ?out|ECONN|ENOTFOUND|could not connect/i.test(messageOf(err));
}

/**
 * 失敗理由を利用者向けの一文にする。
 * @param configured 接続先がビルドに入っているか（lib/supabase.ts SUPABASE_CONFIGURED）。false なら理由を問わず設定不備の文
 */
export function authErrorMessage(err: AuthErrorLike, kind: AuthKind, configured = true): AuthMessage {
  if (!configured) return { text: configMissingMessage() };
  const m = messageOf(err);
  const status = typeof err === 'object' && err != null ? err.status ?? null : null;

  if (/invalid login/i.test(m)) return { text: t('メールまたはパスワードが違います。'), signupHint: kind === 'login' };
  if (/email not confirmed/i.test(m)) {
    return { text: t('メールアドレスの確認が済んでいません。届いた確認メールのリンクを開いてから、もう一度ログインしてください。') };
  }
  if (kind === 'signup' && /already registered|already been registered|user already exists/i.test(m)) {
    return { text: t('このメールアドレスは登録済みです。ログインしてください。') };
  }
  if (status === 429 || /rate limit|too many requests/i.test(m)) {
    return { text: t('試行が多すぎます。しばらく待ってからもう一度お試しください。') };
  }
  if (isNetworkAuthError(err)) {
    return { text: kind === 'login' ? t('ログインに失敗しました。通信環境を確認してください。') : t('登録に失敗しました。通信環境を確認してください。') };
  }
  if (kind === 'signup' && /password/i.test(m) && /short|at least|weak|characters/i.test(m)) {
    return { text: t('パスワードは8文字以上にしてください。') };
  }
  if (kind === 'signup' && /invalid|unable to validate/i.test(m)) return { text: t('メールアドレスの形式を確認してください。') };

  const reason = m.trim().slice(0, 120) || t('不明なエラー');
  return { text: kind === 'login' ? t('ログインに失敗しました: {reason}', { reason }) : t('登録に失敗しました: {reason}', { reason }) };
}
