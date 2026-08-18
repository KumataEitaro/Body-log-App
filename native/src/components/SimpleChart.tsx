// シンプルな折れ線チャート（react-native-svg）。Phase 2の基本版。
// ピンチ操作・多段ビン等のリッチ版はPhase 3で移植する。
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Line as SvgLine, Text as SvgText, Circle } from 'react-native-svg';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';

export type ChartPoint = { date: string; value: number };

const W = 340, H = 180, PL = 8, PR = 44, PT = 12, PB = 22;

export default function SimpleChart({ points, unit, decimals = 1, planValue }: {
  points: ChartPoint[];
  unit: string;
  decimals?: number;
  planValue?: number | null; // 目標線（水平・任意）
}) {
  if (points.length < 2) {
    return <View style={s.empty}><Text style={s.emptyT}>{t('記録が2件以上たまるとグラフが描かれます')}</Text></View>;
  }
  const vals = points.map((p) => p.value);
  const withPlan = planValue != null ? [...vals, planValue] : vals;
  let min = Math.min(...withPlan), max = Math.max(...withPlan);
  const pad = Math.max((max - min) * 0.1, 0.5);
  min -= pad; max += pad;
  const t0 = new Date(points[0].date + 'T00:00:00').getTime();
  const t1 = new Date(points[points.length - 1].date + 'T00:00:00').getTime();
  const span = Math.max(1, t1 - t0);
  const x = (d: string) => PL + ((new Date(d + 'T00:00:00').getTime() - t0) / span) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - min) / (max - min)) * (H - PT - PB);
  const pts = points.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const fmt = (v: number) => decimals === 0 ? Math.round(v).toLocaleString() : v.toFixed(decimals);
  const yTicks = [min + pad, (min + max) / 2, max - pad];
  const fmtD = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const crossYear = points[0].date.slice(0, 4) !== last.date.slice(0, 4);
  const fmtX = (d: string) => crossYear ? `${d.slice(2, 4)}/${fmtD(d)}` : fmtD(d);

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {yTicks.map((t, i) => (
          <SvgLine key={i} x1={PL} y1={y(t)} x2={W - PR + 4} y2={y(t)} stroke={C.line} strokeWidth={1} />
        ))}
        {yTicks.map((t, i) => (
          <SvgText key={`l${i}`} x={W - PR + 8} y={y(t) + 3.5} fontSize={10} fill={C.faint}>{fmt(t)}</SvgText>
        ))}
        {planValue != null && (
          <SvgLine x1={PL} y1={y(planValue)} x2={W - PR} y2={y(planValue)}
                   stroke={C.ink} strokeWidth={1.4} strokeDasharray="6 5" opacity={0.35} />
        )}
        <Polyline points={pts} fill="none" stroke={C.teal} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={x(last.date)} cy={y(last.value)} r={3.5} fill={C.teal} />
        <SvgText x={PL} y={H - 6} fontSize={10} fill={C.faint}>{fmtX(points[0].date)}</SvgText>
        <SvgText x={W - PR} y={H - 6} fontSize={10} fill={C.faint} textAnchor="end">{fmtX(last.date)}</SvgText>
      </Svg>
      <Text style={s.latest}>{t('最新')} {fmt(last.value)}{unit}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  empty: { height: 120, alignItems: 'center', justifyContent: 'center' },
  emptyT: { fontSize: 12, color: C.sub },
  latest: { fontSize: 11, color: C.sub, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
