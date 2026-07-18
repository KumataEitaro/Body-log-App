'use client';
import { useState } from 'react';
import { daysBetween, addDays, dateTicks } from '@/lib/goal';
import { cumulativeDiffs, type DiffPoint } from '@/lib/series';
import { FAT_KCAL_PER_KG } from '@/lib/calc';

type Period = '7d' | '30d' | '90d' | 'all';
const PERIODS: { key: Period; label: string }[] = [
  { key: '7d', label: '週' },
  { key: '30d', label: '月' },
  { key: '90d', label: '3か月' },
  { key: 'all', label: '全期間' },
];

const fmtK = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) % 1000 === 0 ? 0 : 1)}k` : String(v));

// カロリー収支: 棒＝その日の収支（左軸）／ 面＝累計（右軸・背景）
export default function CumChart({ points, today }: { points: DiffPoint[]; today: string }) {
  const [period, setPeriod] = useState<Period>('30d');
  if (points.length === 0) return null;

  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const cumAll = cumulativeDiffs(sorted);
  const first = sorted[0].date;
  const last = sorted[sorted.length - 1].date;
  const x0 = period === 'all' ? first : addDays(today, -(period === '7d' ? 7 : period === '30d' ? 30 : 90));
  const x1 = last > today ? last : today;
  const daily = sorted.filter((p) => p.date >= x0 && p.date <= x1);
  const cumWin = cumAll.filter((p) => p.date >= x0 && p.date <= x1);

  const seg = (
    <div className="seg">
      {PERIODS.map((p) => (
        <button key={p.key} className={period === p.key ? 'active' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>
      ))}
    </div>
  );
  if (daily.length === 0) {
    return (<>{seg}<p className="muted center" style={{ padding: '24px 0' }}>この期間の記録がありません</p></>);
  }

  const W = 380, H = 240, PL = 40, PR = 42, PT = 14, PB = 26;
  const plotW = W - PL - PR;
  const totalDays = Math.max(daysBetween(x0, x1), 1);
  const X = (d: string) => PL + (Math.min(Math.max(daysBetween(x0, d), 0), totalDays) / totalDays) * plotW;
  const barW = Math.max(3, Math.min(14, (plotW / (totalDays + 1)) * 0.6));

  // 左軸: その日の収支
  const dVals = daily.map((p) => p.diff);
  const dMax = Math.max(...dVals, 300);
  const dMin = Math.min(...dVals, -600);
  const YD = (v: number) => PT + (1 - (v - dMin) / (dMax - dMin)) * (H - PT - PB);

  // 右軸: 累計（0を必ず含める）
  const cVals = cumWin.map((p) => p.v);
  const cMax = Math.max(...cVals, 0);
  const cMin = Math.min(...cVals, 0);
  const YC = (v: number) => PT + (1 - (v - cMin) / Math.max(cMax - cMin, 1)) * (H - PT - PB);

  // 累計の面（背景）
  const cumLine = cumWin.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.date).toFixed(1)},${YC(p.v).toFixed(1)}`).join(' ');
  const cumArea = `${cumLine} L${X(cumWin[cumWin.length - 1].date).toFixed(1)},${YC(0).toFixed(1)} L${X(cumWin[0].date).toFixed(1)},${YC(0).toFixed(1)} Z`;

  const latest = cumAll[cumAll.length - 1].v;
  const fatKg = Math.round((latest / FAT_KCAL_PER_KG) * 100) / 100;

  // 左軸グリッド（その日の収支）
  const dSpan = dMax - dMin;
  const dStep = dSpan > 4000 ? 2000 : dSpan > 2000 ? 1000 : 500;
  const dGrid: number[] = [];
  for (let v = Math.ceil(dMin / dStep) * dStep; v <= dMax; v += dStep) dGrid.push(v);
  return (
    <>
      {seg}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="カロリー収支（日次と累計）">
        {/* 累計＝うすい面だけ（シンプルに） */}
        <path d={cumArea} fill={latest <= 0 ? 'var(--green)' : 'var(--coral)'} opacity="0.12" />

        {/* 左軸グリッド＋ラベル（日次） */}
        {dGrid.map((v) => (
          <g key={v}>
            <line x1={PL} y1={YD(v)} x2={W - PR} y2={YD(v)} stroke="var(--line)" strokeWidth="1" opacity={v === 0 ? 0 : 0.6} />
            <text x={PL - 4} y={YD(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--sub)">{fmtK(v)}</text>
          </g>
        ))}
        {/* 0ライン */}
        <line x1={PL} y1={YD(0)} x2={W - PR} y2={YD(0)} stroke="var(--sub)" strokeWidth="1.4" opacity="0.8" />

        {/* 日付目盛り */}
        {dateTicks(x0, x1, 4).map((d) => (
          <text key={d} x={X(d)} y={H - PB + 14} textAnchor="middle" fontSize="10" fill="var(--sub)">{d.slice(5).replace('-', '/')}</text>
        ))}

        {/* その日の収支（棒） */}
        {daily.map((p) => {
          const y0 = YD(0);
          const y = YD(p.diff);
          const top = Math.min(y0, y);
          const h = Math.max(Math.abs(y - y0), 1.5);
          return (
            <rect key={p.date} x={X(p.date) - barW / 2} y={top} width={barW} height={h} rx="1.5"
                  fill={p.diff <= 0 ? 'var(--green)' : 'var(--coral)'} opacity="0.9" />
          );
        })}
      </svg>
      <div className="chart-legend" style={{ justifyContent: 'center' }}>
        <span><i style={{ background: 'var(--green)' }} />棒＝その日の収支（下＝得）</span>
        <span><i style={{ background: latest <= 0 ? 'var(--green)' : 'var(--coral)', opacity: 0.3 }} />面＝累計の積み上がり</span>
      </div>
      <p className="center" style={{ margin: '6px 0 0', fontSize: 14 }}>
        累計 <b className="num" style={{ color: latest <= 0 ? 'var(--green)' : 'var(--coral)' }}>{latest > 0 ? '+' : ''}{latest.toLocaleString()}</b> kcal
        ＝ 脂肪換算 <b className="num">{fatKg > 0 ? '+' : ''}{fatKg}</b> kg
      </p>
    </>
  );
}
