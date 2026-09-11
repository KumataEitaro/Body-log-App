// 規約・プライバシーポリシーの同意バージョン管理（migration-27）。
//
// 規約を改定したら、この TERMS_VERSION を上げる。既存ユーザーは次回起動時に
// 全画面の再同意シートが出て、同意するまで先へ進めない（閉じる手段は「ログアウト」だけ）。
// 「告知しただけ」では米国で同意の成立を争われうるため、明示同意を取り直す。
//
// 運用ルール:
//  - app/terms/page.tsx または app/privacy/page.tsx の実質的な変更 → 必ずここを上げる
//  - 誤字修正・表現の微修正だけなら上げない（無用な再同意はUXを損なう）
//  - 上げるときは docs/LEGAL.md の改定履歴にも1行残す
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

/** 現在の規約バージョン。規約本文を実質的に変えたら必ず更新する */
export const TERMS_VERSION = '2026-09-01';

const LOCAL_KEY = 'bl-terms-version';   // オフライン時のフォールバック

/**
 * 同意ゲートの出し方（QA 2026-09-10 P1-2）。
 *  false      : 出さない（同意済み・未ログイン・判定不能）
 *  'initial'  : **初回の同意**。terms_version が null＝この規約にまだ一度も同意していない
 *  'update'   : **改定の再同意**。過去に別バージョンへ同意済み
 *
 * 以前は両方 true で返していたため、登録した直後の人にまで
 * 「利用規約を**更新**しました」＋「主な変更点」が全画面で出ていた（法務文言として誤り）。
 */
export type ReconsentMode = false | 'initial' | 'update';

/** 同意ゲートが要るか。列が無い/通信できない場合は false（＝出さない。誤爆で全員を止めない） */
export async function needsReconsent(): Promise<ReconsentMode> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return false;   // 未ログインは登録画面の同意表示に任せる

    const { data, error } = await supabase
      .from('profiles').select('terms_version').eq('id', uid).maybeSingle();
    if (error) {
      // 列が無い（migration未適用）等。端末側の記録だけで判断する。
      // 端末に記録が無い＝この端末で一度も同意していないが、DBも読めない以上
      // 「改定」と断定できないので出さない（従来どおり誤爆させない）
      const local = await AsyncStorage.getItem(LOCAL_KEY);
      return local != null && local !== TERMS_VERSION ? 'update' : false;
    }
    const v = (data as { terms_version?: string | null } | null)?.terms_version ?? null;
    // null = この規約にまだ同意していない（新規登録・profiles行が無い）→ 初回として求める
    if (v == null) return 'initial';
    return v !== TERMS_VERSION ? 'update' : false;
  } catch {
    return false;   // 判定できないときは通す（起動不能にしない）
  }
}

/** 同意を記録する。証跡は consent_log に履歴として積む（上書きしない） */
export async function recordConsent(kind: 'terms' | 'privacy' | 'diet' = 'terms'): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return false;
    await AsyncStorage.setItem(LOCAL_KEY, TERMS_VERSION).catch(() => {});
    // 履歴（失敗しても本体は進める）
    await supabase.from('consent_log')
      .insert({ user_id: uid, version: TERMS_VERSION, kind }).then(() => {}, () => {});
    // upsert（update ではない）: profiles 行がまだ無いユーザーだと update は 0行更新・error null で
    // 「成功」に見え、次回起動でまた同意を求める無限ループになっていた（QA P0-3・2026-09-10）
    const { error } = await supabase.from('profiles')
      .upsert({ id: uid, terms_version: TERMS_VERSION, terms_agreed_at: new Date().toISOString() },
              { onConflict: 'id' });
    if (error) {
      // 列が無い環境では端末側の記録だけで運用する（機能を止めない）
      return true;
    }
    return true;
  } catch { return false; }
}
