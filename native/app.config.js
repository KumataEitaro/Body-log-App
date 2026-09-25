// app.json はそのまま残し、**環境変数で変えるぶんだけ**をここで重ねる（2026-09-17）。
//
// なぜ要るか: app.json は静的なので条件分岐が書けない。
//
// 【Live Activity（ダイナミックアイランドのレスト残り時間）は iOS ビルドの既定で入る（2026-09-25〜）】
// 熊田さん「筋トレのレストタイマーの通知のイメージが違う。ダイナミックアイランドでの通知にして」。
// expo-widgets の config plugin が prebuild で
//   ・Widget Extension ターゲット（ExpoWidgetsTarget・Bundle ID …rn.liveactivity）を足す
//   ・本体の entitlements に App Group、Info.plist に NSSupportsLiveActivities を入れる
//   ・Podfile に拡張用の target を追記する（拡張が link するのは expo / expo-widgets / @expo/ui と
//     React 本体だけ。AdMob / RevenueCat / HealthKit は除外される＝expo-widgets 57 の autolinking.rb）
// ＝ 署名（3つ目の Bundle ID・App Group）が絡む、**ビルドが落ちうる変更**。
//
// 【戻し方】Codemagic の環境変数に **DISABLE_LIVE_ACTIVITY=true** を足すだけで、
// この関数は app.json を**1文字も変えずに**返す＝Live Activity 導入前のビルドに即戻る。
// codemagic.yaml の関連ステップも同じ変数で止まる。手順の全体は docs/LIVE-ACTIVITY.md。
// （2026-09-17〜24 の ENABLE_LIVE_ACTIVITY=true は廃止。付けても何も起きない）
//
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
  // 退避スイッチ。true のときだけ app.json を同一オブジェクトのまま返す（＝拡張もplistも一切足さない）
  if (process.env.DISABLE_LIVE_ACTIVITY === 'true') return config;

  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios.infoPlist,
        // Apple の要件（本体アプリ側に要る）。plugin も同じ値を書くが、意図を明示するため自分でも書く
        NSSupportsLiveActivities: true,
      },
    },
    plugins: [
      ...config.plugins,
      ['expo-widgets', {
        // 本体 com.gotcha.bodylog.rn の配下に置く（自動署名が前方一致で拾えるように）
        bundleIdentifier: 'com.gotcha.bodylog.rn.liveactivity',
        // ホームウィジェット（docs/WIDGET.md）と同じ App Group。拡張は島に出す見た目（'widget' 関数の
        // 出力）をこの App Group の UserDefaults から読むので、Live Activity でも App Group は必須
        groupIdentifier: 'group.com.gotcha.bodylog.rn',
        // 残り時間は OS が描く（Text timerInterval）ので、更新のプッシュは要らない
        enablePushNotifications: false,
        // Live Activity は widgets[] に書かない（createLiveActivity が実行時に登録する。公式ドキュメントの明記事項）
        // Android には Live Activity 相当が無い（enableAndroid は既定 false のまま＝Android ビルドは無変更）
      }],
    ],
  };
};
