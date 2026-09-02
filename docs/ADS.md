> **状態（2026-09-02）**: 実IDは登録・埋め込み済み（アプリID2種=app.json、バナーユニット2種=AdBanner.tsx内蔵・envで上書き可）。
> 残りタスクはAdMobの支払い情報・税務情報の登録のみ。開発ビルド(__DEV__)は自動でテストIDを使う。

# 広告（AdMob）の実装と、公開までに必要な手順

2026-09-01（feat/ads）実装。無料プラン向け**アンカー型アダプティブバナー**のみ。
インタースティシャル・リワード・ネイティブ広告は使わない（L4=優しさ思想を壊さない）。

## いま何がどう動くか（コード側・対応済み）

- SDK: `react-native-google-mobile-ads`（Expo config plugin対応）
- 表示条件: `useGate()` が **active（=RCキー設定済みの課金有効ビルド）かつ plan が null/'free'**
  のときだけ表示。**現在の運用（RCキー未設定）では誰にも表示されない**。
  課金を解放するビルド（RCキー設定）と同時に広告も点灯する＝
  「ライト¥300の『広告なし』に実体がある」状態が仕組みで保証される（RELEASE-RISKS A1対策）
- 配置: **各タブに1枠**（2026-09-02 feat/ads-all-tabs で食事タブのみ→全タブへ拡張）。
  1画面に最大1枠。詳細ページ・法則記事・設定には置かない。枠一覧は下の節
- ATT: **初回リリースは非パーソナライズ広告（NPA）固定**。ATTダイアログは出さず、
  `requestNonPersonalizedAdsOnly: true` を全リクエストに付与、
  plugin側も `delayAppMeasurementInit: true`（安全側）。パーソナライズ化は将来の改善
- 広告の下に「ライトプランで広告を消せます」→ `/paywall?src=ads` の導線つき
- 読み込み失敗・Expo Go・モジュール無し環境では高さ0（空白の枠を見せない）

## 枠一覧（タブ・位置・ユニット）

部品は3層: `components/AdSlot.tsx`（いつ出す・どう消える）→ `components/AdBannerView.tsx`
（ラベル＋導線＋BannerAd 本体・ユニットID）→ AdMob SDK。純関数は `lib/ads.ts`。
食事タブの既存 `<AdBanner/>`（components/AdBanner.tsx）は `AdSlot placement='log'` への互換シム。

| placement | タブ | 位置（配置理由） | 使用ユニット |
|---|---|---|---|
| `log` | 食事 | 「今日の記録」カードの直下（記録フィードと補助カードの境目） | banner-ios / banner-android（共用） |
| `training` | 運動 | 「きょうの動き」カードの直下＝閲覧領域と記録カード群の境目。記録ボタンの直上には置かない（誤タップ防止）。カードを隠している人はフッター先頭へ退避 | 同上 |
| `coach` | 相談 | 会話リストの最上部（compact）。入力ドックから最も遠い＝送信の誤タップにならない。ウェルカム画面でも最上部。返答で scrollToEnd すると一緒に流れる | 同上 |
| `changes` | 概要 | 「からだ」セクションと「食事」セクションの間（食事の見出しと一体で描く）。統合詳細ページには置かない | 同上 |

- 並び替え（編集）中はどのタブでも非表示（ドラッグの座標計算と視界を邪魔しない）
- 置かない場所: 概要の統合詳細・法則図鑑/法則記事・設定・ペイウォール・オンボーディング
  （読み物と課金導線の妨げになる。審査上も「コンテンツより広告が目立つ」を避ける）
- 「スタンダードプランで広告を消せます」→ `/paywall?src=ads` は全枠共通
- **AdMob 側のユニットは当面1つ共用**（iOS/Android で1つずつ）。placement はアプリ側の
  区別＝計測とユニット分割の準備であり、AdMob に新ユニットを作る必要はいまは無い

## 課金で「きれいに消える」仕組み

1. **表示可否**は `lib/ads.ts` の `shouldShowAd(active, plan)`＝active（RCキー設定ビルド）×
   plan が null/'free'。lite/standard/premium は出さない（既存ライト購入者にも出さない）
2. **状態遷移**は `nextAdSlotState`（hidden → loading → shown → collapsing → hidden）。
   - 見えている枠（shown）が対象外になった瞬間（課金完了）→ `collapsing`：Reanimated の
     `withTiming` で高さを実測値→0（`AD_COLLAPSE_MS`=180ms・`Easing.out(cubic)`）、下余白
     （12 / compact 8）も同じカーブで縮める。終わったら unmount。下のカードが跳ねない
   - 読み込み前（loading）に対象外になったら、高さを持っていないので即 hidden
   - 読み込み失敗は即 hidden（表示後の再読み込み失敗は畳んで消す）
   - 「視差効果を減らす」ON（`useReduceMotion`）はアニメ無しで即消す
