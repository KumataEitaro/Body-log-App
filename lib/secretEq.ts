// 共有シークレットの比較（QA C-4・2026-09-18）。
//
// `auth !== \`Bearer ${secret}\`` の素の文字列比較は、一致した先頭文字数に応じて処理時間がわずかに変わる
// （タイミング攻撃）。QA ルート・RevenueCat の Webhook・cron の Bearer は全部これで比べる。
// 長さが違うときも同じ時間で false を返す（timingSafeEqual は長さ違いで throw するため先に揃える）。
import { timingSafeEqual } from 'crypto';

/** a と b が同じ文字列か（実行時間が中身に依存しない） */
export function secretEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    // 長さ違いでも比較の時間を揃える（自分自身と比べて捨てる）
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/**
 * Authorization ヘッダが `Bearer <secret>`（または設定次第で素の値）と一致するか。
 * secret が未設定なら常に false（＝ルートを閉じる）。
 */
export function bearerMatches(authHeader: string | null | undefined, secret: string | undefined, allowBare = false): boolean {
  if (!secret) return false;
  const h = authHeader ?? '';
  if (secretEquals(h, `Bearer ${secret}`)) return true;
  return allowBare && secretEquals(h, secret);
}
