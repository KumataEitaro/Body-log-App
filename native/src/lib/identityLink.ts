// ログイン方法の追加（2026-09-16）。
//
// なぜ要るか:
//   メール＋パスワードだけで登録した人は、パスワードを忘れた瞬間に入り口が1つも無くなる。
//   再設定メール（lib/login の「パスワードをお忘れですか？」）は復旧の本線だが、
//   **登録したメールアドレス自体が使えなくなる**ことがある（会社のアドレスで登録して退職した等）。
//   Google や Apple を後から紐付けておけば、入り口が2つになり、片方が死んでも入れる。
//
// Supabase 側の前提:
//   ダッシュボードの Authentication → 「Manual linking」を有効にしておく必要がある。
//   無効だと linkIdentity が `manual_linking_disabled` を返す。その場合は
//   ユーザーに「準備中」と伝えて終わる（アプリは壊さない）。
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';
import { parseAuthCallback } from './authCallback';
import { t } from './i18n';

/** OAuth の戻り先。login.tsx と同じスキームを使う */
const OAUTH_REDIRECT = 'bodylog://auth-callback';

export type LinkProvider = 'google' | 'apple';

export type LinkResult =
  | { ok: true }
  | { ok: false; reason: string }
  /** ユーザーが自分で閉じた。エラー表示はしない */
  | { ok: false; cancelled: true; reason: '' };

/** いま紐付いているログイン方法（設定画面の表示に使う） */
export async function listIdentities(): Promise<LinkProvider[]> {
  try {
    const { data, error } = await supabase.auth.getUserIdentities();
    if (error || !data) return [];
    return data.identities
      .map((i) => i.provider)
      .filter((p): p is LinkProvider => p === 'google' || p === 'apple');
  } catch { return []; }
}

/**
 * いまのアカウントに Google / Apple を**追加**する（別アカウントへの切替ではない）。
 *
 * 失敗の理由は握りつぶさずに返す。「押したのに何も起きない」が
 * このアプリで最も避けたい状態だから（ログインまわりで何度も踏んでいる）。
 */
export async function linkProvider(provider: LinkProvider): Promise<LinkResult> {
  if (provider === 'apple' && Platform.OS !== 'ios') {
    return { ok: false, reason: t('Appleでサインインは iOS でのみ追加できます。') };
  }
  try {
    const { data, error } = await supabase.auth.linkIdentity({
      provider,
      options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true },
    });
    if (error || !data?.url) {
      const m = error?.message ?? '';
      if (/manual.?linking|not enabled|disabled/i.test(m)) {
        return { ok: false, reason: t('ログイン方法の追加は準備中です（サーバー側の設定待ち）。') };
      }
      if (/already/i.test(m)) {
        return { ok: false, reason: t('このログイン方法は、すでに別のアカウントで使われています。') };
      }
      return { ok: false, reason: t('追加を開始できませんでした。{reason}', { reason: m.slice(0, 120) }) };
    }
    const res = await WebBrowser.openAuthSessionAsync(data.url, OAUTH_REDIRECT);
    if (res.type !== 'success' || !res.url) return { ok: false, cancelled: true, reason: '' };

    const parsed = parseAuthCallback(res.url);
    switch (parsed.kind) {
      case 'code': {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(parsed.code);
        return exErr
          ? { ok: false, reason: t('追加の完了処理に失敗しました。もう一度お試しください。') }
          : { ok: true };
      }
      case 'tokens':
        // implicit フローで戻ってきた場合。セッションを張り直せば紐付けは完了している
        await supabase.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token });
        return { ok: true };
      case 'error':
        return { ok: false, reason: t('追加に失敗しました: {reason}', { reason: parsed.message.slice(0, 120) }) };
      default:
        return { ok: false, reason: t('追加の完了処理に失敗しました。もう一度お試しください。') };
    }
  } catch (e) {
    return { ok: false, reason: t('追加に失敗しました: {reason}', { reason: String((e as Error)?.message ?? e).slice(0, 120) }) };
  }
}

/** 表示用の名前 */
export function providerLabel(p: LinkProvider): string {
  return p === 'google' ? 'Google' : 'Apple';
}

/**
 * 設定画面の説明文。紐付け済みのものを踏まえて「いまの入り口は何個あるか」を伝える。
 * 入り口が1つしか無い人にだけ、追加を勧める文言を出す（全員に出すと押し売りになる）。
 */
export function linkStatusText(linked: LinkProvider[]): string {
  if (linked.length === 0) {
    return t('いまはメールとパスワードだけです。GoogleかAppleを追加しておくと、パスワードを忘れても入れます。');
  }
  const names = linked.map(providerLabel).join('・');
  return t('追加済み: {names}。パスワードを忘れても、こちらから入れます。', { names });
}
