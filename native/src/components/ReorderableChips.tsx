// マイ食品チップの横方向ドラッグ並び替え（ReorderableCardsの水平版）
// 長押し(300ms)→そのまま左右にドラッグ。他チップがスプリングで退避し、離すと着地。
// 編集モードは持たず、ドロップした瞬間に並びが確定する（onOrderChangeで永続化）
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Dimensions } from 'react-native';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, useAnimatedScrollHandler,
  withSpring, withRepeat, withSequence, withTiming, type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const SPRING = { damping: 18, stiffness: 200, mass: 0.5 };
const EDGE = 56;
const EDGE_SPEED = 8;

type Frame = { x: number; w: number };

type Props = {
  order: string[];
  onOrderChange: (next: string[]) => void;
  renderChip: (id: string) => ReactNode;
};

export default function ReorderableChips({ order, onOrderChange, renderChip }: Props) {
  const scrollRef = useRef<Animated.ScrollView>(null);
  const scrollX = useSharedValue(0);
  const scrollNow = useRef(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => { scrollX.value = e.contentOffset.x; } });

  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Record<string, number>>({});
  const [drop, setDrop] = useState<{ id: string; offset: number } | null>(null);
  const [resetNonce, setResetNonce] = useState(0);

  const frames = useRef(new Map<string, Frame>());
  const snap = useRef<{ others: { id: string; left: number; w: number }[]; slots: number[]; active: Frame; gap: number; scroll0: number } | null>(null);
  const kRef = useRef(0);
  const autoScroll = useRef<ReturnType<typeof setInterval> | null>(null);
  const winW = Dimensions.get('window').width;

  useEffect(() => () => { if (autoScroll.current) clearInterval(autoScroll.current); }, []);
  const stopAuto = () => { if (autoScroll.current) { clearInterval(autoScroll.current); autoScroll.current = null; } };

  function onDragStart(id: string) {
    const active = frames.current.get(id);
    if (!active) return;
    setScrollEnabled(false);
    setActiveId(id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const k0 = order.indexOf(id);
    kRef.current = k0;
    const sorted = order.map((o) => frames.current.get(o)!).filter(Boolean);
    let gap = 6;
    if (sorted.length >= 2) gap = Math.max(0, sorted[1].x - (sorted[0].x + sorted[0].w));
    const A = active.w + gap;
    const others = order.filter((o) => o !== id).map((o) => {
      const f = frames.current.get(o)!;
      const orig = order.indexOf(o);
      return { id: o, left: orig < k0 ? f.x : f.x - A, w: f.w };
    });
    const slots: number[] = [];
    for (let k = 0; k <= others.length; k++) {
      slots.push(k < others.length ? others[k].left : (others.length ? others[others.length - 1].left + others[others.length - 1].w + gap : active.x));
    }
    snap.current = { others, slots, active, gap, scroll0: scrollNow.current };
    setShifts({});
  }

  function onDragMove(_id: string, translationX: number, absoluteX: number) {
    const sn = snap.current;
    if (!sn) return;
    const scrollDelta = scrollNow.current - sn.scroll0;
    const activeCenter = sn.active.x + sn.active.w / 2 + translationX + scrollDelta;
    let best = 0, bestDist = Infinity;
    for (let k = 0; k < sn.slots.length; k++) {
      const c = sn.slots[k] + sn.active.w / 2;
      const d = Math.abs(activeCenter - c);
      if (d < bestDist) { bestDist = d; best = k; }
    }
    if (best !== kRef.current) {
      kRef.current = best;
      Haptics.selectionAsync().catch(() => {});
      const A = sn.active.w + sn.gap;
      const next: Record<string, number> = {};
      sn.others.forEach((o, j) => {
        const target = o.left + (j >= best ? A : 0);
        const f = frames.current.get(o.id)!;
        next[o.id] = target - f.x;
      });
      setShifts(next);
    }
    const dir = absoluteX < EDGE ? -1 : absoluteX > winW - EDGE ? 1 : 0;
    if (dir !== 0 && !autoScroll.current) {
      autoScroll.current = setInterval(() => {
        scrollNow.current = Math.max(0, scrollNow.current + dir * EDGE_SPEED);
        scrollRef.current?.scrollTo({ x: scrollNow.current, animated: false });
      }, 16);
    } else if (dir === 0) stopAuto();
  }

  function onDragEnd(id: string) {
    stopAuto();
    const sn = snap.current;
    if (!sn) { setActiveId(null); setScrollEnabled(true); return; }
    const k = kRef.current;
    setDrop({ id, offset: sn.slots[k] - sn.active.x });
    const others = order.filter((o) => o !== id);
    const nextOrder = [...others.slice(0, k), id, ...others.slice(k)];
    setTimeout(() => {
      onOrderChange(nextOrder);
      setShifts({});
      setDrop(null);
      setActiveId(null);
      setScrollEnabled(true);
      setResetNonce((n) => n + 1);
      snap.current = null;
    }, 200);
  }

  return (
    <GestureHandlerRootView style={{ flexGrow: 0 }}>
    <Animated.ScrollView
      ref={scrollRef}
      horizontal showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      scrollEnabled={scrollEnabled}
      onScroll={onScroll} scrollEventThrottle={16}
      onMomentumScrollEnd={(e) => { scrollNow.current = e.nativeEvent.contentOffset.x; }}
      onScrollEndDrag={(e) => { scrollNow.current = e.nativeEvent.contentOffset.x; }}
      style={{ flexGrow: 0 }}
    >
      {order.map((id) => (
        <DraggableChip
          key={id} id={id}
          active={activeId === id}
          sessionActive={activeId != null}
          shift={shifts[id] ?? 0}
          drop={drop?.id === id ? drop.offset : null}
          resetNonce={resetNonce}
          scrollX={scrollX}
          onFrame={(f) => frames.current.set(id, f)}
          onStart={() => onDragStart(id)}
          onMove={(tx, ax) => onDragMove(id, tx, ax)}
          onEnd={() => onDragEnd(id)}
        >
          {renderChip(id)}
        </DraggableChip>
      ))}
    </Animated.ScrollView>
    </GestureHandlerRootView>
  );
}

