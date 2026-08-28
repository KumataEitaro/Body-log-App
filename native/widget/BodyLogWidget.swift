import WidgetKit
import SwiftUI

// BodyLog（RN版）ホーム画面ウィジェット（小サイズのみ・B-9）。
// アプリ側（modules/widget-bridge）が App Group に書き出したJSONを読むだけ。
// このファイルはリポジトリに静置され、ENABLE_WIDGET=true のCIビルドでのみ
// scripts/add-widget-target-rn.rb が拡張ターゲットとして注入する。
//
// 保守方針: ローカルでSwiftをコンパイルできない運用のため、WidgetKitの基本形だけで書く
// （iOS17専用APIは #available で保護。配色はシステム色でライト/ダーク両対応）。

// アプリ側（WidgetBridgeModule.swift / src/lib/widget.ts）とキー名を揃える
private let blSuiteName = "group.com.gotcha.bodylog.rn"
private let blDataKey = "bl-widget"

// src/lib/widget.ts の WidgetPayload と同じ形
struct BLWPayload: Codable {
    var date: String        // yyyy-MM-dd (JST)
    var left: Double?       // 残りkcal（負=オーバー・nil=計画未計算）
    var goal: Double?
    var eaten: Double?
    var streak: Int?        // 連続記録日数
    var asOf: String?       // "12:34"
}

// JSTの今日 (yyyy-MM-dd)。書き出し済みデータが今日のものかの判定に使う
func blTodayJST() -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone(identifier: "Asia/Tokyo")
    return f.string(from: Date())
}

func blLoadPayload() -> BLWPayload? {
    guard let ud = UserDefaults(suiteName: blSuiteName),
          let s = ud.string(forKey: blDataKey),
          let d = s.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(BLWPayload.self, from: d)
}

struct BLWEntry: TimelineEntry {
    let date: Date
    let payload: BLWPayload?
}

struct BLWProvider: TimelineProvider {
    func placeholder(in context: Context) -> BLWEntry {
        // ギャラリー用のサンプル値
        BLWEntry(date: Date(), payload: BLWPayload(date: blTodayJST(), left: 427, goal: 1800, eaten: 1373, streak: 12, asOf: "12:34"))
    }
    func getSnapshot(in context: Context, completion: @escaping (BLWEntry) -> Void) {
        completion(BLWEntry(date: Date(), payload: blLoadPayload() ?? placeholder(in: context).payload))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<BLWEntry>) -> Void) {
        let entry = BLWEntry(date: Date(), payload: blLoadPayload())
        // 日付が変わったら「今日はまだ記録なし」に切り替わるよう、翌日0時すぎに再評価
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Tokyo") ?? .current
        let nextMidnight = cal.nextDate(after: Date(), matching: DateComponents(hour: 0, minute: 1),
                                        matchingPolicy: .nextTime) ?? Date().addingTimeInterval(3600 * 6)
        completion(Timeline(entries: [entry], policy: .after(nextMidnight)))
    }
}

// containerBackground はiOS17必須・iOS16以前は通常のbackgroundで代替
extension View {
    @ViewBuilder
    func blWidgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            self.containerBackground(for: .widget) { Color(UIColor.systemBackground) }
        } else {
            self.background(Color(UIColor.systemBackground))
        }
    }
}

struct BLWSmallView: View {
    let entry: BLWEntry

    var body: some View {
        // 今日のデータがあり残量が計算済み → メイン表示。それ以外は記録を促す
        if let p = entry.payload, p.date == blTodayJST(), let left = p.left {
            mainView(left: left, streak: p.streak ?? 0, asOf: p.asOf)
        } else {
            promptView(streak: (entry.payload?.date == blTodayJST() ? entry.payload?.streak : nil) ?? 0)
        }
    }

    // 残りkcal＋🔥ストリーク
    @ViewBuilder
    func mainView(left: Double, streak: Int, asOf: String?) -> some View {
        let over = left < 0
        VStack(spacing: 4) {
            Text(over ? "オーバー" : "あと")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text("\(Int(abs(left)))")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundColor(over ? .red : .primary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text("kcal")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.secondary)
            }
            HStack(spacing: 3) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.orange)
                Text("\(streak)日")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundColor(.primary)
                if let asOf = asOf {
                    Text(asOf)
                        .font(.system(size: 9))
                        .foregroundColor(.secondary)
                }
            }
            .padding(.top, 2)
        }
        .padding(6)
    }

    // データ無し/日付が古い → 記録を促す（ストリークが分かるときは添える）
    @ViewBuilder
    func promptView(streak: Int) -> some View {
        VStack(spacing: 6) {
            Image(systemName: "fork.knife")
                .font(.system(size: 24, weight: .semibold))
                .foregroundColor(.green)
            Text("BodyLogを開いて記録")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.primary)
                .multilineTextAlignment(.center)
            if streak > 0 {
                HStack(spacing: 3) {
                    Image(systemName: "flame.fill")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.orange)
                    Text("\(streak)日")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundColor(.primary)
                }
            }
        }
        .padding(6)
    }
}

struct BodyLogWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BodyLogRemaining", provider: BLWProvider()) { entry in
            BLWSmallView(entry: entry)
                .blWidgetBackground()
        }
        .configurationDisplayName("今日の残りカロリー")
        .description("残りkcalと連続記録日数を表示します")
        .supportedFamilies([.systemSmall])
    }
}

@main
struct BodyLogWidgetBundle: WidgetBundle {
    var body: some Widget {
        BodyLogWidget()
    }
}
