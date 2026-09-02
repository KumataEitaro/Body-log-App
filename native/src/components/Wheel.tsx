// 縦スナップのホイール（ダイアル）と、それを載せる下からのシートの共通部品。
//
// もとは WeightDial.tsx の中にあった。筋トレ記録画面（セットの重量/回数・レストの長さ）と
// 運動記録シート（時間）でも同じ「回して選ぶ」操作にそろえるため、ここへ切り出した。
// 見た目・行高・触覚は WeightDial のときから変えていない（重量ダイアルの印象は不変）。
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, Pressable, Modal, ScrollView, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';

export const ITEM_H = 38;
const VISIBLE = 5;               // 奇数にして中央行を選択位置にする
export const WHEEL_H = ITEM_H * VISIBLE;

/** ホイールの1行。選択中だけ濃く大きく（数百行あるためmemoで再描画を2行に抑える） */
const Row = memo(function Row({ label, selected }: { label: string; selected: boolean }) {
  return (
    <View style={{ height: ITEM_H, alignItems: 'center', justifyContent: 'center' }}>
      {/* ホイールは行高ITEM_H固定のため文字サイズ拡大は上限1.3 */}
      <Text style={[s.rowT, selected && s.rowTOn]} maxFontSizeMultiplier={1.3}>{label}</Text>
    </View>
  );
});

/**
 * 縦スナップの汎用ホイール。スクロール中もカチカチと触覚を返す。
 * index は初期位置（マウント時にだけ使う）。外から動かしたいときは key を変えて作り直す
 */
export function Wheel({ values, index, onChange, width }: {
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
        {values.map((v, i) => <Row key={`${i}-${v}`} label={v} selected={i === sel} />)}
      </ScrollView>
      {/* 選択位置の枠。上下はパネル色のフェードで「回る筒」に見せる */}
      <View pointerEvents="none" style={s.selBand} />
      <View pointerEvents="none" style={[s.fade, { top: 0 }]} />
      <View pointerEvents="none" style={[s.fade, { bottom: 0, transform: [{ rotate: '180deg' }] }]} />
    </View>
  );
}

/**
 * ホイールを載せる下からのシート（背景タップで閉じる・グリップ・見出し・決定/キャンセル）。
 * 中身（ホイールの並び・補足）は children で渡す
 */
export function DialSheet({ title, subtitle, children, hint, okLabel, onClose, onOk, okDisabled }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** ホイールの下の補足（実負荷など） */
  hint?: string;
  okLabel: string;
  onClose: () => void;
  onOk: () => void;
  okDisabled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 14 }]}>
        <View style={s.grip} />
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
        <View style={s.wheels}>{children}</View>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <Pressable style={s.cancel} onPress={onClose} hitSlop={6}>
            <Text style={s.cancelT}>{t('キャンセル')}</Text>
          </Pressable>
          <Pressable style={[s.ok, okDisabled && { opacity: 0.4 }]} onPress={onOk} hitSlop={6} disabled={okDisabled}>
            {/* アクセント塗り面の上の白文字は固定色（テーマに追従させない） */}
            <Text style={s.okT}>{okLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** ホイールの横に置く単位や区切りの文字 */
export function WheelUnit({ children }: { children: ReactNode }) {
  return <Text style={s.unit}>{children}</Text>;
}

const s = themed(() => ({
  rowT: { fontSize: 21, fontWeight: '600', color: C.faint, fontVariant: ['tabular-nums'] },
  rowTOn: { color: C.ink, fontWeight: '800', fontSize: 24 },
  selBand: {
    position: 'absolute', left: 0, right: 0, top: (WHEEL_H - ITEM_H) / 2, height: ITEM_H,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line,
  },
  fade: {
    position: 'absolute', left: 0, right: 0, height: ITEM_H,
    backgroundColor: C.panel, opacity: 0.72,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(14,17,22,0.35)' },
  sheet: {
    backgroundColor: C.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 20, paddingTop: 10,
  },
  grip: { alignSelf: 'center', width: 36, height: 4.5, borderRadius: 3, backgroundColor: C.line, marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink, textAlign: 'center' },
  subtitle: { fontSize: 13, color: C.sub, textAlign: 'center', marginTop: 3 },
  wheels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  unit: { fontSize: 15, fontWeight: '700', color: C.sub, marginLeft: 8, marginRight: 4 },
  hint: { fontSize: 13, fontWeight: '700', color: C.accentInk, textAlign: 'center', marginTop: 8 },
  cancel: {
    flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: 999,
    paddingVertical: 13, alignItems: 'center', backgroundColor: C.panel,
  },
  cancelT: { fontSize: 15, fontWeight: '800', color: C.sub },
  ok: { flex: 2, backgroundColor: C.teal, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  okT: { fontSize: 17, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
}));
