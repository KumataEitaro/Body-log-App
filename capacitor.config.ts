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
    contentInset: 'always', // ノッチ・ステータスバーと重ならないように
    backgroundColor: '#0c131c',
  },
};

export default config;
