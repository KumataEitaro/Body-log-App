// Withings風インタラクティブチャート（案A: react-native-svg直描画＋gesture-handler）
// - ピンチ=時間軸ズーム / パン=期間移動 / ダブルタップ=リセット
// - 生データ（薄グレー線＋点）の上に移動平均のベジェ曲線を重ねる二重レイヤー
// - Y軸は表示範囲にniceフィット・X目盛りはズームに応じ日/月/年へ自動切替
// - ⤢で全画面モーダル展開
import { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Dimensions } from 'react-native';
import Svg, { Path, Line, Circle, Text as SvgText } from 'react-native-svg';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import { C } from '@/lib/ui';
import {
  type RawPoint, dateToIdx, idxToDate, unitForDays, MA_WINDOW,
  binPoints, movingAvg, niceTicks, xTicks, smoothPath, linePath,
} from '@/lib/chartMath';
import { t } from '@/lib/i18n';

export type ChartPoint = RawPoint;

type Props = {
  points: RawPoint[];
  unit?: string;
  decimals?: number;
  planValue?: number | null;
  presetDays?: number | null; // 30/90など。null=全期間。変更で窓リセット
  height?: number;
  color?: string;
  fullscreenEnabled?: boolean; // 全画面内での再帰を防ぐ
  onDaysChange?: (days: number, isFull: boolean) => void; // ピンチ/パン後に実際の表示日数を親へ通知（期間チップの追従用）
};

const PAD_L = 8, PAD_R = 44, PAD_T = 10, PAD_B = 22;

