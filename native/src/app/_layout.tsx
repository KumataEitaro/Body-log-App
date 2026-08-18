// ルートレイアウト: 認証ゲート（未ログイン→/login）＋スタック
import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '@/lib/supabase';
import { LaunchProvider } from '@/components/LaunchIntro';
import { loadLocale, useLocale } from '@/lib/i18n';
import { loadUnits } from '@/lib/units';
import { loadTheme, useTheme } from '@/lib/theme';
import { setLocaleChangeHandler } from '@/lib/i18n';
import { reregisterAll } from '@/lib/notify';

export default function RootLayout() {
  useEffect(() => { setLocaleChangeHandler(reregisterAll); }, []);
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
    <LaunchProvider ready={ready}>
      <StatusBar style="dark" />
      <Stack key={`${locale}-${theme.accent}-${theme.pfc}`} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fbfbfa' } }} />
    </LaunchProvider>
  );
}
