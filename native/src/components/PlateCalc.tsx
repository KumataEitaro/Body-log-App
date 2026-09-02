// プレート計算機（下から出るシート）。
//
// 「100kgに合わせたい。片側に何を付ける？」をジムの床で暗算しなくて済むようにする。
// 目標総重量は重量ダイアルの現在値を初期値にして、±2.5kg（プレート1枚ぶん）で微調整できる。
// 出力は片側のプレート構成。バーに刺さっている姿に見えるよう、大きさ違いの角丸バーで並べる。
import { useState } from 'react';
import { View, Text, TextInput, Pressable, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { platesFor, plateRemainder, BAR_OPTIONS } from '@/lib/plateCalc';

/** プレートの見た目（kg→高さ・幅）。重いほど背が高く厚い、実物の比率に寄せる */
function plateSize(kg: number): { h: number; w: number } {
  if (kg >= 25) return { h: 108, w: 22 };
  if (kg >= 20) return { h: 100, w: 20 };
  if (kg >= 15) return { h: 88, w: 18 };
  if (kg >= 10) return { h: 74, w: 16 };
  if (kg >= 5) return { h: 56, w: 14 };
  if (kg >= 2.5) return { h: 42, w: 12 };
  return { h: 32, w: 10 };
}

export default function PlateCalc({ initial, onClose }: {
  /** 目標総重量の初期値（重量ダイアルの現在値） */
  initial: number;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [totalText, setTotalText] = useState(initial > 0 ? String(initial) : '');
  const [bar, setBar] = useState<number>(20);   // 既定はオリンピックバー20kg

  const total = Number(totalText) || 0;
  const plates = platesFor(total, bar);
  const rem = plateRemainder(total, bar);
  const short = total > 0 && total < bar;       // バーだけで目標を超える

  // ±2.5kg（1.25プレート片側1枚ぶん）。手打ちより速いのでボタンでも動かせるようにする
  const step = (d: number) => {
    const v = Math.max(0, Math.round((total + d) * 100) / 100);
    setTotalText(v % 1 === 0 ? String(v) : String(v));
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 14 }]}>
        <View style={s.grip} />
        <Text style={s.title}>{t('プレート計算')}</Text>

        {/* 目標総重量 */}
        <Text style={s.lbl}>{t('目標総重量')}</Text>
        <View style={s.totalRow}>
          <Pressable style={s.stepBtn} onPress={() => step(-2.5)} hitSlop={6}>
            <Text style={s.stepBtnT}>−2.5</Text>
          </Pressable>
          <TextInput
            style={s.totalIn} keyboardType="decimal-pad" placeholder="100" placeholderTextColor={C.faint}
            value={totalText} onChangeText={setTotalText}
          />
          <Text style={s.unit}>kg</Text>
          <Pressable style={s.stepBtn} onPress={() => step(2.5)} hitSlop={6}>
            <Text style={s.stepBtnT}>+2.5</Text>
          </Pressable>
        </View>

        {/* バー重量 */}
        <Text style={s.lbl}>{t('バー重量')}</Text>
        <View style={s.barRow}>
          {BAR_OPTIONS.map((b) => (
            <Pressable key={b} style={[s.barChip, bar === b && s.barChipOn]} onPress={() => setBar(b)} hitSlop={4}>
              <Text style={[s.barChipT, bar === b && s.barChipTOn]}>{b}kg</Text>
            </Pressable>
          ))}
        </View>

        {/* 片側のプレート構成 */}
        <Text style={s.lbl}>{t('片側に付けるプレート')}</Text>
        {total <= 0 ? (
          <Text style={s.note}>{t('目標総重量を入れると、片側のプレート構成が出ます。')}</Text>
        ) : short ? (
          <Text style={[s.note, { color: C.amber }]}>{t('目標がバー重量（{bar}kg）より軽いため、このバーでは組めません。', { bar })}</Text>
        ) : plates.length === 0 ? (
          <Text style={s.note}>{t('プレートなし（バーのみで{bar}kg）', { bar })}</Text>
        ) : (
          <View style={s.rack}>
            {/* バーの軸。プレートが刺さって見えるように奥に1本引く */}
            <View style={s.axle} />
            {plates.map((p, i) => {
              const sz = plateSize(p);
              const big = p >= 15;
              return (
                <View key={i} style={{ alignItems: 'center', gap: 4 }}>
                  <View style={[s.plate, { height: sz.h, width: sz.w }, big ? s.plateBig : s.plateSmall]} />
                  <Text style={[s.plateT, big && { color: C.teal }]}>{p % 1 === 0 ? p : p.toFixed(2).replace(/0$/, '')}</Text>
                </View>
              );
            })}
          </View>
        )}
        {rem > 0 && (
          <Text style={s.remT}>{t('あと片側{n}kgぶんは端数です（1.25kg未満）', { n: rem })}</Text>
        )}
        {plates.length > 0 && (
          <Text style={s.sumT}>
            {t('片側 {side}kg × 2 ＋ バー {bar}kg', {
              side: (plates.reduce((a, b) => a + b, 0)).toLocaleString(), bar,
            })}
          </Text>
        )}

        <Pressable style={s.close} onPress={onClose} hitSlop={6}>
          <Text style={s.closeT}>{t('とじる')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = themed(() => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(14,17,22,0.35)' },
  sheet: {
    backgroundColor: C.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 20, paddingTop: 10,
  },
  grip: { alignSelf: 'center', width: 36, height: 4.5, borderRadius: 3, backgroundColor: C.line, marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink, textAlign: 'center' },
  lbl: { fontSize: 12, fontWeight: '800', color: C.sub, marginTop: 14, marginBottom: 6 },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  totalIn: {
    flex: 1, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 21, fontWeight: '800', color: C.ink,
    textAlign: 'center', fontVariant: ['tabular-nums'],
  },
  unit: { fontSize: 14, fontWeight: '700', color: C.sub },
  stepBtn: {
    borderWidth: 1.5, borderColor: C.line, backgroundColor: C.panel, borderRadius: 999,
    paddingHorizontal: 13, paddingVertical: 9,
  },
  stepBtnT: { fontSize: 13, fontWeight: '800', color: C.sub, fontVariant: ['tabular-nums'] },
  barRow: { flexDirection: 'row', gap: 8 },
  barChip: {
    borderWidth: 1.5, borderColor: C.line, backgroundColor: C.panel, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  barChipOn: { borderColor: C.teal, backgroundColor: C.accentBadge },
  barChipT: { fontSize: 13, fontWeight: '800', color: C.sub, fontVariant: ['tabular-nums'] },
  barChipTOn: { color: C.teal },
  note: { fontSize: 13, color: C.sub, lineHeight: 19 },
  rack: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 6,
    paddingVertical: 10, minHeight: 130,
  },
  axle: {
    position: 'absolute', left: 10, right: 10, bottom: 62, height: 8, borderRadius: 4,
    backgroundColor: C.line, opacity: 0.8,
  },
  plate: { borderRadius: 7, backgroundColor: C.accentSoft, borderWidth: 1.5, borderColor: C.accentBorder },
  plateBig: { backgroundColor: C.teal, borderColor: C.teal },
  plateSmall: { backgroundColor: C.accentBadge, borderColor: C.accentBorder },
  plateT: { fontSize: 11, fontWeight: '800', color: C.sub, fontVariant: ['tabular-nums'] },
  remT: { fontSize: 12, fontWeight: '700', color: C.amber, marginTop: 4, textAlign: 'center' },
  sumT: { fontSize: 13, fontWeight: '800', color: C.ink, marginTop: 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
  close: {
    borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 12,
    alignItems: 'center', marginTop: 14, backgroundColor: C.panel,
  },
  closeT: { fontSize: 15, fontWeight: '800', color: C.sub },
}));
