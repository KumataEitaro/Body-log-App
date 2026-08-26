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
import { C } from '@/lib/ui';
import { loadAvatar } from '@/lib/avatar';
import { loadFoodFreq } from '@/lib/foods';
import { loadPurpose } from '@/lib/purpose';
import { reregisterAll } from '@/lib/notify';
import ErrorBoundary from '@/components/ErrorBoundary';
import { GuideProvider } from '@/components/GuideTour';
import { installCrashReporter } from '@/lib/crash';

installCrashReporter();   // 未捕捉例外を自前のcrash_reportsへ（モジュール読込時に一度だけ）

export default function RootLayout() {
  useEffect(() => { setLocaleChangeHandler(reregisterAll); }, []);
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

  return (
    // 描画中の例外でアプリごと落ちるのを防ぐ最後の受け皿
    <ErrorBoundary name={t('アプリ')}>
      <LaunchProvider ready={ready}>
        <StatusBar style="dark" />
        {/* GuideProviderはルートに置く（設定画面がタブ外に出たため、タブ内限定だとuseGuideが届かない） */}
        <GuideProvider>
          <Stack key={`${locale}-${theme.accent}-${theme.bg}-${theme.pfc.p}${theme.pfc.f}${theme.pfc.c}`} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }} />
        </GuideProvider>
      </LaunchProvider>
    </ErrorBoundary>
  );
}
