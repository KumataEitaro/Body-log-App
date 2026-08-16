import type { CapacitorConfig } from '@capacitor/cli';

// BodyLog iOSネイティブシェル。
// WebViewで本番サイトを直接読み込む構成のため、機能更新はWebのデプロイだけで即反映される
// （App Storeの再審査なしで中身を更新できる）。
const config: CapacitorConfig = {
  appId: 'com.gotcha.bodylog',
  appName: 'BodyLog',
  webDir: 'native-shell',
  server: {
    url: 'https://bodylog-orcin.vercel.app',
    cleartext: false,
  },
  ios: {
    // セーフエリアはCSSのenv(safe-area-inset-*)で処理する（globals.cssの--sa-t/--sa-b）。
    // 'always'はネイティブ側の余白が二重管理になり、キーボード後にinsetが狂ったまま残る
    // 「タブバーが浮く・上に空白」バグの発生源だったため'never'に変更（2026-08-09）
    contentInset: 'never',
    backgroundColor: '#f8fafc',
    // Service Worker（オフラインキャッシュ）をWKWebViewで有効化するために必要
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1000,
      backgroundColor: '#f8fafc',
      launchAutoHide: true,
    },
    Keyboard: {
      // キーボード表示時のWebView縮小方式。閉じた後の復元はViewportFix+keyboardDidHideで矯正
      resize: 'native',
    },
    LocalNotifications: {
      // アプリを開いている間もバナー・通知センター・サウンド・バッジで通知を出す
      // （iOSはこの指定が無いとフォアグラウンド中の通知が画面に出ない）
      presentationOptions: ['alert', 'sound', 'badge'],
    },
  },
};

export default config;
