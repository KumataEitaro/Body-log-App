// ブランドの固定色（2026-10-07 熊田さん「前の白地に丸のアイコンに戻したい。紐づく色やイメージをすべて前のアイコンに合わせて再設計」）。
//
// アプリアイコン＝「白地・白い円盤・赤い円弧」（2026-08-17 支給の Single Arc。native/assets/images/icon.png・1024px・完全不透明）。
// ここにあるのは**アイコンと同じ画面に並ぶもの**の色だけ:
//   ・起動画面（ネイティブスプラッシュ app.json / JS オーバーレイ LaunchIntro.tsx）の地
//   ・Android 適応アイコンの地、通知アイコンの色、Web の theme-color
// UI の塗り・文字・選択はこれまでどおり lib/ui.ts の C トークン（テーマのアクセント）を使う。
// 赤をUIのアクセントにしない理由: 超過・警告の意味色（coral）と衝突し、「選ばれている」と「食べすぎ」が同じ色になる。
//
// app.json は TypeScript を読めないので同じ値を手で書く。__tests__/brandAssets.test.ts が app.json・LaunchIntro・画像の同値を見張る。
// 変えるときは app.json（splash / splash.dark / adaptiveIcon / expo-notifications）と app/layout.tsx の themeColor も一緒に。
export const BRAND = {
  /** アイコンの地（純白）。ライトのスプラッシュ背景・Android 適応アイコンの背景・Web theme-color */
  white: '#FFFFFF',
  /** ダークのスプラッシュ背景。theme.ts のダークの地（Dark Navy）と同値 */
  navy: '#0B1220',
  /** 円弧の赤（1024px の実測平均 #F81D3F）。通知アイコンの色・ブランドの強調にだけ使う（白地 4.0:1＝小さい文字には使わない） */
  signal: '#F81D3F',
  /** 円盤の面の色（参考値。UI では使わない） */
  porcelain: '#F1F1F2',
} as const;
