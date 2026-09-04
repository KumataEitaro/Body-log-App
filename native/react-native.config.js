// アプリ側の autolink 設定（Expo の autolinking もこのファイルを読む）。
//
// 【Android 起動クラッシュの再発防止・2026-09-04】
// @kingstinct/react-native-healthkit は iOS 専用（HealthKit）だが、依存の
// react-native-nitro-modules（C++/JSI ライブラリ）は Android にも実装があるため、
// 何も指定しないと **使い手ゼロのまま Android のネイティブにリンクされ、起動時に JSI へ
// 差し込まれる**。iOS で正常・Android だけ一瞬で落ちる、という症状の典型的な形。
// Android では両方を autolink から外す。JS 側は lib/health.ts が Platform で先に切る。
//
// 検証: cd native && npx expo-modules-autolinking react-native-config --platform android --json
//       → dependencies に nitro / healthkit が現れないこと（__tests__/platformSafety.test.ts が見張る）
module.exports = {
  dependencies: {
    'react-native-nitro-modules': { platforms: { android: null } },
    '@kingstinct/react-native-healthkit': { platforms: { android: null } },
  },
};
