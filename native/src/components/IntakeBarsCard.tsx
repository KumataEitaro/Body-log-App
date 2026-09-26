// 摂取カロリーの棒グラフ（食事の分析ページの先頭・2026-09-26）
//
// 熊田さんが参考にした他社アプリ（Calorie Tracker の Insights）: 上に 7D/30D/90D の切替、
// 「Calories  avg 1,742 kcal」、日別の緑の棒に点線の目標ライン。
//   ・棒: 目標以下（クリア）＝緑（C.success）／超過＝アンバー（C.amber）／未記録日＝空
//     （曜日ヒートマップと同じ色の意味。緑＝達成・アンバー＝注意）
//   ・目標ライン: 区間の平均目標を点線で（SimpleChart の目標線と同じ描き方）。色の判定は **その日の目標** で行う
//   ・y 軸は 0 起点で 3〜4 目盛り、x 軸は最初／中央／最後の日付だけ
//   ・区間の選択は 'bl-intake-bars-range' に保存（サインアウトで消える側・lib/signOutCleanup.ts）
// 集計は lib/intakeBars.ts（純関数・jest あり）。このファイルは色と形だけ。
// マウントは概要タブ（changes.tsx）が行い、日別の { date, intake, goal } を渡す。
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Rect, Line as SvgLine, Text as SvgText } from 'react-native-svg';
import { ChartColumn } from 'lucide-react-native';
import { C, rgba, themed, ICON } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { todayJST } from '@/lib/calc';
import { SegmentedControl } from '@/components/ui/Selectable';
import {
  type IntakeRow, type IntakeRange, INTAKE_RANGES, DEFAULT_INTAKE_RANGE, parseIntakeRange, intakeBarsStats,
} from '@/lib/intakeBars';

export type { IntakeRow } from '@/lib/intakeBars';

const RANGE_KEY = 'bl-intake-bars-range';
// viewBox 座標系（SimpleChart と同じ流儀: width 100% で拡縮、右に目盛りラベルの余白）
const W = 340, H = 170, PL = 8, PR = 44, PT = 10, PB = 20;

function rangeLabel(d: IntakeRange): string {
  return d === 7 ? t('7日') : d === 30 ? t('30日') : t('90日');
}

