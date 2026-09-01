// 友だち招待（2026-09-02・feat/invite）。
//
// 1500人監査ペイン10位「共有ステッカーを見た友人がアプリに入れられない＝
// バイラル装置の空振り」への対応。ステッカーは「見せる」だけで、そこから
// ダウンロードへ渡す線が無かった。ここでOSの共有シートに招待リンクを流す。
//
// 共有はReact Native標準の Share API を使う（expo-sharingも入っているが、
// あちらはローカルファイルを渡すためのAPIで、テキスト＋URLの共有には使えない）。
import { Platform, Share } from 'react-native';
import { t } from '@/lib/i18n';

// 招待の着地点（Next.js側 app/invite/page.tsx・未ログインで見える）
export const INVITE_URL = 'https://bodylog-orcin.vercel.app/invite';

// ?from= に載せるニックネームの上限。Web側（lib/invite.ts の INVITE_FROM_MAX）と同じ20文字。
// ここで切っておくと、相手の画面で途中から切られて不自然な名前になるのを防げる
const FROM_MAX = 20;

/**
 * 招待リンクを組み立てる。ニックネームは ?from= に載せて
 * 「◯◯さんからの招待です」の表示だけに使われる（Web側で必ず再サニタイズされる）。
 * 空・空白だけならパラメータを付けない（「さんからの招待」が出ない方が自然）。
 */
export function buildInviteUrl(nickname?: string | null): string {
  const nick = (nickname ?? '').replace(/\s+/g, ' ').trim().slice(0, FROM_MAX).trim();
  if (!nick) return INVITE_URL;
  return `${INVITE_URL}?from=${encodeURIComponent(nick)}`;
}

/** 招待の本文（リンクは別で渡すので含めない） */
export function inviteMessage(): string {
  return t('BodyLogerで記録してます。「親子丼たべた」って書くだけでカロリーが出ます。一緒にやりませんか？');
}

/**
 * OSの共有シートを開いて招待リンクを渡す。
 * nicknameを渡さなければプロフィールの表示名を自分で読む（取れなければ名前なしで続行）。
 * ユーザーがキャンセルしても例外を投げない（共有は失敗しても困らない操作）。
 */
export async function shareInvite(nickname?: string | null): Promise<void> {
  let nick = nickname ?? '';
  if (!nick.trim()) {
    // 呼び出し側が表示名を持っていない場合だけ問い合わせる（実績ページなど）。
    // supabaseは動的importにしている: このモジュールを読むだけで
    // Supabaseクライアント（＝環境変数と永続ストレージ）を起こさないため
    // （リンク組み立ての単体テストが接続なしで走る）
    try {
      const { supabase } = await import('@/lib/supabase');
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (uid) {
        const { data } = await supabase.from('profiles').select('display_name').eq('id', uid).maybeSingle();
        nick = (data?.display_name as string | null) ?? '';
      }
    } catch { /* 名前が取れなくても招待は成立する */ }
  }
  const url = buildInviteUrl(nick);
  const message = inviteMessage();
  try {
    // iOS: messageとurlを分けて渡すとリンクプレビューが出る。
    // Android: urlは無視されるため本文に連結する
    await Share.share(
      Platform.OS === 'ios' ? { message, url } : { message: `${message}\n${url}` },
      { dialogTitle: t('友だちを誘う') },
    );
  } catch { /* キャンセル・共有先が無い等。黙って戻る */ }
}
