// app.json はそのまま残し、**環境変数で足すぶんだけ**をここで重ねる（2026-09-17）。
//
// なぜ要るか: app.json は静的なので条件分岐が書けない。
// iOS の Live Activity（ダイナミックアイランドのレスト残り時間）は
//   ・Widget Extension ターゲットが増える
//   ・App Group と3つ目の Bundle ID（…rn.liveactivity）の署名が要る
//   ・拡張ターゲットが全 pod を autolink する既知の問題がある（expo/expo#44695。
//     BodyLog は AdMob / RevenueCat / HealthKit を抱えているので踏む可能性が実在する）
// ＝ **ビルドが落ちうる変更**。既存のホームウィジェット（ENABLE_WIDGET）と同じ流儀で、
// 環境変数を立てたビルドにだけ入れる。**既定のビルドは app.json のままで一切変わらない。**
//
// 使い方: Codemagic の rn-testflight で `ENABLE_LIVE_ACTIVITY=true` を指定して起動する。
// 落ちたら変数を外すだけで元のビルドに戻る（手順の全体は docs/LIVE-ACTIVITY.md）。
// ビルドに Supabase の接続先が埋め込まれることを**ビルドの入口で**保証する（2026-09-21）。
//
// 2026-09-18 に native/.env（EXPO_PUBLIC_* ＝アプリに埋め込まれる公開クライアント設定）を git から外したところ、
// Codemagic / GitHub Actions のクローンに .env が無くなり、TestFlight 1.1.13 は接続先の無いビルドになった
// （画面には「ログインに失敗しました。通信環境を確認してください」しか出ない）。
// アプリ側の起動時記録（lib/supabase.ts）は出ていたが、誰も読まなければ意味がない。
// CI（GitHub Actions / Codemagic はどちらも CI=true を立てる）では、設定が無ければここで**ビルドを落とす**。
// 手元では警告だけ（.env を作る前でも `expo start` は動く）。Expo CLI は app.config.js を読む前に .env を読み込む。
function assertBuildEnv() {
  const missing = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'].filter((k) => !process.env[k]);
  if (missing.length === 0) return;
  const msg = `[app.config] ${missing.join(', ')} が未設定です。native/.env（git 管理・公開クライアント設定）が揃っているか確認してください。`;
  if (process.env.CI === 'true' || process.env.CM_BUILD_ID || process.env.GITHUB_ACTIONS) throw new Error(msg);
  console.warn(msg);
}

module.exports = ({ config }) => {
  assertBuildEnv();
  if (process.env.ENABLE_LIVE_ACTIVITY !== 'true') return config;   // 既定＝従来と完全に同一

  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios.infoPlist,
        // Apple の要件（本体アプリ側に要る）。plugin が足すかどうか明記が無いので自分で書く
        NSSupportsLiveActivities: true,
      },
    },
    plugins: [
      ...config.plugins,
      ['expo-widgets', {
        // 本体 com.gotcha.bodylog.rn の配下に置く（自動署名が前方一致で拾えるように）
        bundleIdentifier: 'com.gotcha.bodylog.rn.liveactivity',
        // ホームウィジェットで作成済みの App Group を再利用する（docs/WIDGET.md 手順1）
        groupIdentifier: 'group.com.gotcha.bodylog.rn',
        // 残り時間は OS が描く（Text timerInterval）ので、更新のプッシュは要らない
        enablePushNotifications: false,
        // Live Activity は widgets[] に書かない（createLiveActivity が実行時に登録する。公式ドキュメントの明記事項）
      }],
    ],
  };
};