export default function IntakeBarsCard({ rows }: {
  /** 日別の摂取kcal と、その日の目標kcal（概要タブが集計済みのものを渡す）。date は 'YYYY-MM-DD' */
  rows: IntakeRow[];
}) {
  const [range, setRange] = useState<IntakeRange>(DEFAULT_INTAKE_RANGE);
  useEffect(() => {
    AsyncStorage.getItem(RANGE_KEY).then((v) => { if (v != null) setRange(parseIntakeRange(v)); }).catch(() => {});
  }, []);
  function pickRange(v: IntakeRange) {
    setRange(v);
    AsyncStorage.setItem(RANGE_KEY, String(v)).catch(() => {});
  }

  const today = todayJST();
  const stat = useMemo(() => intakeBarsStats(rows, range, today), [rows, range, today]);
  const { bars, avg, recorded, within, over, goalAvg, ticks } = stat;
  const top = ticks[ticks.length - 1];

  // 棒の幅と隙間: 7日は広めに、90日は隙間を詰めて 1 本ずつが潰れないように
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const slot = plotW / bars.length;
  const gapRatio = bars.length <= 7 ? 0.36 : bars.length <= 30 ? 0.28 : 0.14;
  const barW = Math.max(1, slot * (1 - gapRatio));
  const x = (i: number) => PL + i * slot + (slot - barW) / 2;
  const y = (v: number) => PT + (1 - v / top) * plotH;
  const fmtD = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const fmtK = (v: number) => Math.round(v).toLocaleString();
  const mid = Math.floor((bars.length - 1) / 2);
  const xLabels = bars.length >= 3 ? [0, mid, bars.length - 1] : bars.map((_, i) => i);

  return (
    <View style={s.card} testID="intake-bars-card">
      <View style={s.h2Row}>
        <ChartColumn size={ICON.md} color={C.teal} />
        <Text style={s.h2} numberOfLines={1}>
          {t('摂取カロリー')}
          <Text style={s.h2sub}>{t('— 日ごとの摂取と目標')}</Text>
        </Text>
        {avg != null && (
          <Text style={s.avgT} testID="intake-bars-avg">
            {t('平均')} <Text style={s.avgN}>{fmtK(avg)}</Text><Text style={s.avgU}>kcal</Text>
          </Text>
        )}
      </View>

      <SegmentedControl
        options={INTAKE_RANGES.map((d) => ({ key: String(d), label: rangeLabel(d) }))}
        value={String(range)}
        onChange={(k) => pickRange(parseIntakeRange(k))}
      />

      {recorded === 0 ? (
        <View style={s.empty}><Text style={s.emptyT}>{t('この期間には摂取の記録がありません')}</Text></View>
      ) : (
        <View style={{ marginTop: 10 }}>
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
            {/* 目盛り線とラベル（右） */}
            {ticks.map((v, i) => (
              <SvgLine key={`g${i}`} x1={PL} y1={y(v)} x2={W - PR + 4} y2={y(v)} stroke={C.line} strokeWidth={1} />
            ))}
            {ticks.map((v, i) => (
              <SvgText key={`l${i}`} x={W - PR + 8} y={y(v) + 3.5} fontSize={11} fill={C.faint}>{fmtK(v)}</SvgText>
            ))}
            {/* 棒: クリア＝緑・超過＝アンバー・目標が分からない日＝アクセント。未記録日は描かない */}
            {bars.map((b, i) => {
              if (b.intake == null) return null;
              const h = Math.max(1.5, y(0) - y(Math.min(b.intake, top)));
              const fill = b.over === true ? C.amber : b.over === false ? C.success : C.teal;
              return <Rect key={b.date} x={x(i)} y={y(0) - h} width={barW} height={h} rx={Math.min(3, barW / 2)} fill={fill} />;
            })}
            {/* 目標ライン（点線・SimpleChart と同じ見た目） */}
            {goalAvg != null && goalAvg <= top && (
              <SvgLine x1={PL} y1={y(goalAvg)} x2={W - PR} y2={y(goalAvg)}
                       stroke={C.ink} strokeWidth={1.4} strokeDasharray="6 5" opacity={0.35} />
            )}
            {/* x 軸: 最初／中央／最後の日付だけ */}
            {xLabels.map((i, k) => (
              <SvgText key={`x${i}`} x={k === 0 ? PL : k === xLabels.length - 1 ? W - PR : x(i) + barW / 2}
                       y={H - 5} fontSize={11} fill={C.faint}
                       textAnchor={k === 0 ? 'start' : k === xLabels.length - 1 ? 'end' : 'middle'}>
                {fmtD(bars[i].date)}
              </SvgText>
            ))}
          </Svg>

          {/* 凡例＋日数。曜日ヒートマップと同じ語（目標内／超過） */}
          <View style={s.legend}>
            <View style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: C.success }]} />
              <Text style={s.legendT}>{t('目標内')} {t('{n}日', { n: within })}</Text>
            </View>
            <View style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: C.amber }]} />
              <Text style={s.legendT}>{t('超過')} {t('{n}日', { n: over })}</Text>
            </View>
            {goalAvg != null && (
              <View style={s.legendItem}>
                <View style={[s.legendLine, { borderColor: rgba(C.ink, 0.35) }]} />
                <Text style={s.legendT}>{t('目標')} {fmtK(goalAvg)}kcal</Text>
              </View>
            )}
            <Text style={[s.legendT, { marginLeft: 'auto' }]}>{t('記録 {n} 日', { n: recorded })}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const s = themed(() => ({
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: 20, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 16, marginBottom: 12 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  h2: { flex: 1, fontSize: 17, fontWeight: '800', color: C.ink },
  h2sub: { fontSize: 12, fontWeight: '700', color: C.faint },
  avgT: { fontSize: 12, fontWeight: '700', color: C.sub },
  avgN: { fontSize: 15, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  avgU: { fontSize: 12, fontWeight: '700', color: C.sub },
  empty: { height: 100, alignItems: 'center', justifyContent: 'center' },
  emptyT: { fontSize: 13, color: C.sub },
  legend: { flexDirection: 'row', gap: 12, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendLine: { width: 14, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed' },
  legendT: { fontSize: 11, color: C.faint, fontWeight: '700', fontVariant: ['tabular-nums'] },
}));
