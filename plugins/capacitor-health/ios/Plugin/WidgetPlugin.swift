import Foundation
import Capacitor
import WidgetKit

/**
 * ホーム画面ウィジェットへのデータ受け渡しブリッジ。
 * アプリ側（JS）が今日のサマリーJSONを渡すと、App Group共有ストレージに保存して
 * ウィジェットの再描画を要求する。App Group未設定の環境では実質no-op（安全）。
 */
@objc(WidgetPlugin)
public class WidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetPlugin"
    public let jsName = "Widget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise)
    ]

    @objc func sync(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("json が指定されていません")
            return
        }
        let ud = UserDefaults(suiteName: "group.com.gotcha.bodylog")
        ud?.set(json, forKey: "widget-data")
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve(["ok": true])
    }
}