function DraggableChip({
  id: _id, active, sessionActive, shift, drop, resetNonce, scrollX, onFrame, onStart, onMove, onEnd, children,
}: {
  id: string;
  active: boolean;
  sessionActive: boolean;
  shift: number;
  drop: number | null;
  resetNonce: number;
  scrollX: SharedValue<number>;
  onFrame: (f: Frame) => void;
  onStart: () => void;
  onMove: (translationX: number, absoluteX: number) => void;
  onEnd: () => void;
  children: ReactNode;
}) {
  const dragX = useSharedValue(0);
  const shiftX = useSharedValue(0);
  const scale = useSharedValue(1);
  const rot = useSharedValue(0);
  const scroll0 = useSharedValue(0);
  const isActive = useSharedValue(false);

  useEffect(() => {
    rot.value = sessionActive && !active
      ? withRepeat(withSequence(withTiming(-1.2, { duration: 130 }), withTiming(1.2, { duration: 130 })), -1, true)
      : withTiming(0, { duration: 100 });
  }, [sessionActive, active, rot]);

  useEffect(() => { shiftX.value = withSpring(shift, SPRING); }, [shift, shiftX]);
  useEffect(() => {
    if (drop != null) {
      dragX.value = withSpring(drop, { ...SPRING, damping: 22 });
      scale.value = withSpring(1, SPRING);
    }
  }, [drop, dragX, scale]);
  useEffect(() => {
    dragX.value = 0; shiftX.value = 0; scale.value = 1; isActive.value = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .maxPointers(1)
    .activateAfterLongPress(300)
    .onStart(() => {
      isActive.value = true;
      scroll0.value = scrollX.value;
      scale.value = withSpring(1.08, SPRING);
      onStart();
    })
    .onUpdate((e) => {
      dragX.value = e.translationX + (scrollX.value - scroll0.value);
      onMove(e.translationX, e.absoluteX);
    })
    .onEnd(() => onEnd())
    .onFinalize(() => { if (drop == null) scale.value = withSpring(1, SPRING); });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: isActive.value || drop != null ? dragX.value : shiftX.value },
      { scale: scale.value },
      { rotate: `${rot.value}deg` },
    ],
    zIndex: isActive.value || drop != null ? 20 : 0,
    shadowColor: '#000',
    shadowOpacity: isActive.value ? 0.25 : 0,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: isActive.value ? 10 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={style}
        collapsable={false}
        onLayout={(e) => onFrame({ x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width })}
      >
        <View pointerEvents={sessionActive ? 'none' : 'auto'}>{children}</View>
      </Animated.View>
    </GestureDetector>
  );
}
