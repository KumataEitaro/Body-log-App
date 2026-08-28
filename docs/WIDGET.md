# ホーム画面ウィジェット（B-9・RN版・試験導入）

iOSホーム画面の小サイズウィジェットに「あと {n} kcal」＋🔥連続記録日数を表示する。

## 大原則（署名事故の防止）

**ウィジェットは `ENABLE_WIDGET=true` を設定したCodemagicビルドにだけ組み込まれる。**
環境変数が未設定（既定）のビルドは従来と完全に同一:

- ウィジェット拡張ターゲットは注入されない（`scripts/add-widget-target-rn.rb` が走らない）
- 本体アプリにApp Group entitlementは付かない（署名プロファイルの不一致が起きない）
- JS側の書き出しコード（`native/src/lib/widget.ts`）は動くが、App Groupが無い環境では
  Swift側（`native/modules/widget-bridge/`）が安全にno-opになる

ビルドが失敗したら **ENABLE_WIDGET を外す（または true 以外にする）だけで従来ビルドに即戻る。**

## 構成

| 置き場所 | 役割 |
| --- | --- |
| `native/modules/widget-bridge/` | ローカルExpoモジュール。JSON文字列を App Group `group.com.gotcha.bodylog.rn` の UserDefaults（キー `bl-widget`）へ保存し、WidgetCenterへ再読込を依頼。常にビルドに含まれるがApp Groupが無ければno-op |
| `native/src/lib/widget.ts` | 今日サマリー（残りkcal=dayStatus・🔥=quickStreak）をJSON化してbridgeへ。`lib/sync.ts` の `syncEntriesForDate` 末尾から投げっぱなしで呼ばれる |
| `native/widget/` | ウィジェット本体（SwiftUI・`BodyLogWidget.swift`）とInfo.plist・entitlements。リポジトリに静置 |
| `scripts/add-widget-target-rn.rb` | prebuild後の `native/ios/BodyLog.xcodeproj` に拡張ターゲット（`com.gotcha.bodylog.rn.widget`）を注入。CIでのみ実行 |
| `codemagic.yaml` rn-testflight | 「Add widget extension target」ステップ（ENABLE_WIDGET=trueのみ動く）。本体entitlementsへのApp Group注入＋rubyスクリプト実行 |

## 有効化手順

1. **Apple Developer portalでApp Groupを作成**
   - Certificates, Identifiers & Profiles → Identifiers → App Groups で
     `group.com.gotcha.bodylog.rn` を作成
   - App ID `com.gotcha.bodylog.rn` の capability に App Groups を追加し、上記グループを紐付け
2. **ウィジェット用App ID**
   - `com.gotcha.bodylog.rn.widget` のApp IDを作成し、同じApp Groupを紐付け
   - 注: CodemagicのASC APIキー連携（自動署名）はビルド時にApp IDと配布プロファイルを
     自動作成できるため手動作成は不要なことが多い。ただしApp Groups capabilityの紐付けは
     自動では行われないので、ビルド後にポータルで確認し、必要なら手動で付けて再ビルドする
3. **Codemagicで試験ビルド**
   - rn-testflight を Start new build → 環境変数に `ENABLE_WIDGET=true` を設定して実行
     （workflowのvarsには書かない。UIから都度指定することで既定ビルドを不変に保つ）
4. **失敗したら**
   - `ENABLE_WIDGET` を外して再ビルド → 従来と完全に同一のビルドに即戻る
   - よくある失敗: プロファイルに App Groups が無い（手順1-2の紐付け漏れ）。
     Codemagicのプロファイルは古いままキャッシュされることがあるので、
     ポータルでcapabilityを変えたら該当プロファイルを削除して自動再生成させる

## データの流れ

```
保存（食事/体重/運動/取込のどれでも）
  → lib/sync.ts syncEntriesForDate（全保存経路の合流点）
  → lib/widget.ts updateWidgetData（dayStatus＋quickStreak → JSON）
  → modules/widget-bridge setWidgetData（App Group UserDefaults "bl-widget"）
  → WidgetCenter.reloadAllTimelines
  → native/widget/BodyLogWidget.swift が読んで描画（翌日0時にも自動再評価）
```

表示ルール（小サイズのみ）:
- 今日のデータあり: 「あと {n} kcal」（オーバー時は赤で「オーバー {n} kcal」）＋🔥{streak}日
- データ無し・日付が古い: 「BodyLogを開いて記録」（ストリークが分かるときは添える）
- 文言はSwift側の静的な日本語固定（i18n対象外・試験導入のため）

## 制約・注意

- SwiftはローカルでコンパイルできないためCIビルドが唯一の検証手段。
  `BodyLogWidget.swift` はWidgetKit基本形のみで書き、iOS17専用APIは `#available` で保護している
- `quickStreak` は5分キャッシュのため、保存直後の🔥表示は最大1日遅れることがある（仕様）
- Android用ウィジェットは未実装（`expo-module.config.json` が apple のみのためAndroidでは完全no-op）
