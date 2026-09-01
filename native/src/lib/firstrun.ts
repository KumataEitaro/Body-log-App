// 初回体験フラグ（ガイドツアー・オンボーディング・チェックリスト等）の保存層。
//
// 旧実装は AsyncStorage の端末単位キーで、同じ端末で2人目のアカウント
// （Apple連携での作り直し・テスト用・家族）を作るとチュートリアルもオンボも
// 一切始まらないバグの原因だった（βフィードバック 2026-09-02）。
// ここでは「キー:ユーザーid」のユーザー単位キーに変える。
//
// 移行: per-uidキーが無く旧端末キーが残っている場合、旧キーの値を
// 「いま開いているユーザーのもの」として1回だけ引き継ぎ、旧キーは消す。
// （最初に開くのは既存ユーザー本人なので再強制されず、以後の新規アカウントは
//  まっさらな状態から初回体験が始まる）
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

async function currentUid(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? 'anon';
  } catch { return 'anon'; }
}

export async function getFirstRunFlag(base: string): Promise<string | null> {
  try {
    const uid = await currentUid();
    const key = `${base}:${uid}`;
    const v = await AsyncStorage.getItem(key);
    if (v != null) return v;
    const legacy = await AsyncStorage.getItem(base);
    if (legacy != null) {
      await AsyncStorage.setItem(key, legacy).catch(() => {});
      await AsyncStorage.removeItem(base).catch(() => {});
      return legacy;
    }
    return null;
  } catch { return null; }
}

export async function setFirstRunFlag(base: string, value: string): Promise<void> {
  try {
    const uid = await currentUid();
    await AsyncStorage.setItem(`${base}:${uid}`, value);
  } catch { /* 初回体験の記録なので失敗しても致命ではない */ }
}
