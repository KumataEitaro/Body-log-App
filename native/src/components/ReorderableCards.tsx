// インプレイスのドラッグ並び替え（iOSホーム画面のJiggle Mode準拠・自前実装）
// - 画面遷移なし: 実データが描かれたカードそのものがその場で編集状態になる
// - 長押し(250ms)→指に追従してドラッグ。掴むと scale1.04+深い影 で浮き上がる
// - 他カードはスプリングで滑らかに退避し、離すと目標スロットへスナップ着地
// - 編集中は全カードが微振動(Jiggle)・カード内操作は停止・画面端で自動スクロール
//
// 【ぬるぬるの根拠＝全計算をUIスレッドで行う】
// 旧実装は runOnJS(true) で追従がJSスレッド依存だった（チャートで重い画面ほど遅れる）。
// v2は追従・スロット判定・退避・着地・自動スクロールすべてworklet。
// JSへ渡るのは「並び確定」「ハプティクス」「スクロール停止」の離散イベントだけ。
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions, type RefreshControlProps } from 'react-native';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, useAnimatedScrollHandler, useAnimatedRef,
  useFrameCallback, scrollTo, runOnJS,
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
type Pack = { top: number; j: number; y: number };
type ActiveSnap = { y: number; h: number; gap: number };

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
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const scrollNow = useRef(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => { scrollY.value = e.contentOffset.y; } });

  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [resetNonce, setResetNonce] = useState(0);

  // ドラッグ状態（すべてworkletから読み書きする共有値）
  const dragKey = useSharedValue<string | null>(null);
  const dropKey = useSharedValue<string | null>(null);   // 着地アニメ中もzIndexを保つ
  const kSV = useSharedValue(0);                          // 現在の挿入スロット
  const slotsSV = useSharedValue<number[]>([]);           // 各スロットの上端y
  const packSV = useSharedValue<Record<string, Pack>>({});// 非アクティブカードのパック位置
  const activeSV = useSharedValue<ActiveSnap | null>(null);
  const scroll0 = useSharedValue(0);
  const autoDir = useSharedValue(0);                      // -1/0/1 画面端の自動スクロール

  // レイアウト実測（onLayoutはJSなので、JS側refとworklet用共有値の両方に書く）
  const framesJS = useRef(new Map<string, Frame>());
  const framesSV = useSharedValue<Record<string, Frame>>({});
  const winH = Dimensions.get('window').height;

  // ガイドツアー用: 相対スクロール（ネイティブease付き）
  useEffect(() => {
    onScroller?.((delta) => {
      scrollNow.current = Math.max(0, scrollNow.current + delta);
      scrollRef.current?.scrollTo({ y: scrollNow.current, animated: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 画面端の自動スクロール（UIスレッドのフレームコールバック。JSのsetIntervalを廃止）
  useFrameCallback(() => {
    'worklet';
    if (autoDir.value === 0 || dragKey.value == null) return;
    scrollTo(scrollRef, 0, Math.max(0, scrollY.value + autoDir.value * EDGE_SPEED), false);
  });

  const haptic = (kind: 'start' | 'slot') => {
    if (kind === 'start') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    else Haptics.selectionAsync().catch(() => {});
  };

  // 並び確定（スプリング着地の完了コールバックから呼ばれる唯一のJS往復）
  const commit = (key: string, k: number, scrollYNow: number) => {
    scrollNow.current = scrollYNow; // 自動スクロールで動いたぶんをJS側にも反映
    const others = order.filter((o) => o !== key);
    const nextOrder = [...others.slice(0, k), key, ...others.slice(k)];
    onOrderChange(nextOrder);
    // レイアウトが新順序になるのと同じコミットでtransformを無アニメで0へ
    setResetNonce((n) => n + 1);
    setScrollEnabled(true);
  };
  const cancelDrag = () => setScrollEnabled(true);

  // resetNonceの変化でworklet状態も初期化（並び確定と同時にゼロへ）
  useEffect(() => {
    dragKey.value = null;
    dropKey.value = null;
    packSV.value = {};
    activeSV.value = null;
    autoDir.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

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
            order={order}
            editing={editing}
            resetNonce={resetNonce}
            winH={winH}
            sv={{ dragKey, dropKey, kSV, slotsSV, packSV, activeSV, scroll0, autoDir, scrollY, framesSV }}
            onFrame={(f) => {
              framesJS.current.set(k, f);
              framesSV.value = { ...framesSV.value, [k]: f };
            }}
            onDragStartJS={() => { setScrollEnabled(false); haptic('start'); }}
            onSlotHaptic={() => haptic('slot')}
            onCommit={commit}
            onCancel={cancelDrag}
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

type SVBundle = {
  dragKey: SharedValue<string | null>;
  dropKey: SharedValue<string | null>;
  kSV: SharedValue<number>;
  slotsSV: SharedValue<number[]>;
  packSV: SharedValue<Record<string, Pack>>;
  activeSV: SharedValue<ActiveSnap | null>;
  scroll0: SharedValue<number>;
  autoDir: SharedValue<number>;
  scrollY: SharedValue<number>;
  framesSV: SharedValue<Record<string, Frame>>;
};

function DraggableCard({
  id, order, editing, resetNonce, winH, sv, onFrame, onDragStartJS, onSlotHaptic, onCommit, onCancel, onEnterEdit, onHide, children,
}: {
  id: string;
  order: string[];
  editing: boolean;
  resetNonce: number;
  winH: number;
  sv: SVBundle;
  onFrame: (f: Frame) => void;
  onDragStartJS: () => void;
  onSlotHaptic: () => void;
  onCommit: (key: string, k: number, scrollYNow: number) => void;
  onCancel: () => void;
  onEnterEdit: () => void;
  onHide?: () => void;
  children: ReactNode;
}) {
  const dragY = useSharedValue(0);
  const scale = useSharedValue(1);
  const rot = useSharedValue(0);
  const { dragKey, dropKey, kSV, slotsSV, packSV, activeSV, scroll0, autoDir, scrollY, framesSV } = sv;

  // Jiggle（編集中のみ。ドラッグ中の自分はstyle側で回転を止める）
  useEffect(() => {
    rot.value = editing
      ? withRepeat(withSequence(withTiming(-0.35, { duration: 140 }), withTiming(0.35, { duration: 140 })), -1, true)
      : withTiming(0, { duration: 100 });
  }, [editing, rot]);

  // 並び確定後の無アニメリセット（レイアウトが新順序になった瞬間にtransformを消す）
  useEffect(() => {
    dragY.value = 0; scale.value = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  const pan = Gesture.Pan()
    .enabled(editing)
    .activateAfterLongPress(250)
    .onStart(() => {
      'worklet';
      const frames = framesSV.value;
      const active = frames[id];
      if (!active) return;
      // スナップショット: アクティブを抜いたパック配置と挿入スロット（判定が暴れない固定基準）
      const k0 = order.indexOf(id);
      let gap = 12;
      if (order.length >= 2) {
        const f0 = frames[order[0]]; const f1 = frames[order[1]];
        if (f0 && f1) gap = Math.max(0, f1.y - (f0.y + f0.h));
      }
      const A = active.h + gap;
      const pack: Record<string, Pack> = {};
      const slots: number[] = [];
      let j = 0;
      let lastTop = active.y; let lastH = 0;
      for (const o of order) {
        if (o === id) continue;
        const f = frames[o];
        if (!f) continue;
        const top = order.indexOf(o) < k0 ? f.y : f.y - A;
        pack[o] = { top, j, y: f.y };
        slots.push(top);
        lastTop = top; lastH = f.h;
        j++;
      }
      slots.push(j > 0 ? lastTop + lastH + gap : active.y); // 末尾スロット
      packSV.value = pack;
      slotsSV.value = slots;
      activeSV.value = { y: active.y, h: active.h, gap };
      kSV.value = k0;
      scroll0.value = scrollY.value;
      dragKey.value = id;
      dropKey.value = null;
      scale.value = withSpring(1.045, SPRING);
      runOnJS(onDragStartJS)();
    })
    .onUpdate((e) => {
      'worklet';
      const a = activeSV.value;
      if (!a || dragKey.value !== id) return;
      const scrollDelta = scrollY.value - scroll0.value;
      dragY.value = e.translationY + scrollDelta;
      // スロット判定: 各スロット中心にいちばん近いk（すべてUIスレッド）
      const slots = slotsSV.value;
      const center = a.y + a.h / 2 + e.translationY + scrollDelta;
      let best = 0; let bestDist = 1e15;
      for (let k = 0; k < slots.length; k++) {
        const d = Math.abs(center - (slots[k] + a.h / 2));
        if (d < bestDist) { bestDist = d; best = k; }
      }
      if (best !== kSV.value) { kSV.value = best; runOnJS(onSlotHaptic)(); }
      // 画面端の自動スクロール（フレームコールバック側が読む）
      autoDir.value = e.absoluteY < EDGE ? -1 : e.absoluteY > winH - EDGE ? 1 : 0;
    })
    .onEnd(() => {
      'worklet';
      const a = activeSV.value;
      if (!a || dragKey.value !== id) return;
      autoDir.value = 0;
      const k = kSV.value;
      const target = slotsSV.value[k] - a.y;
      dropKey.value = id;      // 着地中もzIndexと影を保つ
      dragKey.value = null;    // 追従は終了（退避スプリングは最終形のまま）
      scale.value = withSpring(1, SPRING);
      dragY.value = withSpring(target, { ...SPRING, damping: 22 }, (finished) => {
        if (finished) runOnJS(onCommit)(id, k, scrollY.value);
      });
    })
    .onFinalize(() => {
      'worklet';
      // キャンセル（onEndに到達しない中断）時の後始末
      if (dragKey.value === id) {
        dragKey.value = null;
        autoDir.value = 0;
        dragY.value = withSpring(0, SPRING);
        scale.value = withSpring(1, SPRING);
        packSV.value = {};
        activeSV.value = null;
        runOnJS(onCancel)();
      }
    });

  const style = useAnimatedStyle(() => {
    const isActive = dragKey.value === id || dropKey.value === id;
    // 退避: 挿入スロットkに応じたパック位置へスプリング（再レンダーなしで全カードが動く）
    let ty = 0;
    if (isActive) {
      ty = dragY.value;
    } else if (dragKey.value != null || dropKey.value != null) {
      const p = packSV.value[id];
      const a = activeSV.value;
      if (p && a) {
        const target = p.top + (p.j >= kSV.value ? a.h + a.gap : 0) - p.y;
        ty = withSpring(target, SPRING) as unknown as number;
      }
    }
    return {
      transform: [
        { translateY: ty },
        { scale: scale.value },
        { rotate: `${dragKey.value === id ? 0 : rot.value}deg` },
      ],
      zIndex: isActive ? 20 : 0,
      shadowColor: '#000',
      shadowOpacity: dragKey.value === id ? 0.3 : 0,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: dragKey.value === id ? 14 : 0,
      opacity: dragKey.value != null && dragKey.value !== id ? 0.75 : 1,
    };
  });

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
