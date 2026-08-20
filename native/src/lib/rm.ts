import { parseLiftText, effectiveKg } from './liftLog';
// RM換算（Epley式）: 挙上重量×回数から推定1RM（1回挙げられる最大重量）を計算する
// 例: 100kg×10回 → 100×(1+10/30) ≈ 133kg
export function epley1RM(kg: number, reps: number): number {
  if (!(kg > 0) || !(reps > 0)) return 0;
  if (reps <= 1) return kg;
  return kg * (1 + Math.min(reps, 30) / 30);
}

// 目標1RMに対して「この重量なら何回挙げれば到達か」を逆算（30回超は現実的でないのでnull）
export function repsNeededFor(target1RM: number, kg: number): number | null {
  if (!(kg > 0) || !(target1RM > 0)) return null;
  if (kg >= target1RM) return 1;
  const reps = 30 * (target1RM / kg - 1);
  return reps > 30 ? null : Math.ceil(reps);
}

// 筋トレ記録テキスト（例: "ベンチプレス 100kg×10×3、懸垂 +10kg×8"）から
// 種目ごとの推定1RMを抽出する。
// 解析は liftLog に寄せている（自重・加重の書き方をここで二重に持たないため）。
// 自重種目は体重が負荷の大半なので、体重を渡さないと過小評価になる点に注意。
export function parse1RMs(text: string, bodyWeight?: number | null): { name: string; kg: number; reps: number; est: number }[] {
  return parseLiftText(text)
    .map((e) => {
      const kg = effectiveKg(e, bodyWeight);
      return { name: e.name, kg, reps: e.reps, est: epley1RM(kg, e.reps) };
    })
    .filter((r) => r.kg > 0);
}
