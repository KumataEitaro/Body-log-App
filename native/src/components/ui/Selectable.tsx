// 選択UIの統一デザインシステム（iOS 18風・全画面共通）
// - SegmentedControl: 白プレートがバネでスライドする排他切替（iOS純正Segmented再現）
// - Chip: カプセル型の選択チップ（未選択=薄グレー地 / 選択=teal or inkソリッド）
// - OptionButton: 2択アクションボタン（1行固定＋自動縮小で文字ずれを構造的に防止）
// 共通: 押下でscale縮小＋Haptics.selectionAsync
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { C } from '@/lib/ui';


function hapt() { Haptics.selectionAsync().catch(() => {}); }

// ===== SegmentedControl =====
export function SegmentedControl<T extends string>({ options, value, onChange }: {
  options: { key: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.key === value));
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(idx)).current;
  useEffect(() => {
    Animated.spring(x, { toValue: idx, useNativeDriver: true, speed: 16, bounciness: 5 }).start();
  }, [idx, x]);
  const segW = w > 0 ? (w - 6) / options.length : 0;
  return (
    <View style={s.track} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {segW > 0 && (
        <Animated.View pointerEvents="none"
          style={[s.plate, { width: segW, transform: [{ translateX: Animated.multiply(x, segW) }] }]} />
      )}
      {options.map((o) => (
        <Pressable key={o.key} style={s.segBtn}
                   onPress={() => { if (o.key !== value) { hapt(); onChange(o.key); } }}>
          {o.icon}
          <Text numberOfLines={1} style={[s.segT, o.key === value && s.segTOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ===== Chip =====
export function Chip({ label, selected, onPress, onLongPress, tone = 'teal', leading, disabled, haptics = true }: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  tone?: 'teal' | 'ink' | 'outline'; // outline=枠線ハイライト型（運動グリッド等）
  leading?: ReactNode;
  disabled?: boolean;
  haptics?: boolean;
}) {
  const sc = useRef(new Animated.Value(1)).current;
  const press = (v: number) => Animated.spring(sc, { toValue: v, useNativeDriver: true, speed: 42, bounciness: 0 }).start();
  const onStyle = !selected ? null
    : tone === 'ink' ? s.chipOnInk
    : tone === 'outline' ? s.chipOnOutline
    : s.chipOnTeal;
  const onText = !selected ? null
    : tone === 'outline' ? { color: C.teal }
    : { color: '#fff' };
  return (
    <Pressable onPressIn={() => press(0.96)} onPressOut={() => press(1)} disabled={disabled}
               onPress={() => { if (haptics) hapt(); onPress(); }} onLongPress={onLongPress}>
      <Animated.View style={[s.chip, onStyle, disabled && { opacity: 0.4 }, { transform: [{ scale: sc }] }]}>
        {leading}
        <Text numberOfLines={1} style={[s.chipT, onText]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

// ===== OptionButton =====
export function OptionButton({ label, onPress, variant = 'filled', busy, disabled, style, leading }: {
  label: string;
  onPress: () => void;
  variant?: 'filled' | 'tonal' | 'teal';
  busy?: boolean;
  disabled?: boolean;
  style?: object;
  leading?: ReactNode;
}) {
  const sc = useRef(new Animated.Value(1)).current;
  const press = (v: number) => Animated.spring(sc, { toValue: v, useNativeDriver: true, speed: 42, bounciness: 0 }).start();
  const box = variant === 'filled' ? s.optFilled : variant === 'teal' ? s.optTeal : s.optTonal;
  const txt = variant === 'tonal' ? { color: C.ink } : { color: '#fff' };
  return (
    <Pressable onPressIn={() => press(0.95)} onPressOut={() => press(1)}
               onPress={() => { hapt(); onPress(); }} disabled={disabled || busy} style={style}>
      <Animated.View style={[s.opt, box, (disabled && !busy) && { opacity: 0.4 }, { transform: [{ scale: sc }] }]}>
        {busy ? <ActivityIndicator color={variant === 'tonal' ? C.ink : '#fff'} /> : (
          <>
            {leading}
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[s.optT, txt]}>{label}</Text>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  // Segmented
  track: { position: 'relative', flexDirection: 'row', backgroundColor: C.segTrack, borderRadius: 999, padding: 3 },
  plate: {
    position: 'absolute', top: 3, bottom: 3, left: 3, backgroundColor: '#fff', borderRadius: 999,
    shadowColor: '#141815', shadowOpacity: 0.16, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  segBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 999 },
  segT: { fontSize: 15, fontWeight: '600', color: C.sub },
  segTOn: { color: C.ink, fontWeight: '700' },
  // Chip
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.chipBg, borderWidth: 1, borderColor: C.line, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  chipT: { fontSize: 13, fontWeight: '600', color: C.sub },
  chipOnTeal: {
    backgroundColor: C.teal, borderColor: C.teal,
    shadowColor: C.teal, shadowOpacity: 0.28, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  chipOnInk: {
    backgroundColor: C.ink, borderColor: C.ink,
    shadowColor: '#141815', shadowOpacity: 0.22, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  chipOnOutline: { borderWidth: 1.5, borderColor: C.teal, backgroundColor: C.accentSoft },
  // OptionButton
  opt: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    borderRadius: 999, paddingHorizontal: 20, paddingVertical: 13, minHeight: 46,
  },
  optFilled: {
    backgroundColor: C.ink,
    shadowColor: '#141815', shadowOpacity: 0.22, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  optTeal: {
    backgroundColor: C.teal,
    shadowColor: C.teal, shadowOpacity: 0.28, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  optTonal: { backgroundColor: C.chipBg, borderWidth: 1, borderColor: C.line },
  optT: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
