// 保存前のライブプレビューバー
// 確定分（ソリッド）の先に、トレイの未保存分を「呼吸するゴースト」として重ねる。
// 量が変わるたびにスプリングで伸縮し、目標を超える瞬間に色が赤へ切り替わる。
import { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import { C } from '@/lib/ui';
import { previewFill, previewFillSplit } from '@/lib/preview';

/**
 * 全バーで共有する「呼吸」アニメーション（0.35⇄0.95を往復）。
 * active=false（トレイが空）のときは止める: 幅アニメはJSスレッドで動くため、
 * 出番のない間まで回すとスクロールのコマ落ちとバッテリー消費につながる。
 */
export function usePulse(active = true): Animated.Value {
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (!active) { pulse.setValue(0.5); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.95, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, active]);
  return pulse;
}

/**
 * ソリッド＋ゴーストの2層バー。
 * eaten=確定分 / staged=トレイの未保存分 / target=1日の目標。
 * 幅はスプリング（バウンド少なめ）で追従し、ゴーストはpulseで明滅する。
 */
export function LiveBar({ eaten, staged, target, color, height = 5, pulse, radius = 3 }: {
  eaten: number; staged: number; target: number;
  color: string; height?: number; pulse: Animated.Value; radius?: number;
}) {
  const { basePct, ghostPct, over } = previewFill(eaten, staged, target);
  const baseW = useRef(new Animated.Value(basePct)).current;
  const ghostW = useRef(new Animated.Value(ghostPct)).current;

  useEffect(() => {
    // friction高め＝上品な減衰。チップ連打でも暴れない
    Animated.spring(baseW, { toValue: basePct, friction: 9, tension: 70, useNativeDriver: false }).start();
    Animated.spring(ghostW, { toValue: ghostPct, friction: 7, tension: 60, useNativeDriver: false }).start();
  }, [basePct, ghostPct, baseW, ghostW]);

  const fill = over ? C.coral : color;
  return (
    <View style={[s.track, { height, borderRadius: radius }]}>
      <Animated.View style={{
        width: baseW.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
        height: '100%', backgroundColor: fill,
        borderTopLeftRadius: radius, borderBottomLeftRadius: radius,
      }} />
      {staged > 0 && (
        <Animated.View style={{
          width: ghostW.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
          height: '100%', backgroundColor: fill, opacity: pulse,
          borderTopRightRadius: radius, borderBottomRightRadius: radius,
        }} />
      )}
    </View>
  );
}

/** ヒーローの既存バーの先端に重ねる、未保存分だけのゴーストセグメント */
export function GhostSegment({ pct, color, pulse }: { pct: number; color: string; pulse: Animated.Value }) {
  const w = useRef(new Animated.Value(pct)).current;
  useEffect(() => {
    Animated.spring(w, { toValue: pct, friction: 7, tension: 60, useNativeDriver: false }).start();
  }, [pct, w]);
  if (pct <= 0) return null;
  return (
    <Animated.View style={{
      width: w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
      height: '100%', backgroundColor: color, opacity: pulse,
    }} />
  );
}

const s = StyleSheet.create({
  track: { flex: 1, backgroundColor: C.track, overflow: 'hidden', flexDirection: 'row' },
});

/**
 * トレイのゴーストを「他の食品」と「注目中の1品」に分けて描く。
 * 注目中は不透明＋白い縁で浮かせ、他は薄く沈める。
 * どの食品がどれだけバーを埋めているかを、選ぶだけで確かめられる。
 */
export function GhostPair({ eaten, others, focus, target, color, pulse }: {
  eaten: number; others: number; focus: number; target: number;
  color: string; pulse: Animated.Value;
}) {
  const { othersPct, focusPct, over } = previewFillSplit(eaten, others, focus, target);
  const oW = useRef(new Animated.Value(othersPct)).current;
  const fW = useRef(new Animated.Value(focusPct)).current;

  useEffect(() => {
    Animated.spring(oW, { toValue: othersPct, friction: 7, tension: 60, useNativeDriver: false }).start();
    Animated.spring(fW, { toValue: focusPct, friction: 7, tension: 60, useNativeDriver: false }).start();
  }, [othersPct, focusPct, oW, fW]);

  const fill = over ? C.coral : color;
  const pct = (v: Animated.Value) => v.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  const focusing = focus > 0;

  return (
    <>
      {others > 0 && (
        <Animated.View style={{
          width: pct(oW), height: '100%', backgroundColor: fill,
          opacity: focusing ? 0.28 : pulse,   // 注目中は他を沈める
        }} />
      )}
      {focusing && (
        <Animated.View style={{
          width: pct(fW), height: '100%', backgroundColor: fill,
          borderLeftWidth: 1.5, borderLeftColor: '#ffffff',
        }} />
      )}
    </>
  );
}