function Inner({ points, unit = '', decimals = 1, planValue = null, presetDays = 90, height = 200, color = C.teal, fullscreenEnabled = true, onDaysChange }: Props) {
  const [width, setWidth] = useState(0);
  const [fs, setFs] = useState(false);

  const sorted = useMemo(() => [...points].sort((a, b) => (a.date < b.date ? -1 : 1)), [points]);
  const firstIdx = sorted.length ? dateToIdx(sorted[0].date) : 0;
  const lastIdx = sorted.length ? dateToIdx(sorted[sorted.length - 1].date) : 0;
  const span = Math.max(7, lastIdx - firstIdx + 1);

  // 表示窓（end=右端の日連番・days=表示日数。floatで滑らかに）
  const initDays = Math.min(presetDays ?? span, span);
  const [win, setWin] = useState({ end: lastIdx + 1, days: initDays });
  useEffect(() => { setWin({ end: lastIdx + 1, days: Math.min(presetDays ?? span, span) }); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presetDays, lastIdx]);

  const reportDays = (days: number) => onDaysChange?.(Math.round(days), days >= span * 0.95);

  const plotW = Math.max(10, width - PAD_L - PAD_R);
  const plotH = height - PAD_T - PAD_B;
  const startF = win.end - win.days;

  // ===== データ準備（ズームに応じたビン＋移動平均） =====
  // ビン単位はヒステリシス付きで切替（境界60日/400日ちょうどでの行き来チラつきを防ぐ）
  const unitRef = useRef(unitForDays(win.days));
  {
    let u = unitRef.current;
    for (let i = 0; i < 3; i++) {
      if (u === 'day' && win.days > 68) u = 'week';
      else if (u === 'week' && win.days > 430) u = 'month';
      else if (u === 'month' && win.days < 370) u = 'week';
      else if (u === 'week' && win.days < 52) u = 'day';
      else break;
    }
    unitRef.current = u;
  }
  const binUnit = unitRef.current;
  const bins = useMemo(() => binPoints(sorted, binUnit), [sorted, binUnit]);
  const trend = useMemo(() => movingAvg(bins, MA_WINDOW[binUnit]), [bins, binUnit]);

  const visTrend = trend.filter((b) => b.idx >= startF - 3 && b.idx <= win.end + 3);
  const showRaw = win.days <= 400;
  const visRaw = showRaw ? sorted.map((p) => ({ idx: dateToIdx(p.date), value: p.value }))
    .filter((b) => b.idx >= startF - 1 && b.idx <= win.end + 1) : [];

  // ===== Yドメイン（表示中データにniceフィット・目標線も範囲内なら含める） =====
  const values = [...visTrend.map((b) => b.value), ...visRaw.map((b) => b.value)];
  if (values.length === 0) values.push(0, 1);
  let vMin = Math.min(...values), vMax = Math.max(...values);
  if (planValue != null && planValue > vMin - (vMax - vMin) && planValue < vMax + (vMax - vMin)) {
    vMin = Math.min(vMin, planValue); vMax = Math.max(vMax, planValue);
  }
  const { ticks, lo, hi } = niceTicks(vMin, vMax, fs ? 10 : 8);

  const x = (idx: number) => PAD_L + ((idx - startF) / win.days) * plotW;
  const y = (v: number) => PAD_T + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * plotH;

  const trendPts = visTrend.map((b) => ({ x: x(b.idx), y: y(b.value) }));
  const rawPts = visRaw.map((b) => ({ x: x(b.idx), y: y(b.value) }));
  const xtks = xTicks(startF, win.end, Math.max(6, Math.round(plotW / 30)));

  // 期間ヘッダーと傾向（表示中トレンドの端点差）
  const delta = visTrend.length >= 2 ? visTrend[visTrend.length - 1].value - visTrend[0].value : null;

  // ===== ジェスチャー =====
  const clampWin = (end: number, days: number) => {
    const d = Math.min(Math.max(7, days), span);
    let e = Math.min(end, lastIdx + 1 + d * 0.05);
    e = Math.max(e, firstIdx + d * 0.5);
    return { end: e, days: d };
  };

  // ジェスチャー開始時の窓のスナップショット。
  // 【重要1】ローカル変数だと再描画のたびに再初期化され複利ズームになる → refで保持
  // 【重要2】パンとピンチでrefを共有すると、同時発火時に互いの開始値を壊す → 別々に保持
  const panStart = useRef({ end: 0, days: 0 });
  const pinchStart = useRef({ end: 0, days: 0 });
  // リフトオフ・ノイズ対策: 指が離れる直前の数十msは指間距離が物理的に暴れるため、
  // ピンチ中の窓履歴を持ち、終了時は「90ms前の状態」に確定する（離れ際の入力を捨てる）
  const pinchHist = useRef<{ t: number; end: number; days: number }[]>([]);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .maxPointers(1) // 【指を離した瞬間に縮尺が跳ぶバグの修正】
    // 2本指ピンチ中は重心移動でパンも同時発火し、パンが「開始時のdays」を
    // 書き戻し続けていた。指を離す瞬間、最後の書き込みがパン側になると
    // ズームが一気に巻き戻る。パンを1本指専用にしてピンチと完全分離する。
    .activeOffsetX([-12, 12]).failOffsetY([-16, 16]) // 縦スクロールを奪わない
    .onStart(() => { panStart.current = { end: win.end, days: win.days }; })
    .onUpdate((e) => {
      const shift = (-e.translationX / plotW) * panStart.current.days;
      setWin(clampWin(panStart.current.end + shift, panStart.current.days));
    })
    .onEnd(() => reportDays(win.days));
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      pinchStart.current = { end: win.end, days: win.days };
      pinchHist.current = [];
    })
    .onUpdate((e) => {
      const fx = Math.min(1, Math.max(0, ((e.focalX ?? plotW / 2) - PAD_L) / plotW));
      const focalIdx = (pinchStart.current.end - pinchStart.current.days) + fx * pinchStart.current.days;
      // 複利バグ解消後はWithings同等のほぼ物理1:1（縦成分の混入だけ軽く減衰）
      const damped = Math.pow(Math.max(0.2, e.scale), 0.9);
      const newDays = Math.min(Math.max(7, pinchStart.current.days / damped), span);
      const target = clampWin(focalIdx + (1 - fx) * newDays, newDays);
      // 履歴に積む（400msより古いものは捨てる）
      const now = Date.now();
      pinchHist.current.push({ t: now, end: target.end, days: target.days });
      while (pinchHist.current.length > 0 && now - pinchHist.current[0].t > 400) pinchHist.current.shift();
      // Withings風のローパス: 指に数フレーム遅れてぬるっと追従させる
      setWin((prev) => ({
        end: prev.end + (target.end - prev.end) * 0.5,
        days: prev.days + (target.days - prev.days) * 0.5,
      }));
    })
    .onEnd(() => {
      // 離れ際90msの暴れを無効化: それ以前の最後の状態へ確定する
      const cutoff = Date.now() - 90;
      const stable = [...pinchHist.current].reverse().find((h) => h.t <= cutoff);
      if (stable) {
        setWin(clampWin(stable.end, stable.days));
        reportDays(stable.days);
      } else {
        reportDays(win.days);
      }
      pinchHist.current = [];
    });
  const doubleTap = Gesture.Tap().numberOfTaps(2).runOnJS(true)
    .onEnd(() => {
      const d = Math.min(presetDays ?? span, span);
      setWin({ end: lastIdx + 1, days: d });
      reportDays(d);
    });
  const gesture = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, pan));

  if (sorted.length < 2) {
    return <View style={[s.empty, { height }]}><Text style={s.emptyT}>{t('記録が2件以上たまるとグラフが描かれます')}</Text></View>;
  }

  const latest = sorted[sorted.length - 1];
  const fmtIdx = (i: number) => {
    const d = idxToDate(Math.round(i));
    return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  };

  return (
    <View>
      {/* 期間・傾向ヘッダー */}
      <View style={s.head}>
        <Text style={s.range}>{idxToDate(Math.max(firstIdx, Math.round(startF))).replace(/-/g, '/')} 〜 {idxToDate(Math.min(lastIdx, Math.round(win.end))).replace(/-/g, '/')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {delta != null && (
            <Text style={[s.delta, { color: delta <= 0 ? C.teal : C.coral }]}>
              {delta > 0 ? '+' : ''}{delta.toFixed(decimals)}{unit}
            </Text>
          )}
          {fullscreenEnabled && (
            <Pressable onPress={() => setFs(true)} hitSlop={8} style={s.fsBtn}><Text style={s.fsBtnT}>⤢</Text></Pressable>
          )}
        </View>
      </View>

      <GestureHandlerRootView>
        <GestureDetector gesture={gesture}>
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} collapsable={false}>
            {width > 0 && (
              <Svg width={width} height={height}>
                {/* 横グリッド＋右側Yラベル */}
                {ticks.map((t) => (
                  <Line key={`h${t}`} x1={PAD_L} y1={y(t)} x2={PAD_L + plotW} y2={y(t)} stroke={C.line} strokeWidth={0.5} />
                ))}
                {ticks.map((t) => (
                  <SvgText key={`hl${t}`} x={width - PAD_R + 6} y={y(t) + 3.5} fontSize={9.5} fill={C.faint}>
                    {t.toFixed(decimals > 0 && hi - lo < 10 ? decimals : 0)}
                  </SvgText>
                ))}
                {/* 縦グリッド（全境界に引く・ラベル付きはやや濃く） */}
                {xtks.map((t) => (
                  <Line key={`v${t.idx}`} x1={x(t.idx)} y1={PAD_T} x2={x(t.idx)} y2={PAD_T + plotH}
                        stroke={t.label ? '#d5d9d3' : C.line} strokeWidth={0.5} strokeDasharray={t.label ? undefined : '2,3'} />
                ))}
                {xtks.filter((t) => t.label !== '').map((t) => (
                  <SvgText key={`vl${t.idx}`} x={x(t.idx)} y={height - 7} fontSize={9} fill={C.sub} textAnchor="middle">{t.label}</SvgText>
                ))}
                {/* 目標線 */}
                {planValue != null && planValue >= lo && planValue <= hi && (
                  <Line x1={PAD_L} y1={y(planValue)} x2={PAD_L + plotW} y2={y(planValue)} stroke={C.sub} strokeWidth={1} strokeDasharray="5,4" />
                )}
                {/* 生データレイヤー（薄グレー） */}
                {rawPts.length >= 2 && <Path d={linePath(rawPts)} stroke="#c9cdc7" strokeWidth={1} fill="none" />}
                {win.days <= 95 && rawPts.map((p, i) => (
                  <Circle key={i} cx={p.x} cy={p.y} r={2} fill="#b3b8b1" />
                ))}
                {/* トレンド曲線（ベジェ） */}
                {trendPts.length >= 2 && <Path d={smoothPath(trendPts)} stroke={color} strokeWidth={2.5} fill="none" />}
                {/* 最新点の強調 */}
                {trendPts.length > 0 && (
                  <Circle cx={trendPts[trendPts.length - 1].x} cy={trendPts[trendPts.length - 1].y} r={4} fill={color} />
                )}
              </Svg>
            )}
          </View>
        </GestureDetector>
      </GestureHandlerRootView>

      <View style={s.foot}>
        <Text style={s.footT}>{t('最新')} {Number(latest.value).toFixed(decimals)}{unit}（{fmtIdx(dateToIdx(latest.date))}）</Text>
        <Text style={s.footHint}>{t('ピンチで拡大・ドラッグで移動・2回タップで戻す')}</Text>
      </View>

      {/* 全画面モーダル */}
      {fullscreenEnabled && (
        <Modal visible={fs} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setFs(false)}>
          <View style={s.fsWrap}>
            <View style={s.fsHead}>
              <Text style={s.fsTitle}>{t('推移の詳細')}</Text>
              <Pressable onPress={() => setFs(false)} hitSlop={10}><Text style={s.fsClose}>{t('✕ 閉じる')}</Text></Pressable>
            </View>
            <Inner
              points={points} unit={unit} decimals={decimals} planValue={planValue}
              presetDays={presetDays} color={color} fullscreenEnabled={false}
              height={Math.round(Dimensions.get('window').height * 0.66)}
            />
          </View>
        </Modal>
      )}
    </View>
  );
}

export default function InteractiveChart(props: Props) {
  return <Inner {...props} />;
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  range: { fontSize: 11, color: C.sub, fontVariant: ['tabular-nums'] },
  delta: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  fsBtn: { width: 26, height: 26, borderRadius: 7, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  fsBtnT: { fontSize: 13, color: C.sub, fontWeight: '700' },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  footT: { fontSize: 11, color: C.sub, fontVariant: ['tabular-nums'] },
  footHint: { fontSize: 9.5, color: C.faint },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyT: { fontSize: 12.5, color: C.sub },
  fsWrap: { flex: 1, backgroundColor: C.bg, paddingTop: 64, paddingHorizontal: 16 },
  fsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  fsTitle: { fontSize: 17, fontWeight: '800', color: C.ink },
  fsClose: { fontSize: 14, fontWeight: '700', color: C.teal },
});
