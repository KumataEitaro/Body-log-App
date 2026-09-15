# Android 実機限定の不具合監査（2026-09-15）

対象: `9ea34ac`（Android 起動クラッシュの修正）以降に入った全コード。読み取りのみで実施。

## なぜやったか

熊田さんから「**Android でいまだに使えない**」の報告。起動スモーク（#14〜#17）は緑だが、
**それは「起動してログイン画面で12秒プロセスが生きている」ことしか見ていない**。
ログイン後の操作・テーマ切替・回転・復帰は一度も通していなかった。
「落ちないが操作できない」種類の不具合が残っている可能性を潰すために全面監査した。

## 結論

**🔴（起動・ログイン直後に落ちる）は 0 件。** 9ea34ac 以降の新規コードに、Android で確実に起動を壊す欠陥は無い。

根拠として確認済み:
- `native/react-native.config.js` の autolink 除外（nitro-modules / healthkit）は**未変更で健在**
- `9ea34ac..HEAD` で**新しいネイティブ依存はゼロ**（`native/package.json` の差分は jest の `testTimeout` 追加のみ）
- `lib/health.ts:28-36` の `Platform.OS !== 'ios'` は **require より前**（`platformSafety.test.ts` が機械的に見張っている）
- `crash.ts` の未処理 Promise 拒否トラッカーは、RN 0.86 の `polyfillPromise.js`・`HermesInternalType.js`・
  `promise/setimmediate/rejection-tracking.js`・`@expo/metro-runtime` の実装まで読んで**安全と確認**
  （DEV は RN/Expo のトラッカーに譲り、release だけ設置。二重設置にならない）
- `HealthDetail` / `HourlyStepsChart` は Android では `changes.tsx:828-833` の `unavailable` と
  `healthAvailable()` の**二重**で描画されない
- `signOutCleanup` の各段（通知取消・RevenueCat logOut・ウィジェット消去）は Android で例外を投げない
- `Modal` の入れ子は Android では発生しない（`visible=false` の Modal は `render()` が null を返す）
- Hermes 未対応構文（`Array.prototype.at` / `Object.groupBy` / `toSorted` / 後読み正規表現など）は 0 件

## 直したもの（2026-09-15・この監査で修正）

### 🟠 ＋シートの「体重」が Android で永久に固まりうる → `lib/guard.ts`

`confirmOutlierWeight()` の Promise は **ボタンの `onPress` からしか resolve されなかった**。
Android の `Alert` は現在の Activity が取れないと**何も表示せず `console.warn` だけ**で終わり
（ReactAndroid の `DialogModule` → `Libraries/Alert/Alert.js` の errorCallback）、JS には失敗が返らない。
この確認は ＋シート（Modal 表示中）から呼ばれるため、表示に失敗すると
`PlusSheet` の `finally { setBusy(false) }` に到達せず「体重を記録」が押しっぱなしになる。

→ `onDismiss` と 30 秒の保険タイマーを足し、**必ず1回だけ決着する**形にした。
出せなかった場合は「保存しない」に倒す（誤入力の可能性が高い場面なので安全側）。

### 🟠 「同期できなかった記録が N 件」が Android で黙って失われる → `lib/offlineQueue.ts` / `app/_layout.tsx`

`takeDroppedNotice()` は**読んだ時点で控えを削除**していた。その後に出す Alert が
Android で表示に失敗すると、**伝わっていないのに控えだけ消える**（次の起動でも二度と出ない）。

→ `peekDroppedNotice()`（読むだけ）と `clearDroppedNotice()`（消す）に分割。
`_layout.tsx` は `InteractionManager.runAfterInteractions` で**画面が落ち着いてから**出し、
**本人が閉じたことを確認してから**消す。閉じられなければ次の起動でまた出る。

### 🟡 ＋シートを素早く開き直すと、選んでいない行動が後から発火する → `components/PlusSheet.tsx`

`Modal` の `onDismiss` は **Android では発火しない**（RN が "iOS only" と明記）。
Android は 350ms のタイマーだけが「閉じ切ってから行動を渡す」唯一の経路で、
閉じた直後に開き直すと cleanup でタイマーだけ消えて `pending` が残る。
その後 × で閉じると、**選んでいない画面が 350ms 後に勝手に開く**。

→ シートを開くたびに `pending.current = null` にする。

### 🟡 「体の写真を追加」で Android だけ「キャンセル」が主ボタン → `components/BodyPhotosCard.tsx`

Android の `Alert` は**配列の末尾から** positive（右端・強調）→ negative → neutral に割り当てる。
iOS と同じ `[撮影する, 写真から選ぶ, キャンセル]` の順だと「キャンセル」が強調ボタンになっていた。

→ Android 分岐だけ並びを逆にして「撮影する」を右端に置いた。

## 残っている（実機でしか確認できない）

### 🟠 相談タブの入力欄がキーボードに隠れる可能性

`coach.tsx:331` の `KeyboardAvoidingView` は `behavior` が Android で `undefined`＝**何もしない**。
Expo SDK 54+ の Android は edge-to-edge が常時有効で `adjustResize` がウィンドウを縮めず、
さらに expo-router のネイティブタブが `tabBarRespectsIMEInsets` を**既定 false** で渡すため
（`react-native-screens` の `TabsContainer.kt` が IME inset を潰す）、入力欄が隠れうる。

**＋ボタン自体は正しく消える**（`useKeyboardVisible` は Android で `keyboardDidShow` を使う）ので、
問題は入力欄側だけ。**実機で確認してから**直す（Android に `behavior="height"` を与える、
`app.json` に `android.softwareKeyboardLayoutMode: "resize"` を明示、のいずれか）。

### 🟡 ＋ボタン・スナックバーが Android でタブバーから 24〜48dp 余計に浮く

`PlusFab.tsx:45` の `bottom: insets.bottom + 12` は **iOS の前提**で書かれている
（コメントも iOS の挙動しか書いていない）。Android では
expo-router が各タブを `SafeAreaView edges={{bottom:true}}` で包み、その inset の正体は
**タブバーの高さ**（`TabsContainer.kt` の `getInterfaceInsets`）で、screens 側がそれを消費する。
一方 `useSafeAreaInsets()` は別系統でナビゲーションバーの inset を返し続けるため、**二重に空く**。

同じ式が `training.tsx` / `changes.tsx` / `log.tsx` / `coach.tsx` の下端余白にも使われている。
直すなら下端オフセットを1つの関数に集約する。**見た目の問題なので実機で程度を見てから**。

## 実機で確認してほしい順（Android・できれば3ボタンナビの端末）

1. ＋ →「体重」→ 前回比 ±15% 超の値 → 「体重を記録」が固まらないか
2. 相談タブで入力欄をタップ → 入力欄と送信ボタンが見えるか
3. ＋ →「食事を記録」→ 0.3 秒以内に ＋ を押し直す → × で閉じる → 勝手に食事入力が開かないか
4. 4タブの ＋ とタブバーの隙間が iOS と比べて広すぎないか
5. ＋ →「体の写真」→ ダイアログの右端が「撮影する」になっているか
