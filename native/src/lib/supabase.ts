// Supabaseクライアント（React Native版）。セッションはAsyncStorageに永続化。
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { recordBootError } from './boot';

// EXPO_PUBLIC_* はビルド時にバンドルへ埋め込まれる（native/.env）。
// 埋め込みに失敗したビルドでは createClient が「supabaseUrl is required」で throw し、
// それがモジュール評価時＝JSバンドルの読み込み中に起きるため、ErrorBoundaryも
// クラッシュ計測も間に合わず「起動直後に落ちる」形になる（Androidで実際に疑った経路）。
// URLの体裁だけ先に見て、壊れていれば明示的に記録してから無効なクライアントで先へ進む。
// 通信は全部失敗するが、画面は出るので「設定画面の起動時エラー記録」から原因が読める。
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // boot.ts は AsyncStorage だけに依存しており、supabase.ts を import しないので循環しない
  recordBootError(
    'supabase.env',
    `EXPO_PUBLIC_SUPABASE_${!SUPABASE_URL ? 'URL' : 'ANON_KEY'} がビルドに埋め込まれていません`,
  );
}

export const supabase = createClient(
  // createClient自体を throw させないためのプレースホルダ（実在しないホスト）
  SUPABASE_URL || 'https://invalid.invalid',
  SUPABASE_ANON_KEY || 'invalid',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce', // モバイルOAuth（Google SSO等）はコード交換方式が安全
    },
  },
);
