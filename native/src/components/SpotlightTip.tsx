// 単発の案内オーバーレイ（暗転＋1箇所のハイライト）。
//
// 既存のGuideTourは STEPS の固定配列を順に進める作りで、タブ間の自動遷移・自動スクロール・
// デモ再生まで抱えている。そこへ動的な1件を割り込ませると進行状態と干渉するため、
// 見た目だけ合わせた軽量版を別に用意した。進行管理は持たない。
import { useEffect, useRef, useState, type RefObject } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Dimensions, Animated, Easing } from 'react-native';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';

type Rect = { x: number; y: number; w: number; h: number };

export default function SpotlightTip({
  visible, targetRef, title, text, primaryLabel, onPrimary, secondaryLabel, onSecondary,
}: {
  visible: boolean;
  targetRef?: RefObject<View | null>;   // ハイライトする要素。無ければ中央カードで出す
  title: string;
  text: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;              // 背景タップもこちら扱い
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // 対象の位置を実測する。描画直後は幅0が返ることがあるので数回リトライする
  useEffect(() => {
    if (!visible) { setRect(null); fade.setValue(0); return; }
    let tries = 0;
    const measure = () => {
      if (!alive.current) return;
      tries += 1;
      const r = targetRef?.current;
      if (!r) { setRect(null); return; }   // 対象が無い＝中央カードで出す
      r.measureInWindow((x, y, w, h) => {
        if (!alive.current) return;
        if (w > 0 && h > 0) setRect({ x, y, w, h });
        else if (tries < 10) setTimeout(measure, 100);
        else setRect(null);
      });
    };
    measure();
    Animated.timing(fade, {
      toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  }, [visible, targetRef, fade]);

  if (!visible) return null;

  const { height: H } = Dimensions.get('window');
  const PAD = 8;
  // 吹き出しは対象の下。下端に近ければ上に置く
  const below = rect ? rect.y + rect.h + PAD + 12 : 0;
  const bubbleTop = rect && below < H - 260 ? below : null;
  const bubbleBottom = rect && bubbleTop == null ? H - rect.y + PAD + 12 : null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onSecondary} statusBarTranslucent>
      <Animated.View style={[s.fill, { opacity: fade }]}>
        {/* 背景の暗幕。タップで「あとで」扱い */}
        <Pressable style={s.fill} onPress={onSecondary} />

        {/* ハイライト枠（穴のかわりに、対象の位置へ枠だけを重ねる） */}
        {rect && (
          <View pointerEvents="none" style={[s.ring, {
            left: rect.x - PAD, top: rect.y - PAD,
            width: rect.w + PAD * 2, height: rect.h + PAD * 2,
          }]} />
        )}

        {/* 吹き出し */}
        <View style={[
          s.bubble,
          bubbleTop != null ? { top: bubbleTop } : null,
          bubbleBottom != null ? { bottom: bubbleBottom } : null,
          rect == null ? { top: H / 2 - 120 } : null,
        ]}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.text}>{text}</Text>
          <View style={s.btns}>
            <Pressable style={({ pressed }) => [s.later, pressed && { opacity: 0.7 }]} onPress={onSecondary}>
              <Text style={s.laterT}>{secondaryLabel}</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [s.go, pressed && { opacity: 0.85 }]} onPress={onPrimary}>
              <Text style={s.goT}>{primaryLabel}</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  fill: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  ring: {
    position: 'absolute', borderRadius: 14,
    borderWidth: 2.5, borderColor: C.teal,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  bubble: {
    position: 'absolute', left: 18, right: 18, backgroundColor: C.panel, borderRadius: 18, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  text: { fontSize: 15, color: C.sub, lineHeight: 21, marginTop: 7 },
  btns: { flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'center' },
  later: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999 },
  laterT: { fontSize: 15, fontWeight: '700', color: C.sub },
  go: { flex: 1, backgroundColor: C.teal, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  goT: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
