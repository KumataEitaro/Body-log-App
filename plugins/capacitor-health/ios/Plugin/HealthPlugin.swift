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
        CAPPluginMethod(name: "readLatest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readActiveEnergy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeMetrics", returnType: CAPPluginReturnPromise)
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

    private var shareTypes: Set<HKSampleType> {
        [weightType, bodyFatType, waistType, energyType, proteinType, fatType, carbsType]
    }
    private var readTypes: Set<HKObjectType> {
        [weightType, bodyFatType, waistType, activeEnergyType, energyType, proteinType, fatType, carbsType]
    }

    // MARK: - メソッド

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false])
            return
        }
        // 権限シートはメインスレッドから要求しないと表示されないことがあるため main へ
        DispatchQueue.main.async {
            self.store.requestAuthorization(toShare: self.shareTypes, read: self.readTypes) { success, error in
                if let error = error {
                    call.reject(error.localizedDescription)
                    return
                }
                call.resolve(["granted": success])
            }
        }
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
}
