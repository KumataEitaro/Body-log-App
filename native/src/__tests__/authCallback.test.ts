// OAuthコールバック解釈の網羅テスト（SSO調査 2026-09-02）
import { parseAuthCallback } from '@/lib/authCallback';

describe('parseAuthCallback', () => {
  it('PKCEのcodeを取り出す', () => {
    expect(parseAuthCallback('bodylog://auth-callback?code=abc123'))
      .toEqual({ kind: 'code', code: 'abc123' });
  });

  it('implicitのトークン対をフラグメントから取り出す', () => {
    const r = parseAuthCallback('bodylog://auth-callback#access_token=AT&refresh_token=RT&token_type=bearer');
    expect(r).toEqual({ kind: 'tokens', access_token: 'AT', refresh_token: 'RT' });
  });

  it('クエリのerror_descriptionをエラーとして返す（+は空白へ）', () => {
    const r = parseAuthCallback('bodylog://auth-callback?error=access_denied&error_description=User+denied');
    expect(r).toEqual({ kind: 'error', message: 'User denied' });
  });

  it('フラグメントのエラー（Supabaseのotp_expired形式）も拾う', () => {
    const r = parseAuthCallback('bodylog://auth-callback#error=server_error&error_description=redirect+mismatch');
    expect(r.kind).toBe('error');
  });

  it('access_tokenだけ（refresh欠落）はnone扱い＝setSessionに不完全な値を渡さない', () => {
    expect(parseAuthCallback('bodylog://auth-callback#access_token=AT').kind).toBe('none');
  });

  it('壊れたURLでも例外を投げずnone', () => {
    expect(parseAuthCallback('not a url').kind).toBe('none');
  });
});
