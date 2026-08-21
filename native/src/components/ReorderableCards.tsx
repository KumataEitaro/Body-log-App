// インプレイスのドラッグ並び替え（iOSホーム画面のJiggle Mode準拠・自前実装）
// - 画面遷移なし: 実データが描かれたカードそのものがその場で編集状態になる
// - 長押し(250ms)→指に追従してドラッグ。掴むと scale1.04+深い影 で浮き上がる
// - 他カードはスプリングで滑らかに退避し、離すと目標スロットへスナップ着地
// - 編集中は全カードが微振動(Jiggle)・カード内操作は停止・画面端で自動スクロール
// - gesture-handler + reanimated 4 のみ（外部D&Dライブラリ不使用＝白画面事故の構造を排除）
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions, type RefreshControlProps } from 'react-native';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, useAnimatedScrollHandler,
  withSpring, withRepeat, withSequence, withTiming, type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Minus } from 'lucide-react-native';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';

const SPRING = { damping: 18, stiffness: 180, mass: 0.6 };
const EDGE = 130;       // 自動スクロール発火ゾーン(px)
const EDGE_SPEED = 9;   // 自動スクロール速度(px/frame)

type Frame = { y: number; h: number };

type Props = {
  editing: boolean;
  order: string[];
  onOrderChange: (next: string[]) => void;
  renderCard: (key: string) => ReactNode;
  ghostLabel: (key: string) => string;
  header: ReactNode;
  onEnterEdit: () => void;
  refreshControl?: ReactElement<RefreshControlProps>;
  contentContainerStyle?: object;
  onScroller?: (scrollBy: (delta: number) => void) => void; // ガイドツアーの自動スクロール受け口
  onHide?: (key: string) => void; // 編集中に⊖でカードを非表示にする
};

