// ログイン失敗の文言（lib/authErrors.ts）。「通信環境を確認」を通信以外の失敗に使わない（2026-09-21・TestFlight 1.1.13 の教訓）
import { authErrorMessage, configMissingMessage, isNetworkAuthError } from '../authErrors';

describe('authErrorMessage', () => {
  it('接続先が無いビルドでは、理由を問わず設定不備の文（「通信環境」とは言わない）', () => {
    const r = authErrorMessage({ message: 'fetch failed' }, 'login', false);
    expect(r.text).toBe(configMissingMessage());
    expect(r.text).not.toContain('通信環境');
    expect(r.text).toContain('EXPO_PUBLIC_SUPABASE_URL');
  });

  it('パスワード違いは区別せず、ログインでは新規登録への導線を添える', () => {
    const r = authErrorMessage({ message: 'Invalid login credentials', status: 400 }, 'login');
    expect(r.text).toBe('メールまたはパスワードが違います。');
    expect(r.signupHint).toBe(true);
  });

  it('メール未確認・回数制限は理由が分かる文', () => {
    expect(authErrorMessage({ message: 'Email not confirmed' }, 'login').text).toContain('確認メール');
    expect(authErrorMessage({ message: 'Request rate limit reached', status: 429 }, 'login').text).toContain('しばらく待って');
    expect(authErrorMessage({ message: 'x', status: 429 }, 'signup').text).toContain('しばらく待って');
  });

  it('通信の失敗だけ「通信環境を確認」と言う', () => {
    expect(authErrorMessage({ name: 'AuthRetryableFetchError', message: 'Network request failed', status: 0 }, 'login').text)
      .toBe('ログインに失敗しました。通信環境を確認してください。');
    expect(authErrorMessage(new TypeError('Network request failed'), 'signup').text)
      .toBe('登録に失敗しました。通信環境を確認してください。');
    expect(isNetworkAuthError({ message: 'fetch failed' })).toBe(true);
    expect(isNetworkAuthError({ message: 'Invalid login credentials' })).toBe(false);
  });

  it('それ以外は理由を短く添える（120文字まで・空なら「不明なエラー」）', () => {
    const r = authErrorMessage({ message: 'Database error saving new user' }, 'login');
    expect(r.text).toBe('ログインに失敗しました: Database error saving new user');
    expect(authErrorMessage({ message: '' }, 'login').text).toBe('ログインに失敗しました: 不明なエラー');
    expect(authErrorMessage(null, 'signup').text).toBe('登録に失敗しました: 不明なエラー');
    const long = authErrorMessage({ message: 'x'.repeat(300) }, 'login').text;
    expect(long.length).toBeLessThan(160);
  });

  it('新規登録: 登録済み・形式不正・短いパスワード', () => {
    expect(authErrorMessage({ message: 'User already registered' }, 'signup').text).toContain('登録済み');
    expect(authErrorMessage({ message: 'Unable to validate email address: invalid format' }, 'signup').text).toContain('形式');
    expect(authErrorMessage({ message: 'Password should be at least 6 characters' }, 'signup').text).toContain('8文字以上');
  });
});
