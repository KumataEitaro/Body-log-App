import Foundation
import Capacitor
import HealthKit

/**
 * BodyLog 専用の軽量 HealthKit ブリッジ。
 * 体重(kg) / 体脂肪率(%) / ウエスト(cm) / 摂取エネルギー(kcal) / たんぱく質・脂質・炭水化物(g) の
 * 読み書きと、消費エネルギー(active energy)の読み取りに対応する。
 */
@objc(HealthPlugin)
public class HealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthPlugin"
    public let jsName = "Health"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readLatest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readHistory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readActiveEnergy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeMetrics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readWorkouts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readSteps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readSleep", returnType: CAPPluginReturnPromise)
    ]

    private let store = HKHealthStore()

    // MARK: - 型定義
    private var weightType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .bodyMass)! }
    private var bodyFatType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage)! }
    private var waistType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .waistCircumference)! }
    private var energyType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .dietaryEnergyConsumed)! }
    private var proteinType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .dietaryProtein)! }
    private var fatType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .dietaryFatTotal)! }
    private var carbsType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .dietaryCarbohydrates)! }
    private var activeEnergyType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)! }
    private var stepType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .stepCount)! }
    private var sleepType: HKCategoryType { HKObjectType.categoryType(forIdentifier: .sleepAnalysis)! }

    private var shareTypes: Set<HKSampleType> {
        [weightType, bodyFatType, waistType, energyType, proteinType, fatType, carbsType]
    }
    private var readTypes: Set<HKObjectType> {
        [weightType, bodyFatType, waistType, activeEnergyType, stepType, energyType, proteinType, fatType, carbsType,
         HKObjectType.workoutType(), sleepType]
    }

    // MARK: - メソッド

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false, "reason": "unavailable"])
            return
        }
        // 権限シートはメインスレッドから要求しないと表示されないことがあるため main へ
        DispatchQueue.main.async {
            self.store.requestAuthorization(toShare: self.shareTypes, read: self.readTypes) { success, error in
                if let error = error {
                    call.reject(error.localizedDescription)
                    return
                }
                // 書き込み権限の実ステータス（0=未決定 / 1=拒否 / 2=許可）も返す＝実際に許可されたか確認できる
                let writeStatus = self.store.authorizationStatus(for: self.weightType).rawValue
                call.resolve(["granted": success, "writeStatus": writeStatus])
            }
        }
    }

    // 現在の書き込み権限ステータスのみ取得（要求せず確認だけ）
    @objc func authStatus(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve(["writeStatus": -1]); return }
        call.resolve(["writeStatus": store.authorizationStatus(for: weightType).rawValue])
    }

    // 各指標の最新値（体重kg / 体脂肪% / ウエストcm）を返す
    @objc func readLatest(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve([:]); return }
        let group = DispatchGroup()
        var result: [String: Any] = [:]

        func latest(_ type: HKQuantityType, _ unit: HKUnit, _ key: String) {
            group.enter()
            let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
            let q = HKSampleQuery(sampleType: type, predicate: nil, limit: 1, sortDescriptors: [sort]) { _, samples, _ in
                if let s = samples?.first as? HKQuantitySample {
                    result[key] = s.quantity.doubleValue(for: unit)
                    result[key + "Date"] = ISO8601DateFormatter().string(from: s.endDate)
                }
                group.leave()
            }
            self.store.execute(q)
        }

        latest(weightType, .gramUnit(with: .kilo), "weight")
        latest(bodyFatType, HKUnit.percent(), "bodyFat")
        latest(waistType, HKUnit.meterUnit(with: .centi), "waist")

        group.notify(queue: .main) {
            // bodyFat は 0-1 で入るため % に変換
            if let bf = result["bodyFat"] as? Double { result["bodyFat"] = bf * 100.0 }
            call.resolve(result)
        }
    }

    // 全期間の体重/体脂肪/ウエストの履歴を返す（過去データ一括取込用）
    @objc func readHistory(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve(["weight": [], "bodyFat": [], "waist": []]); return }
        let group = DispatchGroup()
        var result: [String: [[String: Any]]] = ["weight": [], "bodyFat": [], "waist": []]
        let iso = ISO8601DateFormatter()

        func series(_ type: HKQuantityType, _ unit: HKUnit, _ key: String, _ scale: Double) {
            group.enter()
            let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: true)
            let q = HKSampleQuery(sampleType: type, predicate: nil, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, _ in
                if let arr = samples as? [HKQuantitySample] {
                    result[key] = arr.map { ["date": iso.string(from: $0.endDate), "value": $0.quantity.doubleValue(for: unit) * scale] }
                }
                group.leave()
            }
            self.store.execute(q)
        }
        series(weightType, .gramUnit(with: .kilo), "weight", 1)
        series(bodyFatType, HKUnit.percent(), "bodyFat", 100)   // 0-1 → %
        series(waistType, HKUnit.meterUnit(with: .centi), "waist", 1)

        group.notify(queue: .main) { call.resolve(result) }
    }

    // 指定日の消費エネルギー(active energy, kcal)合計
    @objc func readActiveEnergy(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve(["kcal": 0]); return }
        let dateStr = call.getString("date") ?? ""
        guard let day = Self.dayFormatter.date(from: dateStr) else { call.resolve(["kcal": 0]); return }
        let start = Calendar.current.startOfDay(for: day)
        let end = Calendar.current.date(byAdding: .day, value: 1, to: start)!
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let q = HKStatisticsQuery(quantityType: activeEnergyType, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, stats, _ in
            let kcal = stats?.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? 0
            call.resolve(["kcal": Int(kcal.rounded())])
        }
        store.execute(q)
    }

    // 指定日の歩数合計
    @objc func readSteps(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve(["steps": 0]); return }
        let dateStr = call.getString("date") ?? ""
        guard let day = Self.dayFormatter.date(from: dateStr) else { call.resolve(["steps": 0]); return }
        let start = Calendar.current.startOfDay(for: day)
        let end = Calendar.current.date(byAdding: .day, value: 1, to: start)!
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let q = HKStatisticsQuery(quantityType: stepType, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, stats, _ in
            let steps = stats?.sumQuantity()?.doubleValue(for: .count()) ?? 0
            call.resolve(["steps": Int(steps.rounded())])
        }
        store.execute(q)
    }

    // 指定日の睡眠時間（分）。「その日の睡眠」＝前日18時〜当日12時の入眠サンプル合計
    @objc func readSleep(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve(["minutes": 0]); return }
        let dateStr = call.getString("date") ?? ""
        guard let day = Self.dayFormatter.date(from: dateStr) else { call.resolve(["minutes": 0]); return }
        let dayStart = Calendar.current.startOfDay(for: day)
        let start = Calendar.current.date(byAdding: .hour, value: -6, to: dayStart)!
        let end = Calendar.current.date(byAdding: .hour, value: 12, to: dayStart)!
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let q = HKSampleQuery(sampleType: sleepType, predicate: pred, limit: 300, sortDescriptors: nil) { _, samples, _ in
            var total: TimeInterval = 0
            for s in (samples as? [HKCategorySample] ?? []) {
                // 1=asleepUnspecified / 3=core / 4=deep / 5=REM（0=inBed, 2=awake は除外）
                if s.value == 1 || s.value == 3 || s.value == 4 || s.value == 5 {
                    total += s.endDate.timeIntervalSince(s.startDate)
                }
            }
            call.resolve(["minutes": Int(total / 60)])
        }
        store.execute(q)
    }

    // 指定日の指標をまとめて書き込む（渡された項目のみ）
    @objc func writeMetrics(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve(["written": 0]); return }
        let dateStr = call.getString("date") ?? ""
        let day = Self.dayFormatter.date(from: dateStr) ?? Date()
        // その日の正午に記録（時刻情報は持たないため）
        let noon = Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: day) ?? Date()

        var samples: [HKQuantitySample] = []
        func add(_ type: HKQuantityType, _ unit: HKUnit, _ value: Double?) {
            guard let v = value, v > 0 else { return }
            let qty = HKQuantity(unit: unit, doubleValue: v)
            samples.append(HKQuantitySample(type: type, quantity: qty, start: noon, end: noon))
        }

        add(weightType, .gramUnit(with: .kilo), call.getDouble("weight"))
        if let bf = call.getDouble("bodyFat") { add(bodyFatType, HKUnit.percent(), bf / 100.0) } // %→0-1
        add(waistType, HKUnit.meterUnit(with: .centi), call.getDouble("waist"))
        add(energyType, .kilocalorie(), call.getDouble("energy"))
        add(proteinType, .gram(), call.getDouble("protein"))
        add(fatType, .gram(), call.getDouble("fat"))
        add(carbsType, .gram(), call.getDouble("carbs"))

        if samples.isEmpty { call.resolve(["written": 0]); return }
        store.save(samples) { success, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            call.resolve(["written": success ? samples.count : 0])
        }
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone.current
        return f
    }()

    // MARK: - ワークアウト読み取り（運動記録の連携・分析用）

    private func workoutName(_ t: HKWorkoutActivityType) -> String {
        switch t {
        case .running: return "ランニング"
        case .walking: return "ウォーキング"
        case .cycling: return "サイクリング"
        case .swimming: return "水泳"
        case .traditionalStrengthTraining, .functionalStrengthTraining: return "筋トレ"
        case .highIntensityIntervalTraining: return "HIIT"
        case .yoga: return "ヨガ"
        case .hiking: return "ハイキング"
        case .elliptical: return "エリプティカル"
        case .rowing: return "ローイング"
        case .coreTraining: return "体幹トレ"
        case .pilates: return "ピラティス"
        case .stairClimbing: return "階段"
        default: return "ワークアウト"
        }
    }

    // 直近daysBack日のワークアウト一覧（開始時刻・分数・消費kcal・種目）
    @objc func readWorkouts(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve(["workouts": []]); return }
        let daysBack = call.getInt("daysBack") ?? 30
        let end = Date()
        let start = Calendar.current.date(byAdding: .day, value: -daysBack, to: end) ?? end
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: true)
        let q = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: pred, limit: 500, sortDescriptors: [sort]) { _, samples, _ in
            let iso = ISO8601DateFormatter()
            let list: [[String: Any]] = (samples as? [HKWorkout] ?? []).map { w in
                let kcal = w.totalEnergyBurned?.doubleValue(for: .kilocalorie()) ?? 0
                return [
                    "start": iso.string(from: w.startDate),
                    "minutes": Int(w.duration / 60),
                    "kcal": Int(kcal.rounded()),
                    "type": self.workoutName(w.workoutActivityType),
                ]
            }
            DispatchQueue.main.async {
                call.resolve(["workouts": list])
            }
        }
        store.execute(q)
    }
}
