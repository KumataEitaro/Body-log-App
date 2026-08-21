// 重量を選ぶダイアル（下から出るシート）。
//
// kgの手打ちは、ジムでは両手がふさがりがちで面倒くさい。
// 「前回の重量から±数kgを合わせる」のが実際の操作なので、
// 前回値を初期位置にした縦ホイール（1kg刻み）＋0.5刻みのホイールを横に並べる。
// 体重計アプリなどでおなじみの形にして、説明なしで回せるようにしている。
import { memo, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';

const ITEM_H = 38;
const VISIBLE = 5;               // 奇数にして中央行を選択位置にする
const WHEEL_H = ITEM_H * VISIBLE;
const MAX_KG = 300;

/** ホイールの1行。選択中だけ濃く大きく（301行あるためmemoで再描画を2行に抑える） */
const Row = memo(function Row({ label, selected }: { label: string; selected: boolean }) {
  return (
    <View style={{ height: ITEM_H, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[s.rowT, selected && s.rowTOn]}>{label}</Text>
    </View>
  );
});

/** 縦スナップの汎用ホイール。スクロール中もカチカチと触覚を返す */
function Wheel({ values, index, onChange, width }: {
  values: string[]; index: number; onChange: (i: number) => void; width: number;
}) {
  const ref = useRef<ScrollView>(null);
  const last = useRef(index);
  const [sel, setSel] = useState(index);

  // 初期位置へ（アニメなし）。Modalのマウント直後はレイアウト前なのでフレームを1つ待つ
  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.scrollTo({ y: index * ITEM_H, animated: false }));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.min(values.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ITEM_H)));
    if (i !== last.current) {
      last.current = i;
      setSel(i);
      onChange(i);
      Haptics.selectionAsync().catch(() => {});   // ダイアルの「刻み」の手応え
    }
  };

  return (
    <View style={{ width, height: WHEEL_H }}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        contentContainerStyle={{ paddingVertical: (WHEEL_H - ITEM_H) / 2 }}
      >
        {values.map((v, i) => <Row key={v} label={v} selected={i === sel} />)}
      </ScrollView>
      {/* 選択位置の枠。上下は白のフェードで「回る筒」に見せる */}
      <View pointerEvents="none" style={s.selBand} />
      <View pointerEvents="none" style={[s.fade, { top: 0 }]} />
      <View pointerEvents="none" style={[s.fade, { bottom: 0, transform: [{ rotate: '180deg' }] }]} />
    </View>
  );
}

export default function WeightDial({ title, subtitle, unitLabel, initial, allowZero, hint, onClose, onPick }: {
  title: string;
  /** 前回の記録など、合わせる基準になる一行 */
  subtitle?: string;
  /** 単位の表示。自重種目では「加重」にして意味を変える */
  unitLabel: string;
  initial: number;
  /** 0を「自重のみ」として許すか（通常種目では0は選べても保存で弾かれる） */
  allowZero?: boolean;
  /** 値が変わるたびに出す補足（自重種目の実負荷など） */
  hint?: (v: number) => string;
  onClose: () => void;
  onPick: (v: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const init = Math.min(MAX_KG, Math.max(0, initial));
  const [whole, setWhole] = useState(Math.floor(init));
  const [half, setHalf] = useState(init % 1 >= 0.25 ? 1 : 0);
  const value = whole + (half ? 0.5 : 0);

  const wholeValues = Array.from({ length: MAX_KG + 1 }, (_, i) => String(i));
  const valueLabel = value % 1 === 0 ? String(value) : value.toFixed(1);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* 背景タップで閉じる（シート外は暗くする） */}
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 14 }]}>
        <View style={s.grip} />
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}

        <View style={s.wheels}>
          <Wheel width={96} values={wholeValues} index={Math.floor(init)} onChange={setWhole} />
          <Text style={s.dot}>.</Text>
          <Wheel width={64} values={['0', '5']} index={init % 1 >= 0.25 ? 1 : 0} onChange={setHalf} />
          <Text style={s.unit}>{unitLabel}</Text>
        </View>

        {hint && <Text style={s.hint}>{hint(value)}</Text>}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <Pressable style={s.cancel} onPress={onClose} hitSlop={6}>
            <Text style={s.cancelT}>{t('キャンセル')}</Text>
          </Pressable>
          <Pressable style={s.ok} onPress={() => onPick(value)} hitSlop={6}>
            <Text style={s.okT}>
              {allowZero && value === 0 ? t('自重のみで決定') : t('{v}kgで決定', { v: valueLabel })}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(14,17,22,0.35)' },
  sheet: {
    backgroundColor: C.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 20, paddingTop: 10,
  },
  grip: { alignSelf: 'center', width: 36, height: 4.5, borderRadius: 3, backgroundColor: C.line, marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink, textAlign: 'center' },
  subtitle: { fontSize: 12.5, color: C.sub, textAlign: 'center', marginTop: 3 },
  wheels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  dot: { fontSize: 26, fontWeight: '800', color: C.ink, marginHorizontal: 2, paddingTop: 8 },
  unit: { fontSize: 14, fontWeight: '700', color: C.sub, marginLeft: 10 },
  rowT: { fontSize: 21, fontWeight: '600', color: C.faint, fontVariant: ['tabular-nums'] },
  rowTOn: { color: C.ink, fontWeight: '800', fontSize: 23 },
  selBand: {
    position: 'absolute', left: 0, right: 0, top: (WHEEL_H - ITEM_H) / 2, height: ITEM_H,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line,
  },
  fade: {
    position: 'absolute', left: 0, right: 0, height: ITEM_H,
    backgroundColor: C.panel, opacity: 0.72,
  },
  hint: { fontSize: 12.5, fontWeight: '700', color: C.teal, textAlign: 'center', marginTop: 8 },
  cancel: {
    flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: 999,
    paddingVertical: 13, alignItems: 'center', backgroundColor: C.panel,
  },
  cancelT: { fontSize: 14, fontWeight: '800', color: C.sub },
  ok: { flex: 2, backgroundColor: C.teal, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  okT: { fontSize: 15, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
});
