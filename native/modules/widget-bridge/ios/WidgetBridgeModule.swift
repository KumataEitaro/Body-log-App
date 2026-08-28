import ExpoModulesCore
#if canImport(WidgetKit)
import WidgetKit
#endif

// ホーム画面ウィジェットへのデータ受け渡し口。
// アプリ側で計算した今日サマリー(JSON)を App Group の UserDefaults に置き、
// WidgetKit にタイムライン再読込を依頼するだけの小さなモジュール。
//
// 安全設計（署名事故防止の要）:
//  ・このモジュール自体は常にアプリへ組み込まれるが、App Group entitlement が
//    無いビルドでは UserDefaults(suiteName:) が共有コンテナを掴めないだけで、
//    例外にはならない＝従来ビルドでも安全に何もしない。
//  ・ウィジェット拡張ターゲットは ENABLE_WIDGET=true のCIビルドでのみ注入される。
public class WidgetBridgeModule: Module {
  // App Group ID（native/widget/BodyLogWidget.entitlements・scripts/add-widget-target-rn.rb と揃える）
  private static let suiteName = "group.com.gotcha.bodylog.rn"
  // ウィジェット側（native/widget/BodyLogWidget.swift）が読むキー
  private static let dataKey = "bl-widget"

  public func definition() -> ModuleDefinition {
    Name("WidgetBridge")

    // 今日サマリーのJSON文字列を保存してウィジェットを更新する（投げっぱなし前提・戻り値なし）
    Function("setWidgetData") { (json: String) in
      // App Group 未設定のビルドでは suiteName が使えないことがある → 何もしない
      guard let defaults = UserDefaults(suiteName: WidgetBridgeModule.suiteName) else { return }
      defaults.set(json, forKey: WidgetBridgeModule.dataKey)
      #if canImport(WidgetKit)
      if #available(iOS 14.0, *) {
        // ウィジェットが1つも無いビルドでも呼んで害はない
        WidgetCenter.shared.reloadAllTimelines()
      }
      #endif
    }
  }
}
