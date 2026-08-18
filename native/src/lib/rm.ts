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

// 筋トレ記録テキスト（例: "ベンチプレス 100kg×10×3、スクワット 80kg×8"）から
// 種目ごとの推定1RMを抽出する
export function parse1RMs(text: string): { name: string; kg: number; reps: number; est: number }[] {
  const out: { name: string; kg: number; reps: number; est: number }[] = [];
  const re = /([^\s、]+)\s([\d.]+)kg(?:×(\d+))?(?:×\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const kg = Number(m[2]);
    const reps = m[3] ? Number(m[3]) : 1;
    if (kg > 0) out.push({ name: m[1], kg, reps, est: epley1RM(kg, reps) });
  }
  return out;
}
