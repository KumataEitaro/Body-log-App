// ルートレイアウト: 認証ゲート（未ログイン→/login）＋スタック
//
// ■ 起動シーケンスの方針（2026-09-03・Androidの起動クラッシュ対策）
// 起動時の初期化は全部「失敗しても画面は出せる」性質のもの（言語・単位・テーマ・
// アイコン・よく使う順・目的・読み物キャッシュ・通知・ヘルスケア）。1つの失敗で
// レンダリングまで止める理由が無いので、safeBoot() で1つずつ独立に受け止める。
// 失敗は端末内（AsyncStorage 'bl-boot-errors'）に積み、設定画面の最下部から読める。
// 詳しい理由と運用は lib/boot.ts と docs/ANDROID.md「起動クラッシュの調査手順」。
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
// 起床時刻（「朝に出るもの」の窓の起点）。読めなくても既定7:00で判定されるだけなので起動は止めない
import { loadWakeTime } from '@/lib/wakeTime';
import { reregisterAll, attachNotificationTapRouting } from '@/lib/notify';
import { Linking } from 'react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import { GuideProvider } from '@/components/GuideTour';
import ReconsentGate from '@/components/ReconsentGate';
import { installCrashReporter } from '@/lib/crash';
import { loadRemoteContentCache, startRemoteContentSync } from '@/lib/remoteContent';
import { loadHealthLink, startHealthAutoSync } from '@/lib/health';
import { safeBoot, recordBootError, flushBootErrors } from '@/lib/boot';

// 未捕捉例外を自前のcrash_reportsへ（モジュール読込時に一度だけ）。
// これが「最初に、かつ絶対に例外を出さない形で」走ることが重要:
// モジュール評価時に throw するとErrorBoundaryより手前で死ぬため、
// installCrashReporter が内部でtry/catchしていても、ここでもう一段包む
// （将来この行の隣に何か足したときに起動ごと落とさないための構造的な防御）。
try {
  installCrashReporter();
} catch { /* 計測が入らなくてもアプリは動く */ }

// 起動時エラーをcrash_reportsへ送るまでの待ち時間。
// crash.ts の reportCrash は「1分に1件」の連投ガードを持つので、起動直後に
// 本物のクラッシュが起きた場合はそちらに枠を譲る（起動エラーは端末にも残る）
const BOOT_FLUSH_DELAY_MS = 5000;

export default function RootLayout() {
  useEffect(() => { safeBoot('setLocaleChangeHandler', () => setLocaleChangeHandler(reregisterAll)); }, []);
  // リモートコンテンツ（読み物・バッジ・法則の文言）: まず前回のキャッシュで即時に反映し、
  // 認証が確立したら remote_content を読み直す（RLSが認証ユーザー限定のため）＋24時間ごと
  useEffect(() => { safeBoot('loadRemoteContentCache', loadRemoteContentCache); }, []);
  // 通知タップ→クイック入力（bodylog://log?quick=1）。
  // safeBootは戻り値をそのまま返すので、解除関数がそのままuseEffectのcleanupになる
  // （初期化がコケた場合は undefined＝cleanup無しとして扱われる）
  useEffect(() => safeBoot('attachNotificationTapRouting', () => attachNotificationTapRouting(
    (url) => { Linking.openURL(url).catch(() => {}); },
  )), []);
  useEffect(() => { safeBoot('loadAvatar', loadAvatar); }, []);   // 保存済みのアイコンを反映
  // よく使う順の実績＋ダイエット目的。片方がコケてももう片方は走らせる（別々に包む）
  useEffect(() => {
    safeBoot('loadFoodFreq', loadFoodFreq);
    safeBoot('loadPurpose', loadPurpose);
    safeBoot('loadWakeTime', loadWakeTime);
  }, []);
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const locale = useLocale();
  const theme = useTheme(); // 言語を変えたらkeyでツリーごと作り直す
  const router = useRouter();
  const segments = useSegments();

  // 言語・単位・テーマの設定を起動時に読み込む（未設定なら端末言語に追従）。
  // 3つを別々に包むのは、たとえば端末言語の取得（expo-localization）が失敗しても
  // 単位とテーマは読めるようにするため＝1つの失敗で見た目が全部既定に戻らない
  useEffect(() => {
    safeBoot('loadLocale', loadLocale);
    safeBoot('loadUnits', loadUnits);
    safeBoot('loadTheme', loadTheme);
  }, []);
  // ヘルスケア連携フラグ（'bl-health-linked'）を先に読む＝各画面の「連携する」ボタンの出し分けに使う
  useEffect(() => { safeBoot('loadHealthLink', loadHealthLink); }, []);

  // 前回の起動で記録された初期化エラーを、少し落ち着いてからサーバーへ送る
  useEffect(() => {
    const timer = setTimeout(() => { safeBoot('flushBootErrors', flushBootErrors); }, BOOT_FLUSH_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  // 認証だけは「失敗したら画面を出さない」わけにいかないので、
  // 例外時も必ず ready=true にしてログイン画面まで進ませる（無限スプラッシュを作らない）
  useEffect(() => {
    const sub = safeBoot('auth.subscribe', () => {
      supabase.auth.getSession().then(({ data }) => {
        setAuthed(!!data.session);
        setReady(true);
      }, (e: unknown) => {
        recordBootError('auth.getSession', e);
        setReady(true);   // セッションが読めない＝未ログイン扱いでログイン画面へ
      });
      return supabase.auth.onAuthStateChange((_ev, session) => setAuthed(!!session)).data;
    });
    if (!sub) setReady(true);   // 購読すら張れなかった（＝Supabase初期化不良）ときも画面は出す
    return () => { try { sub?.subscription.unsubscribe(); } catch { /* 解除失敗は無視 */ } };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const inLogin = segments[0] === 'login';
    if (!authed && !inLogin) router.replace('/login');
    else if (authed && inLogin) router.replace('/(tabs)/log');
  }, [ready, authed, segments, router]);

  // 起動ごとに通知を組み直す（smartの単発14日ぶんの補充を兼ねる）。
  // 「今日すでに記録があるか」をRLS越しに見るため、認証が確立してから
  useEffect(() => { if (ready && authed) safeBoot('reregisterAll', reregisterAll); }, [ready, authed]);
  useEffect(() => { if (ready && authed) safeBoot('startRemoteContentSync', startRemoteContentSync); }, [ready, authed]);
  // ヘルスケア自動同期: 連携済みなら変更購読＋バックグラウンド配信を開始し、体重の差分を取り込む。
  // 未連携・Android・Expo Go では内部で no-op。バックグラウンド起床（HealthKit配信）でも
  // ここを通るので、起こされた回で体重の取り込みまで済む（通知は出さない）
  useEffect(() => { if (ready && authed) safeBoot('startHealthAutoSync', startHealthAutoSync); }, [ready, authed]);

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