export default function ReorderableCards({
  editing, order, onOrderChange, renderCard, ghostLabel, header, onEnterEdit, refreshControl, contentContainerStyle, onScroller, onHide,
}: Props) {
  const scrollRef = useRef<Animated.ScrollView>(null);
  const scrollY = useSharedValue(0);
  const scrollNow = useRef(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => { scrollY.value = e.contentOffset.y; } });

  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Record<string, number>>({});
  const [drop, setDrop] = useState<{ key: string; offset: number } | null>(null);
  const [resetNonce, setResetNonce] = useState(0);

  // ドラッグ中の計算用スナップショット
  const frames = useRef(new Map<string, Frame>());
  const snap = useRef<{ others: { key: string; top: number; h: number }[]; slots: number[]; active: Frame; k: number; gap: number; scroll0: number } | null>(null);
  const kRef = useRef(0);
  const autoScroll = useRef<ReturnType<typeof setInterval> | null>(null);
  const winH = Dimensions.get('window').height;

  useEffect(() => () => { if (autoScroll.current) clearInterval(autoScroll.current); }, []);

  // ガイドツアー用: 相対スクロール（ネイティブease付き）
  useEffect(() => {
    onScroller?.((delta) => {
      scrollNow.current = Math.max(0, scrollNow.current + delta);
      scrollRef.current?.scrollTo({ y: scrollNow.current, animated: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAutoScroll() {
    if (autoScroll.current) { clearInterval(autoScroll.current); autoScroll.current = null; }
  }

  function onDragStart(key: string) {
    const active = frames.current.get(key);
    if (!active) return;
    setScrollEnabled(false);
    setActiveKey(key);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const k0 = order.indexOf(key);
    kRef.current = k0;
    // 隣接カードとの実測ギャップ（marginBottom等を吸収）
    const sorted = order.map((o) => ({ key: o, f: frames.current.get(o)! })).filter((x) => x.f);
    let gap = 12;
    if (sorted.length >= 2) gap = Math.max(0, sorted[1].f.y - (sorted[0].f.y + sorted[0].f.h));
    const A = active.h + gap; // アクティブを抜いた時に詰まる量
    // アクティブを除いたパック配置（ドラッグ中は不変＝判定が安定する）
    const others = order.filter((o) => o !== key).map((o, j) => {
      const f = frames.current.get(o)!;
      const orig = order.indexOf(o);
      return { key: o, top: orig < k0 ? f.y : f.y - A, h: f.h, j };
    });
    // 挿入スロットkの上端位置 S_k（k=others.length は末尾）
    const slots: number[] = [];
    for (let k = 0; k <= others.length; k++) {
      slots.push(k < others.length ? others[k].top : (others.length ? others[others.length - 1].top + others[others.length - 1].h + gap : active.y));
    }
    snap.current = { others, slots, active, k: k0, gap, scroll0: scrollNow.current };
    setShifts({});
  }

  function onDragMove(key: string, translationY: number, absoluteY: number) {
    const sn = snap.current;
    if (!sn) return;
    const scrollDelta = scrollNow.current - sn.scroll0;
    const activeCenter = sn.active.y + sn.active.h / 2 + translationY + scrollDelta;
    // 各スロット中心 C_k = S_k + activeH/2 に最も近いkを選ぶ（S固定なので判定が暴れない）
    let best = 0, bestDist = Infinity;
    for (let k = 0; k < sn.slots.length; k++) {
      const c = sn.slots[k] + sn.active.h / 2;
      const d = Math.abs(activeCenter - c);
      if (d < bestDist) { bestDist = d; best = k; }
    }
    if (best !== kRef.current) {
      kRef.current = best;
      Haptics.selectionAsync().catch(() => {});
      // 退避: 挿入先k以降のotherは下へ(activeH+gap)、それ以外は0（パック位置基準の絶対シフト）
      const A = sn.active.h + sn.gap;
      const next: Record<string, number> = {};
      sn.others.forEach((o, j) => {
        const target = o.top + (j >= best ? A : 0);
        const f = frames.current.get(o.key)!;
        next[o.key] = target - f.y;
      });
      setShifts(next);
    }
    // 画面端の自動スクロール
    const dir = absoluteY < EDGE ? -1 : absoluteY > winH - EDGE ? 1 : 0;
    if (dir !== 0 && !autoScroll.current) {
      autoScroll.current = setInterval(() => {
        scrollNow.current = Math.max(0, scrollNow.current + dir * EDGE_SPEED);
        scrollRef.current?.scrollTo({ y: scrollNow.current, animated: false });
      }, 16);
    } else if (dir === 0) {
      stopAutoScroll();
    }
  }

  function onDragEnd(key: string) {
    stopAutoScroll();
    const sn = snap.current;
    if (!sn) { setActiveKey(null); setScrollEnabled(true); return; }
    const k = kRef.current;
    const targetTop = sn.slots[k];
    setDrop({ key, offset: targetTop - sn.active.y }); // 子がスプリングで着地
    const others = order.filter((o) => o !== key);
    const nextOrder = [...others.slice(0, k), key, ...others.slice(k)];
    setTimeout(() => {
      onOrderChange(nextOrder);
      setShifts({});
      setDrop(null);
      setActiveKey(null);
      setScrollEnabled(true);
      setResetNonce((n) => n + 1); // 全translateを無アニメで0へ（レイアウト確定と同時）
      snap.current = null;
    }, 230);
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Animated.ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={contentContainerStyle}
        scrollEnabled={scrollEnabled}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => { scrollNow.current = e.nativeEvent.contentOffset.y; }}
        onScrollEndDrag={(e) => { scrollNow.current = e.nativeEvent.contentOffset.y; }}
        refreshControl={editing ? undefined : refreshControl}
      >
        {header}
        {order.map((k) => (
          <DraggableCard
            key={k}
            id={k}
            editing={editing}
            active={activeKey === k}
            dimmed={activeKey != null && activeKey !== k}
            shift={shifts[k] ?? 0}
            drop={drop?.key === k ? drop.offset : null}
            resetNonce={resetNonce}
            scrollY={scrollY}
            onFrame={(f) => frames.current.set(k, f)}
            onStart={() => onDragStart(k)}
            onMove={(ty, ay) => onDragMove(k, ty, ay)}
            onEnd={() => onDragEnd(k)}
            onEnterEdit={onEnterEdit}
            onHide={onHide ? () => onHide(k) : undefined}
          >
            {renderCard(k) ?? (
              <View style={s.ghostCard}><Text style={s.ghostT}>{ghostLabel(k)}{t('（データが揃うと表示されます）')}</Text></View>
            )}
          </DraggableCard>
        ))}
      </Animated.ScrollView>
    </GestureHandlerRootView>
  );
}

function DraggableCard({
  id, editing, active, dimmed, shift, drop, resetNonce, scrollY, onFrame, onStart, onMove, onEnd, onEnterEdit, onHide, children,
}: {
  id: string;
  editing: boolean;
  active: boolean;
  dimmed: boolean;
  shift: number;
  drop: number | null;
  resetNonce: number;
  scrollY: SharedValue<number>;
  onFrame: (f: Frame) => void;
  onStart: () => void;
  onMove: (translationY: number, absoluteY: number) => void;
  onEnd: () => void;
  onEnterEdit: () => void;
  onHide?: () => void;
  children: ReactNode;
}) {
  const dragY = useSharedValue(0);
  const shiftY = useSharedValue(0);
  const scale = useSharedValue(1);
  const rot = useSharedValue(0);
  const scroll0 = useSharedValue(0);
  const isActive = useSharedValue(false);

  // Jiggle（編集中・非アクティブ時）
  useEffect(() => {
    rot.value = editing && !active
      ? withRepeat(withSequence(withTiming(-0.35, { duration: 140 }), withTiming(0.35, { duration: 140 })), -1, true)
      : withTiming(0, { duration: 100 });
  }, [editing, active, rot]);

  // 退避シフト（スプリング）
  useEffect(() => { shiftY.value = withSpring(shift, SPRING); }, [shift, shiftY]);

  // ドロップ: 目標スロットへスナップ着地
  useEffect(() => {
    if (drop != null) {
      dragY.value = withSpring(drop, { ...SPRING, damping: 22 });
      scale.value = withSpring(1, SPRING);
    }
  }, [drop, dragY, scale]);

  // 並び確定後の無アニメリセット（レイアウトが新順序になった瞬間にtransformを消す）
  useEffect(() => {
    dragY.value = 0; shiftY.value = 0; scale.value = 1; isActive.value = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  const pan = Gesture.Pan()
    .enabled(editing)
    .runOnJS(true)
    .activateAfterLongPress(250)
    .onStart(() => {
      isActive.value = true;
      scroll0.value = scrollY.value;
      scale.value = withSpring(1.045, SPRING);
      onStart();
    })
    .onUpdate((e) => {
      dragY.value = e.translationY + (scrollY.value - scroll0.value);
      onMove(e.translationY, e.absoluteY);
    })
    .onEnd(() => onEnd())
    .onFinalize(() => { if (drop == null) scale.value = withSpring(1, SPRING); });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: isActive.value || drop != null ? dragY.value : shiftY.value },
      { scale: scale.value },
      { rotate: `${rot.value}deg` },
    ],
    zIndex: isActive.value || drop != null ? 20 : 0,
    shadowColor: '#000',
    shadowOpacity: isActive.value ? 0.3 : 0,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: isActive.value ? 14 : 0,
    opacity: dimmed ? 0.75 : 1,
  }));

  const inner = (
    <View>
      <View pointerEvents={editing ? 'none' : 'auto'}>{children}</View>
      {editing && onHide && (
        <Pressable style={s.hideBtn} onPress={onHide} hitSlop={12}>
          <Minus size={15} color="#fff" strokeWidth={3.5} />
        </Pressable>
      )}
    </View>
  );

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={style}
        collapsable={false}
        onLayout={(e) => onFrame({ y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })}
      >
        {editing ? inner : (
          <Pressable onLongPress={onEnterEdit} delayLongPress={400}>{inner}</Pressable>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  hideBtn: {
    position: 'absolute', top: -4, left: -4, width: 27, height: 27, borderRadius: 14,
    backgroundColor: C.coral, alignItems: 'center', justifyContent: 'center', zIndex: 30,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 6,
  },
  ghostCard: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed',
    borderRadius: 20, padding: 18, marginBottom: 12, alignItems: 'center',
  },
  ghostT: { fontSize: 13, color: C.sub, fontWeight: '600' },
});
