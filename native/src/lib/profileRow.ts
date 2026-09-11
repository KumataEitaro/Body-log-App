// profiles 行の存在保証（QA 2026-09-10 P0-3）。
//
// 事故の形: `profiles` に行が無いユーザー（オンボーディングで「あとで設定」を押した人・
// トリガ導入前に登録した人）は、以後どの保存も `.update().eq('id', uid)` が
// **0行更新 / error === null**（PostgRESTは204を返す）になり、
// アプリは「保存しました。」と表示したまま入力を捨てていた。規約同意も同じ形で、
// terms_version が永遠に null → 起動のたびに再同意ゲートが出る無限ループになる。
//
// 本命の対策はDB側のトリガ（supabase/migration-33.sql の handle_new_user）。
// ここはその適用前・適用漏れの環境でも壊れないためのアプリ側の保険で、
// 認証が確立した時点で1回だけ空行を用意する。両方入れて初めて「行が無い」状態が消える。
import { supabase } from './supabase';

// 同じ起動中に何度も投げない（onAuthStateChange は TOKEN_REFRESHED でも発火する）
let ensuredFor: string | null = null;

/**
 * `profiles` に uid の行が無ければ作る。既にあれば何もしない（既存の値を壊さない）。
 * @returns 行の存在を確認できたら true / 作れなかったら false（呼び出し側は握りつぶしてよい）
 */
export async function ensureProfileRow(uid: string): Promise<boolean> {
  if (!uid) return false;
  if (ensuredFor === uid) return true;
  try {
    // ignoreDuplicates: 既存行があるときは **UPDATE を発行しない**（display_name 等を既定値で潰さない）。
    // onConflict は主キー id。列は id だけ送る＝他の列はDBの default に任せる
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: uid }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) {
      // 握りつぶさない: 失敗が分かる形で返す（呼び出し側が再試行・記録の判断をできるように）
      console.warn('[profileRow] profiles行を用意できませんでした:', error.message);
      return false;
    }
    ensuredFor = uid;
    return true;
  } catch (e) {
    console.warn('[profileRow] profiles行の用意で例外:', String((e as Error)?.message ?? e));
    return false;
  }
}

/** サインアウト時に呼ぶ。次のユーザーで作り直せるようにする */
export function resetProfileRowCache(): void {
  ensuredFor = null;
}
