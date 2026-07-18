'use client';
import { useState } from 'react';
import { daysBetween, addDays, movingAverage, dateTicks, plannedWeightAt, type Goal } from '@/lib/goal';

export type WeightPoint = { date: string; weight: number };
export type BfPoint = { date: string; bf: number };
export type ChartEvent = { id: string; date: string };

type Period = '7d' | '30d' | '90d' | 'all' | 'plan';
const PERIODS: { key: Period; label: string }[] = [
  { key: '7d', label: '週' },
  { key: '30d', label: '月' },
  { key: '90d', label: '3か月' },
  { key: 'all', label: '全期間' },
  { key: 'plan', label: '計画' },
];

// 体重（左軸）＋体脂肪率（右軸）＋計画線。期間切替ボタンつき
export default function WeightChart({
  goal, weights, events, today, bfPoints = [], targetBf = null,
}: {
  goal: Goal | null;
  weights: WeightPoint[];
  events: ChartEvent[];
  today: string;
  bfPoints?: BfPoint[];
  targetBf?: number | null;
}) {
  const [period, setPeriod] = useState<Period>('plan');
  if (weights.length === 0 && !goal) return null;

  // ===== 表示期間の決定 =====
  const firstDates = [
    weights.length ? weights[0].date : null,
    bfPoints.length ? bfPoints[0].date : null,
    goal?.start_date ?? null,
  ].filter(Boolean) as string[];
  const earliest = firstDates.sort()[0] ?? today;
  const lastRec = weights.length ? weights[weights.length - 1].date : today;
  const latestData = lastRec > today ? lastRec : today;

  let x0: string, x1: string;
  if (period === 'plan') {
    x0 = earliest;
    x1 = goal?.target_date && goal.target_date > latestData ? goal.target_date : latestData;
  } else if (period === 'all') {
    x0 = earliest; x1 = latestData;
  } else {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    x0 = addDays(today, -days); x1 = today;
  }
  if (x1 <= x0) x1 = addDays(x0, 1);
  const totalDays = Math.max(daysBetween(x0, x1), 1);

  // ===== 期間内データ =====
  const wIn = weights.filter((p) => p.date >= x0 && p.date <= x1);
  const maAll = movingAverage(weights, 7);
  const maIn = maAll.filter((p) => p.date >= x0 && p.date <= x1);
  const bfIn = bfPoints.filter((p) => p.date >= x0 && p.date <= x1);
  const evIn = events.filter((e) => e.date >= x0 && e.date <= x1);

  // 体重計画線の区間（表示範囲と計画期間の重なり）
  const wPlan: { d: string; v: number }[] = [];
  if (goal?.target_weight != null) {
    const p0 = x0 > goal.start_date ? x0 : goal.start_date;
    const p1 = x1 < goal.target_date ? x1 : goal.target_date;
    if (p0 <= p1) {
      wPlan.push({ d: p0, v: plannedWeightAt(goal, p0)! }, { d: p1, v: plannedWeightAt(goal, p1)! });
    }
  }
  // 体脂肪率計画線の区間（今日の最新実測→目標日を線形補間）
  const bfPlan: { d: string; v: number }[] = [];
  const hasBfBase = bfPoints.length >= 1 && (bfPoints.length >= 2 || targetBf != null);
  if (hasBfBase && targetBf != null && goal?.target_date && bfPoints.length > 0 && goal.target_date > today) {
    const latestBf = bfPoints[bfPoints.length - 1].bf; // 直近のAI推定値を今日の起点にする
    const span = Math.max(daysBetween(today, goal.target_date), 1);
    const bfAt = (d: string) => latestBf + (targetBf - latestBf) * (Math.min(Math.max(daysBetween(today, d), 0), span) / span);
    const p0 = x0 > today ? x0 : today;
    const p1 = x1 < goal.target_date ? x1 : goal.target_date;
    if (p0 <= p1) bfPlan.push({ d: p0, v: bfAt(p0) }, { d: p1, v: bfAt(p1) });
  }
  const hasBf = bfIn.length > 0 || bfPlan.length > 0;

  // ===== スケール（スマホ幅基準: 380px。SVG文字がほぼ等倍で表示される） =====
  const W = 380, H = 240, PL = 34, PR = hasBf ? 36 : 10, PT = 20, PB = 26;
  const X = (d: string) => PL + (Math.min(Math.max(daysBetween(x0, d), 0), totalDays) / totalDays) * (W - PL - PR);

  const wys = [...wIn.map((p) => p.weight), ...maIn.map((p) => p.weight), ...wPlan.map((p) => p.v)];
  const bys = [...bfIn.map((p) => p.bf), ...bfPlan.map((p) => p.v)];

  const seg = (
    <div className="seg">
      {PERIODS.map((p) => (
        <button key={p.key} className={period === p.key ? 'active' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>
      ))}
    </div>
  );

  if (wys.length === 0 && bys.length === 0) {
    return (
      <>
        {seg}
        <p className="muted center" style={{ padding: '24px 0' }}>この期間の記録がありません</p>
      </>
    );
  }

  const wMax = wys.length ? Math.ceil(Math.max(...wys) + 0.5) : 1;
  const wMin = wys.length ? Math.floor(Math.min(...wys) - 0.5) : 0;
  const YW = (v: number) => PT + (1 - (v - wMin) / Math.max(wMax - wMin, 1)) * (H - PT - PB);
  const bMax = bys.length ? Math.ceil(Math.max(...bys) + 1) : 0;
  const bMin = bys.length ? Math.max(Math.floor(Math.min(...bys) - 1), 0) : 0;
  const YB = (v: number) => PT + (1 - (v - bMin) / Math.max(bMax - bMin, 1)) * (H - PT - PB);

  const toPathW = (pts: WeightPoint[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.date).toFixed(1)},${YW(p.weight).toFixed(1)}`).join(' ');
  const rawPath = toPathW(wIn);
  const maPath = toPathW(maIn);
  const bfPath = bfIn.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.date).toFixed(1)},${YB(p.bf).toFixed(1)}`).join(' ');

  const grid = [];
  if (wys.length) {
    const wStep = wMax - wMin > 8 ? 2 : 1;
    for (let v = wMin; v <= wMax; v += wStep) {
      grid.push(
        <g key={`w${v}`}>
          <line x1={PL} y1={YW(v)} x2={W - PR} y2={YW(v)} stroke="var(--line)" strokeWidth="1" />
          <text x={PL - 5} y={YW(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--sub)">{v}</text>
        </g>
      );
    }
  }
  const bfAxis = [];
  if (hasBf && bys.length) {
    const bStep = bMax - bMin > 8 ? 2 : 1;
    for (let v = bMin; v <= bMax; v += bStep) {
      bfAxis.push(
        <text key={`b${v}`} x={W - PR + 5} y={YB(v) + 3.5} textAnchor="start" fontSize="10" fill="var(--coral)" opacity="0.9">{v}%</text>
      );
    }
  }

  return (
    <>
      {seg}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="体重と体脂肪率の推移・計画">
        {grid}
        {bfAxis}

        {dateTicks(x0, x1, period === '7d' ? 6 : 4).map((d) => (
          <g key={d}>
            <line x1={X(d)} y1={PT} x2={X(d)} y2={H - PB} stroke="var(--line)" strokeWidth="1" opacity="0.55" />
            <text x={X(d)} y={H - PB + 14} textAnchor="middle" fontSize="10" fill="var(--sub)">{d.slice(5).replace('-', '/')}</text>
          </g>
        ))}

        {today >= x0 && today <= x1 && (
          <>
            <line x1={X(today)} y1={PT} x2={X(today)} y2={H - PB} stroke="var(--sub)" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.8" />
            <text x={X(today)} y={PT - 6} textAnchor="middle" fontSize="10" fill="var(--sub)" fontWeight="700">今日</text>
          </>
        )}

        {wPlan.length === 2 && (
          <line x1={X(wPlan[0].d)} y1={YW(wPlan[0].v)} x2={X(wPlan[1].d)} y2={YW(wPlan[1].v)}
                stroke="var(--teal)" strokeWidth="1.8" strokeDasharray="7 5" opacity="0.65" />
        )}
        {bfPlan.length === 2 && (
          <line x1={X(bfPlan[0].d)} y1={YB(bfPlan[0].v)} x2={X(bfPlan[1].d)} y2={YB(bfPlan[1].v)}
                stroke="var(--coral)" strokeWidth="1.8" strokeDasharray="7 5" opacity="0.55" />
        )}

        {rawPath && <path d={rawPath} fill="none" stroke="var(--sub)" strokeWidth="1.1" opacity="0.3" />}
        {maPath && <path d={maPath} fill="none" stroke="var(--teal)" strokeWidth="2.6" strokeLinejoin="round" />}
        {maIn.map((p) => <circle key={p.date} cx={X(p.date)} cy={YW(p.weight)} r="2.4" fill="var(--panel)" stroke="var(--teal)" strokeWidth="1.6" />)}

        {bfPath && <path d={bfPath} fill="none" stroke="var(--coral)" strokeWidth="2.2" strokeLinejoin="round" opacity="0.95" />}
        {bfIn.map((p, i) => (
          <circle key={`bf-${p.date}-${i}`} cx={X(p.date)} cy={YB(p.bf)} r="2.8" fill="var(--coral)" />
        ))}

        {goal?.target_weight != null && goal.target_date >= x0 && goal.target_date <= x1 && (
          <g>
            <circle cx={X(goal.target_date)} cy={YW(goal.target_weight)} r="4.5" fill="var(--panel)" stroke="var(--teal)" strokeWidth="2" />
            <text x={X(goal.target_date) - 6} y={YW(goal.target_weight) - 8} textAnchor="end" fontSize="10.5" fill="var(--teal)" fontWeight="700">🎯 {goal.target_weight}kg</text>
          </g>
        )}

        {evIn.map((e) => (
          <g key={e.id}>
            <line x1={X(e.date)} y1={PT + 16} x2={X(e.date)} y2={H - PB} stroke="var(--amber)" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
            <circle cx={X(e.date)} cy={PT + 8} r="9" fill="var(--amber-weak)" stroke="var(--amber)" strokeWidth="1.3" />
            <text x={X(e.date)} y={PT + 12} textAnchor="middle" fontSize="10.5">🍺</text>
          </g>
        ))}
      </svg>
      <div className="chart-legend" style={{ justifyContent: 'center' }}>
        <span><i style={{ background: 'var(--teal)' }} />体重（7日移動平均）</span>
        {wPlan.length === 2 && <span><i style={{ background: 'var(--teal)', opacity: 0.5 }} />体重の計画</span>}
        {bfIn.length > 0 && <span><i style={{ background: 'var(--coral)' }} />体脂肪率（AI推定・右軸）</span>}
        {bfPlan.length === 2 && <span><i style={{ background: 'var(--coral)', opacity: 0.5 }} />体脂肪率の計画</span>}
        {evIn.length > 0 && <span>🍺 チートデイ</span>}
      </div>
    </>
  );
}
