'use client';
import { useState } from 'react';
import { daysBetween, addDays, movingAverage, dateTicks, plannedWeightAt, type Goal } from '@/lib/goal';
import { cumulativeDiffs, type DiffPoint } from '@/lib/series';
import { FAT_KCAL_PER_KG } from '@/lib/calc';

export type WeightPoint = { date: string; weight: number };
export type ChartEvent = { id: string; date: string };

type Period = '30d' | '90d' | 'all' | 'plan';
const PERIODS: { key: Period; label: string }[] = [
  { key: '30d', label: '月' },
  { key: '90d', label: '3か月' },
  { key: 'all', label: '全期間' },
  { key: 'plan', label: '計画' },
];

const fmtK = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) % 1000 === 0 ? 0 : 1)}k` : String(v));

/**
 * 進捗と計画を1枚に統合したチャート。
 * ・主役: 体重の推移（7日移動平均・実線）＋ 計画線（破線）＋ 目標マーカー
 * ・背景: カロリー収支の累積（面。下に貯まるほど"貯金"）
 * ・チートデイ🍺マーカー
 */
export default function ProgressChart({
  goal, weights, points, events, today,
}: {
  goal: Goal | null;
  weights: WeightPoint[];
  points: DiffPoint[];
  events: ChartEvent[];
  today: string;
}) {
  const [period, setPeriod] = useState<Period>(goal ? 'plan' : '30d');
  if (weights.length === 0 && points.length === 0) {
    return <p className="muted center" style={{ padding: '20px 0' }}>記録がたまるとここに推移が表示されます。</p>;
  }

  // ===== 表示期間 =====
  const firstDates = [
    weights.length ? weights[0].date : null,
    points.length ? [...points].sort((a, b) => (a.date < b.date ? -1 : 1))[0].date : null,
    goal?.start_date ?? null,
  ].filter(Boolean) as string[];
  const earliest = firstDates.sort()[0] ?? today;
  const lastRec = weights.length ? weights[weights.length - 1].date : today;
  const latestData = lastRec > today ? lastRec : today;

  let x0: string, x1: string;
  if (period === 'plan' && goal) {
    x0 = earliest;
    x1 = goal.target_date > latestData ? goal.target_date : latestData;
  } else if (period === 'all') {
    x0 = earliest; x1 = latestData;
  } else {
    const days = period === '90d' ? 90 : 30;
    x0 = addDays(today, -days); x1 = today;
  }
  if (x1 <= x0) x1 = addDays(x0, 1);
  const totalDays = Math.max(daysBetween(x0, x1), 1);

  // ===== データ =====
  const wIn = weights.filter((p) => p.date >= x0 && p.date <= x1);
  const maIn = movingAverage(weights, 7).filter((p) => p.date >= x0 && p.date <= x1);
  const evIn = events.filter((e) => e.date >= x0 && e.date <= x1);

  const cumAll = cumulativeDiffs(points);
  const cumIn = cumAll.filter((p) => p.date >= x0 && p.date <= x1);
  const latestCum = cumAll.length ? cumAll[cumAll.length - 1].v : 0;
  const fatKg = Math.round((latestCum / FAT_KCAL_PER_KG) * 100) / 100;

  const wPlan: { d: string; v: number }[] = [];
  if (goal?.target_weight != null) {
    const p0 = x0 > goal.start_date ? x0 : goal.start_date;
    const p1 = x1 < goal.target_date ? x1 : goal.target_date;
    if (p0 <= p1) wPlan.push({ d: p0, v: plannedWeightAt(goal, p0)! }, { d: p1, v: plannedWeightAt(goal, p1)! });
  }

  const seg = (
    <div className="seg">
      {PERIODS.filter((p) => p.key !== 'plan' || goal).map((p) => (
        <button key={p.key} className={period === p.key ? 'active' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>
      ))}
    </div>
  );

  // ===== スケール =====
  const W = 380, H = 240, PL = 34, PR = 12, PT = 20, PB = 26;
  const X = (d: string) => PL + (Math.min(Math.max(daysBetween(x0, d), 0), totalDays) / totalDays) * (W - PL - PR);

  const wys = [...wIn.map((p) => p.weight), ...maIn.map((p) => p.weight), ...wPlan.map((p) => p.v)];
  const hasWeight = wys.length > 0;
  const wMax = hasWeight ? Math.ceil(Math.max(...wys) + 0.5) : 1;
  const wMin = hasWeight ? Math.floor(Math.min(...wys) - 0.5) : 0;
  const YW = (v: number) => PT + (1 - (v - wMin) / Math.max(wMax - wMin, 1)) * (H - PT - PB);

  // 累積カロリー: 背景の面。0を必ず含め、下半分に収める（体重線の邪魔をしない）
  const cVals = cumIn.map((p) => p.v);
  const cMax = Math.max(...cVals, 0);
  const cMin = Math.min(...cVals, 0);
  const cTop = H - PT - PB; // プロット高
  const YC = (v: number) => PT + cTop * 0.42 + (1 - (v - cMin) / Math.max(cMax - cMin, 1)) * cTop * 0.5;

  const cumLine = cumIn.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.date).toFixed(1)},${YC(p.v).toFixed(1)}`).join(' ');
  const cumArea = cumIn.length
    ? `${cumLine} L${X(cumIn[cumIn.length - 1].date).toFixed(1)},${YC(0).toFixed(1)} L${X(cumIn[0].date).toFixed(1)},${YC(0).toFixed(1)} Z`
    : '';

  const toPathW = (pts: WeightPoint[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.date).toFixed(1)},${YW(p.weight).toFixed(1)}`).join(' ');

  const grid: React.ReactNode[] = [];
  if (hasWeight) {
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

  return (
    <>
      {seg}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="体重の推移と計画・カロリー収支">
        {grid}

        {/* 背景: 累積カロリー収支の面 */}
        {cumArea && <path d={cumArea} fill={latestCum <= 0 ? 'var(--green)' : 'var(--coral)'} opacity="0.12" />}
        {cumArea && <path d={cumLine} fill="none" stroke={latestCum <= 0 ? 'var(--green)' : 'var(--coral)'} strokeWidth="1.4" opacity="0.5" />}

        {/* 日付目盛り */}
        {dateTicks(x0, x1, 4).map((d) => (
          <text key={d} x={X(d)} y={H - PB + 14} textAnchor="middle" fontSize="10" fill="var(--sub)">{d.slice(5).replace('-', '/')}</text>
        ))}

        {/* 今日ライン */}
        {today >= x0 && today <= x1 && (
          <>
            <line x1={X(today)} y1={PT} x2={X(today)} y2={H - PB} stroke="var(--sub)" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.7" />
            <text x={X(today)} y={PT - 6} textAnchor="middle" fontSize="10" fill="var(--sub)" fontWeight="700">今日</text>
          </>
        )}

        {/* 体重の計画線 */}
        {wPlan.length === 2 && (
          <line x1={X(wPlan[0].d)} y1={YW(wPlan[0].v)} x2={X(wPlan[1].d)} y2={YW(wPlan[1].v)}
                stroke="var(--teal)" strokeWidth="1.8" strokeDasharray="7 5" opacity="0.6" />
        )}

        {/* 体重（実測: 生を薄く／7日移動平均を濃く） */}
        {wIn.length > 0 && <path d={toPathW(wIn)} fill="none" stroke="var(--sub)" strokeWidth="1.1" opacity="0.3" />}
        {maIn.length > 0 && <path d={toPathW(maIn)} fill="none" stroke="var(--teal)" strokeWidth="2.6" strokeLinejoin="round" />}
        {maIn.map((p) => <circle key={p.date} cx={X(p.date)} cy={YW(p.weight)} r="2.4" fill="var(--panel)" stroke="var(--teal)" strokeWidth="1.6" />)}

        {/* 目標マーカー */}
        {goal?.target_weight != null && goal.target_date >= x0 && goal.target_date <= x1 && (
          <g>
            <circle cx={X(goal.target_date)} cy={YW(goal.target_weight)} r="4.5" fill="var(--panel)" stroke="var(--teal)" strokeWidth="2" />
            <text x={X(goal.target_date) - 6} y={YW(goal.target_weight) - 8} textAnchor="end" fontSize="10.5" fill="var(--teal)" fontWeight="700">🎯 {goal.target_weight}kg</text>
          </g>
        )}

        {/* チートデイ */}
        {evIn.map((e) => (
          <g key={e.id}>
            <line x1={X(e.date)} y1={PT + 16} x2={X(e.date)} y2={H - PB} stroke="var(--amber)" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
            <circle cx={X(e.date)} cy={PT + 8} r="9" fill="var(--amber-weak)" stroke="var(--amber)" strokeWidth="1.3" />
            <text x={X(e.date)} y={PT + 12} textAnchor="middle" fontSize="10.5">🍺</text>
          </g>
        ))}
      </svg>
      <div className="chart-legend" style={{ justifyContent: 'center' }}>
        <span><i style={{ background: 'var(--teal)' }} />体重（7日平均）</span>
        {wPlan.length === 2 && <span><i style={{ background: 'var(--teal)', opacity: 0.5 }} />体重の計画</span>}
        <span><i style={{ background: latestCum <= 0 ? 'var(--green)' : 'var(--coral)', opacity: 0.4 }} />カロリー収支の累積</span>
        {evIn.length > 0 && <span>🍺 チートデイ</span>}
      </div>
      {points.length > 0 && (
        <p className="center" style={{ margin: '4px 0 0', fontSize: 13 }}>
          カロリー収支 累計 <b className="num" style={{ color: latestCum <= 0 ? 'var(--green)' : 'var(--coral)' }}>{latestCum > 0 ? '+' : ''}{fmtK(latestCum)}</b> kcal
          ＝ 脂肪換算 <b className="num">{fatKg > 0 ? '+' : ''}{fatKg}</b> kg
        </p>
      )}
    </>
  );
}
