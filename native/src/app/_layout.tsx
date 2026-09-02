// ルートレイアウト: 認証ゲート（未ログイン→/login）＋スタック
import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '@/lib/supabase';
import { LaunchProvider } from '@/components/LaunchIntro';
import { loadLocale, useLocale, t } from '@/lib/i18n';
import { loadUnits } from '@/lib/units';
import { loadTheme, useTheme } from '@/lib/theme';
import { setLocaleChangeHandler } from '@/lib/i18n';
import { C, themeGeneration } from '@/lib/ui';
import { loadAvatar } from '@/lib/avatar';
import { loadFoodFreq } from '@/lib/foods';
import { loadPurpose } from '@/lib/purpose';
import { reregisterAll, attachNotificationTapRouting } from '@/lib/notify';
import { Linking } from 'react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import { GuideProvider } from '@/components/GuideTour';
import ReconsentGate from '@/components/ReconsentGate';
import { installCrashReporter } from '@/lib/crash';
import { loadRemoteContentCache, startRemoteContentSync } from '@/lib/remoteContent';

installCrashReporter();   // 未捕捉例外を自前のcrash_reportsへ（モジュール読込時に一度だけ）

export default function RootLayout() {
  useEffect(() => { setLocaleChangeHandler(reregisterAll); }, []);
  // リモートコンテンツ（読み物・バッジ・法則の文言）: まず前回のキャッシュで即時に反映し、
  // 認証が確立したら remote_content を読み直す（RLSが認証ユーザー限定のため）＋24時間ごと
  useEffect(() => { loadRemoteContentCache(); }, []);
  // 通知タップ→クイック入力（bodylog://log?quick=1）
  useEffect(() => attachNotificationTapRouting((url) => { Linking.openURL(url).catch(() => {}); }), []);
  useEffect(() => { loadAvatar(); }, []);   // 保存済みのアイコンを反映
  useEffect(() => { loadFoodFreq(); loadPurpose(); }, []); // よく使う順の実績＋ダイエット目的
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const locale = useLocale();
  const theme = useTheme(); // 言語を変えたらkeyでツリーごと作り直す
  const router = useRouter();
  const segments = useSegments();

  // 言語・単位の設定を起動時に読み込む（未設定なら端末言語に追従）
  useEffect(() => { loadLocale(); loadUnits(); loadTheme(); }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, session) => setAuthed(!!session));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const inLogin = segments[0] === 'login';
    if (!authed && !inLogin) router.replace('/login');
    else if (authed && inLogin) router.replace('/(tabs)/log');
  }, [ready, authed, segments, router]);

  // 起動ごとに通知を組み直す（smartの単発14日ぶんの補充を兼ねる）。
  // 「今日すでに記録があるか」をRLS越しに見るため、認証が確立してから
  useEffect(() => { if (ready && authed) reregisterAll(); }, [ready, authed]);
  useEffect(() => { if (ready && authed) startRemoteContentSync(); }, [ready, authed]);

  return (
    // 描画中の例外でアプリごと落ちるのを防ぐ最後の受け皿
    <ErrorBoundary name={t('アプリ')}>
      <LaunchProvider ready={ready}>
        {/* ダーク時は白文字のステータスバー */}
        <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
        {/* GuideProviderはルートに置く（設定画面がタブ外に出たため、タブ内限定だとuseGuideが届かない） */}
        <GuideProvider>
          {/* テーマ世代（themeGeneration）をキーに含める。アクセント・背景トーン・明暗の
              どれが変わってもパレット差し替え＝世代更新なので、条件を数え上げる必要がない。
              P/F/Cの配色はパレットとは独立した設定なので別途キーに含める */}
          <Stack key={`${locale}-g${themeGeneration()}-${theme.pfc.p}${theme.pfc.f}${theme.pfc.c}`} screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: C.bg },
            // ヘッダー（設定などタブ外のスタック画面）もテーマに追従させる。
            // 既定のナビゲーションテーマはライト固定で、ダークだと『戻る』の下に
            // 白い帯が残っていた（βフィードバック 2026-09-01）
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.teal,
            headerTitleStyle: { color: C.ink },
            headerShadowVisible: false,
          }} />
        </GuideProvider>
        {/* 規約改定時の再同意ゲート。認証済みのときだけ判定が走る（lib/consent.ts）。
            ルートに置くのは、どの画面からでも必ず表示させるため */}
        {authed && <ReconsentGate />}
      </LaunchProvider>
    </ErrorBoundary>
  );
}