3. **plan がいつ変わるか**（`lib/gate.ts`）。useGate は `useSyncExternalStore` の購読なので、
   キャッシュが変わった瞬間に全タブの AdSlot と王冠が同時に再判定される
   - **購入直後**: paywall `buy()` → `purchase()`（内部で `getCustomerInfo()` を再取得）→
     `applyEntitlement(newPlan)`：RC entitlement をその場で採用して通知、裏で `refreshGate()`
     が profiles.plan を引き直す。**強い方を採る**（`higherPlan`）ので webhook 未着で
     profiles.plan がまだ free でも戻らない
   - **復元直後**: paywall `doRestore()` → `restore()` → free 以外なら同じ `applyEntitlement`
   - **アプリ再起動**: 最初の useGate マウントで profiles.plan と RC `currentPlan()` を並行取得し
     強い方を採用。RC SDK のキャッシュが効くのでオフラインでも「再起動直後に広告が一瞬出る」
     ことがない。webhook が落ちていても entitlement 側で救われる
   - **クーポン**: 従来どおり `refreshGate()`（サーバー値のみ変わる）
   - jest: `src/lib/__tests__/ads.test.ts`（純関数）と `src/__tests__/adSlot.test.tsx`
     （gate → AdSlot の結合・上記3ケース）

## 将来 placement ごとにユニットを分けるとき

1. AdMob 管理画面で iOS/Android それぞれに「バナー」ユニットを追加（名前は
   `banner-ios-training` のように placement を含める）
2. `components/AdBannerView.tsx` の `bannerUnitId(m, placement)` で placement ごとに ID を
   返す（`PROD_BANNER` を `Record<AdPlacement, {ios, android}>` にする）。呼び出し側の
   変更は不要（AdSlot が placement を渡している）
3. 環境変数で差し替える場合は `EXPO_PUBLIC_ADMOB_BANNER_IOS_<PLACEMENT>` の命名で追加し、
   未設定なら共用IDへフォールバックさせる（片方だけ設定しても壊れないように）
4. 再ビルド（ユニットIDはビルド時に焼き込まれる）
5. 分ける動機は「枠ごとの eCPM/表示率を見たい」ときだけ。分けなくても placement は
   コード上で区別できているので、計測だけなら AdMob のカスタムイベントより先に
   自前ログ（analytics）に placement を送る方が安い

## ID は2種類ある（混同注意）

| 種類 | 形式 | どこに設定するか |
|---|---|---|
| **App ID**（アプリごと・iOS/Android別） | `ca-app-pub-XXXX~YYYY`（チルダ） | `native/app.json` の plugin 設定（要再ビルド） |
| **広告ユニットID**（バナーごと） | `ca-app-pub-XXXX/YYYY`（スラッシュ） | Codemagic 環境変数（要再ビルド） |

現在は **どちらもGoogle公式のテストIDが仮置き**されている:

- App ID（app.json）: iOS `ca-app-pub-3940256099942544~1458002511` / Android `~3347511713`
- バナーユニットID: 環境変数未設定のためコードが `TestIds.ADAPTIVE_BANNER` にフォールバック

**テストIDのままでも広告の表示・レイアウト確認は完全にできる**（「Test Ad」ラベル付きの
本物の広告が出る）。収益が発生しないだけなので、実ID取得前にTestFlightで見た目の確認が可能。

## 熊田さんの手順（実IDへの差し替え）

1. **AdMobアカウント作成** — https://admob.google.com （Googleアカウントで無料。
   支払い情報は収益発生後でOK）
2. **アプリを2つ登録** — AdMob管理画面「アプリ」→「アプリを追加」。
   iOS用とAndroid用で別々に登録する。ストア未公開でも
   「アプリはストアに掲載されていますか？→いいえ」で**手動登録**できる
   （公開後にストアと紐付け直せる）
3. **App ID×2 を app.json へ** — 各アプリの「アプリ設定」に出る
   `ca-app-pub-…~…`（チルダ形式）を `native/app.json` →
   `plugins` → `react-native-google-mobile-ads` の `iosAppId` / `androidAppId` に差し替え
4. **バナー広告ユニットを作成** — 各アプリで「広告ユニット」→「バナー」を1つずつ作成。
   出てきた `ca-app-pub-…/…`（スラッシュ形式）を **Codemagic の環境変数**へ:
   - `EXPO_PUBLIC_ADMOB_BANNER_IOS`（iOSアプリのバナーユニットID）
   - `EXPO_PUBLIC_ADMOB_BANNER_ANDROID`（AndroidアプリのバナーユニットID）
5. **再ビルド** — App ID・環境変数はどちらもビルド時に焼き込まれるため、
   差し替え後は必ず再ビルド（capability変更なし＝Codemagicの自動署名でそのまま通る）

## 注意（アカウント停止事由）

- **実IDの広告を自分でタップしない**（テスト目的でも不可）。動作確認はテストIDで行うか、
  AdMob管理画面で自分の端末を「テストデバイス」に登録してから行う
- 実IDに差し替えた直後は「広告在庫の準備中」で数時間〜数日出ないことがある（正常）

## 将来の改善候補（今はやらない）

- ATT許諾を取ってパーソナライズ広告化（eCPM向上）。app.json に
  `userTrackingUsageDescription` を追加し、許諾結果で NPA を出し分ける
- GDPR圏向けの同意フォーム（UMP SDK）。NPA固定の間は不要側に倒している
