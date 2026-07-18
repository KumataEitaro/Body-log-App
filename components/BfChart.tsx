'use client';
import { daysBetween, dateTicks } from '@/lib/goal';

export type BfPoint = { date: string; bf: number };

// AI推定体脂肪率の推移（目標体脂肪率の点線つき）
export default function BfChart({
  points, targetBf, today,
}: {
  points: BfPoint[];
  targetBf: number | null;
  today: string;
}) {
  if (points.length < 2) return null;

  const W = 600, H = 200, PL = 40, PR = 14, PT = 14, PB = 28;
  const x0 = points[0].date;
  const lastRec = points[points.length - 1].date;
  const x1 = today > lastRec ? today : lastRec;
  const totalDays = Math.max(daysBetween(x0, x1), 1);

  const ys = points.map((p) => p.bf);
  if (targetBf != null) ys.push(targetBf);
  const yMax = Math.ceil(Math.max(...ys) + 1);
  const yMin = Math.max(Math.floor(Math.min(...ys) - 1), 0);

  const X = (d: string) => PL + (Math.min(Math.max(daysBetween(x0, d), 0), totalDays) / totalDays) * (W - PL - PR);
  const Y = (v: number) => PT + (1 - (v - yMin) / (yMax - yMin)) * (H - PT - PB);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.date).toFixed(1)},${Y(p.bf).toFixed(1)}`).join(' ');

  const gridLines = [];
  const step = yMax - yMin > 8 ? 2 : 1;
  for (let v = yMin; v <= yMax; v += step) {
    gridLines.push(
      <g key={v}>
        <line x1={PL} y1={Y(v)} x2={W - PR} y2={Y(v)} stroke="var(--line)" strokeWidth="1" />
        <text x={PL - 6} y={Y(v) + 4} textAnchor="end" fontSize="10" fill="var(--sub)">{v}%</text>
      </g>
    );
  }

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="AI推定体脂肪率の推移">
        {gridLines}
        {dateTicks(x0, x1, 6).map((d) => (
          <g key={d}>
            <line x1={X(d)} y1={PT} x2={X(d)} y2={H - PB} stroke="var(--line)" strokeWidth="1" opacity="0.6" />
            <text x={X(d)} y={H - PB + 14} textAnchor="middle" fontSize="9" fill="var(--sub)">{d.slice(5).replace('-', '/')}</text>
          </g>
        ))}
        {targetBf != null && (
          <>
            <line x1={PL} y1={Y(targetBf)} x2={W - PR} y2={Y(targetBf)} stroke="var(--green)" strokeWidth="1.5" strokeDasharray="6 4" />
            <text x={W - PR} y={Y(targetBf) - 4} textAnchor="end" fontSize="10" fill="var(--green)">目標 {targetBf}%</text>
          </>
        )}
        <path d={path} fill="none" stroke="var(--coral)" strokeWidth="2.5" />
        {points.map((p, i) => <circle key={`${p.date}-${i}`} cx={X(p.date)} cy={Y(p.bf)} r="3" fill="var(--coral)" />)}
      </svg>
      <p className="muted center" style={{ margin: '4px 0 0' }}>AIが写真から推定した体脂肪率（±3%の誤差あり）{targetBf != null ? ' ／ 点線=目標' : ''}</p>
    </>
  );
}
