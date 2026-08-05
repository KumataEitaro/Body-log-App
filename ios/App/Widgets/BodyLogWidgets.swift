import WidgetKit
import SwiftUI

// BodyLog ホーム画面ウィジェット（小サイズ）。
// データはアプリ側が App Group (group.com.gotcha.bodylog) に書き出したJSONを読むだけ。
// 状態: ①今日記録あり=残りkcalリング ②今日まだ未記録 ③昨日が未記録（穴埋め促し）

struct BLDay: Codable {
    var l: String          // 曜日ラベル
    var v: Double?         // 収支±kcal（nil=未記録）
}

struct BLData: Codable {
    var date: String       // データが対象とする日 (yyyy-MM-dd, JST)
    var eaten: Double
    var goal: Double
    var left: Double
    var pEaten: Double
    var pGoal: Double
    var todayLogged: Bool
    var yUnrec: Bool       // 昨日が未記録
    var asOf: String       // "12:34" 書き出し時刻
    var days: [BLDay]?     // 昨日までの6日（古い順）
    var weekSum: Double?   // 上記合計（記録日のみ）
    var weekUnknown: Double? // 未記録日数
}

func jstToday() -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone(identifier: "Asia/Tokyo")
    return f.string(from: Date())
}

func loadBLData() -> BLData? {
    guard let ud = UserDefaults(suiteName: "group.com.gotcha.bodylog"),
          let s = ud.string(forKey: "widget-data"),
          let d = s.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(BLData.self, from: d)
}

struct BLEntry: TimelineEntry {
    let date: Date
    let data: BLData?
}

struct BLProvider: TimelineProvider {
    func placeholder(in context: Context) -> BLEntry {
        BLEntry(date: Date(), data: BLData(date: jstToday(), eaten: 1373, goal: 1800, left: 427,
                                           pEaten: 82, pGoal: 150, todayLogged: true, yUnrec: false, asOf: "12:34"))
    }
    func getSnapshot(in context: Context, completion: @escaping (BLEntry) -> Void) {
        completion(BLEntry(date: Date(), data: loadBLData() ?? placeholder(in: context).data))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<BLEntry>) -> Void) {
        let entry = BLEntry(date: Date(), data: loadBLData())
        // 日付が変わったら「今日まだ記録なし」に切り替わるよう、翌日0時すぎに再評価
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Tokyo") ?? .current
        let nextMidnight = cal.nextDate(after: Date(), matching: DateComponents(hour: 0, minute: 1),
                                        matchingPolicy: .nextTime) ?? Date().addingTimeInterval(3600 * 6)
        completion(Timeline(entries: [entry], policy: .after(nextMidnight)))
    }
}

let blEmerald = Color(red: 0.02, green: 0.59, blue: 0.41)
let blInk = Color(red: 0.05, green: 0.07, blue: 0.09)
let blCoral = Color(red: 0.91, green: 0.36, blue: 0.32)

struct BLSmallView: View {
    let entry: BLEntry

    var body: some View {
        let today = jstToday()
        if let d = entry.data, d.date == today, d.todayLogged {
            ringView(d)
        } else if let d = entry.data, d.date != today, d.yUnrec {
            promptView(icon: "square.and.pencil", title: "昨日の穴埋め", sub: "30秒でできます")
        } else {
            promptView(icon: "fork.knife", title: "今日の記録", sub: "まだ記録がありません")
        }
    }

    // 状態①: 残りkcalリング
    @ViewBuilder
    func ringView(_ d: BLData) -> some View {
        let over = d.left < 0
        let pct = d.goal > 0 ? min(1.0, max(0.0, d.eaten / d.goal)) : 0
        VStack(spacing: 2) {
            ZStack {
                Circle().stroke(Color.gray.opacity(0.18), lineWidth: 7)
                Circle()
                    .trim(from: 0, to: CGFloat(pct))
                    .stroke(over ? blCoral : blEmerald, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 0) {
                    Text("\(Int(abs(d.left)))")
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundColor(over ? blCoral : blInk)
                        .minimumScaleFactor(0.6)
                    Text(over ? "オーバー" : "あとkcal")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            HStack(spacing: 3) {
                Text("P あと\(Int(max(0, d.pGoal - d.pEaten)))g")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundColor(blEmerald)
                Text(d.asOf)
                    .font(.system(size: 8))
                    .foregroundColor(.secondary)
            }
        }
        .padding(4)
    }

    // 状態②③: 記録を促す表示
    @ViewBuilder
    func promptView(icon: String, title: String, sub: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 26, weight: .semibold))
                .foregroundColor(blEmerald)
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(blInk)
            Text(sub)
                .font(.system(size: 10))
                .foregroundColor(.secondary)
            Text("タップして記録")
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(blEmerald)
        }
    }
}

// ===== 中サイズ: 1週間の正直鏡（今日の残り＋昨日までの6日の収支＋未記録の可視化） =====

func fmtDiff(_ v: Double) -> String {
    let n = Int(v.rounded())
    if abs(n) >= 1000 {
        return String(format: "%+.1fk", Double(n) / 1000)
    }
    return String(format: "%+d", n).replacingOccurrences(of: "+-", with: "-")
}

struct BLDayCell: View {
    let label: String
    let diff: Double?

    var body: some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 8, weight: .semibold))
                .foregroundColor(Color.gray.opacity(0.8))
            ZStack {
                if let v = diff {
                    Circle().fill(v <= 0 ? Color(red: 0.88, green: 0.96, blue: 0.93) : Color(red: 0.99, green: 0.92, blue: 0.92))
                    Text(fmtDiff(v))
                        .font(.system(size: 7.5, weight: .bold, design: .rounded))
                        .minimumScaleFactor(0.7)
                        .foregroundColor(v <= 0 ? Color(red: 0.06, green: 0.43, blue: 0.34) : Color(red: 0.64, green: 0.18, blue: 0.18))
                } else {
                    Circle().strokeBorder(Color.gray.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
                    Text("?")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(Color.gray)
                }
            }
            .frame(width: 26, height: 26)
        }
    }
}

struct BLMediumView: View {
    let entry: BLEntry

    var body: some View {
        if let d = entry.data, d.date == jstToday(), let days = d.days {
            let over = d.left < 0
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text("\(Int(abs(d.left)))")
                        .font(.system(size: 26, weight: .bold, design: .rounded))
                        .foregroundColor(over ? blCoral : blInk)
                    Text(over ? "kcalオーバー" : "あとkcal")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.secondary)
                    Spacer()
                    Text("P あと\(Int(max(0, d.pGoal - d.pEaten)))g")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundColor(blEmerald)
                }
                Spacer(minLength: 0)
                HStack(spacing: 0) {
                    ForEach(0..<days.count, id: \.self) { i in
                        BLDayCell(label: days[i].l, diff: days[i].v)
                        Spacer(minLength: 0)
                    }
                    VStack(spacing: 2) {
                        Text("今日")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundColor(blInk)
                        ZStack {
                            Circle().strokeBorder(blEmerald, lineWidth: 2)
                            Text(d.todayLogged ? "…" : "未")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundColor(blEmerald)
                        }
                        .frame(width: 26, height: 26)
                    }
                }
                Spacer(minLength: 0)
                HStack(spacing: 4) {
                    Text("直近6日")
                        .font(.system(size: 9))
                        .foregroundColor(.secondary)
                    Text(fmtDiff(d.weekSum ?? 0) + "kcal")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundColor((d.weekSum ?? 0) <= 0 ? blEmerald : blCoral)
                    if let u = d.weekUnknown, u > 0 {
                        Text("・未記録\(Int(u))日（±0扱い）")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundColor(Color(red: 0.72, green: 0.5, blue: 0.1))
                    }
                    Spacer()
                    Text(d.asOf)
                        .font(.system(size: 8))
                        .foregroundColor(Color.gray.opacity(0.7))
                }
            }
        } else {
            // データ無し/日付が古い → 記録を促す（小サイズと同じ思想）
            BLSmallView(entry: entry)
        }
    }
}

struct BodyLogWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BodyLogSummary", provider: BLProvider()) { entry in
            BLFamilyView(entry: entry)
                .containerBackground(for: .widget) { Color(red: 0.984, green: 0.984, blue: 0.98) }
        }
        .configurationDisplayName("今日の残りカロリー")
        .description("残りkcalと直近1週間の収支（未記録日も隠さず表示）")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct BLFamilyView: View {
    @Environment(\.widgetFamily) var family
    let entry: BLEntry

    var body: some View {
        switch family {
        case .systemMedium:
            BLMediumView(entry: entry)
        default:
            BLSmallView(entry: entry)
        }
    }
}

@main
struct BodyLogWidgetBundle: WidgetBundle {
    var body: some Widget {
        BodyLogWidget()
    }
}
