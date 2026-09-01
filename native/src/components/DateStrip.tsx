// 記録先の日付セレクタ v2（直近日チップの横並びストリップ・今日が右端）
// - 日チップ（曜日1文字＋日数字）をタップで即その日へ移動（触覚selectionAsync）
// - 横スクロールで過去90日までさかのぼれる（カレンダーでさらに古い日も選べる）
// - 選択中チップの塗り（C.ink）はバネ（withSpring）で滑って追従する
// - 今日以外を見ているときだけ「今日」ピルが出る（1タップで帰還・スプリング入場）
// - 月カレンダー（任意日ジャンプ・「今日に戻る」）は従来どおり右端のアイコンから
// props（value/onChange）は旧DateStripと互換。食事/運動の両タブがそのまま使う
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Modal } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, ZoomIn } from 'react-native-reanimated';
import DateTimePicker from '@react-native-community/datetimepicker';
import { CalendarDays } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { todayJST } from '@/lib/calc';
import { C } from '@/lib/ui';
import { t, apiLang } from '@/lib/i18n';

// チップの寸法。ヘッダー行に収まるよう小ぶりに固定する
const CHIP_W = 26;   // チップの幅
const GAP = 3;       // チップ間の隙間
const STEP = CHIP_W + GAP;
const CHIP_H = 34;

function shift(d: string, n: number): string {
  const t2 = new Date(d + 'T00:00:00');
  t2.setDate(t2.getDate() + n);
  return `${t2.getFullYear()}-${String(t2.getMonth() + 1).padStart(2, '0')}-${String(t2.getDate()).padStart(2, '0')}`;
}
const WD = () => [t('日'), t('月'), t('火'), t('水'), t('木'), t('金'), t('土')];

export default function DateStrip({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const [open, setOpen] = useState(false);
  const today = todayJST();
  const isToday = value === today;
  const dt = new Date(value + 'T00:00:00');

  // 過去90日ぶん（カレンダーでそれより古い日を選んだときはその日まで伸ばす）
  const daysBack = useMemo(() => {
    const diff = Math.round((Date.parse(today) - Date.parse(value)) / 86_400_000);
    return Math.max(90, diff);
  }, [today, value]);
  const days = useMemo(() => {
    const arr: string[] = [];
    for (let i = daysBack; i >= 0; i--) arr.push(shift(today, -i));
    return arr;   // 古い日 → 今日（右端）の順
  }, [today, daysBack]);
  const index = days.indexOf(value);

  // 選択インジケータ（チップの塗り）はバネで滑らせる
  const ix = useSharedValue(index * STEP);
  useEffect(() => {
    // damping高め＋行き過ぎ抑制: 「ぬるぬるだが揺れない」（βフィードバック 2026-09-02:
    // 揺れ幅が大きすぎる。滑らかさは維持しつつオーバーシュートをほぼゼロに）
    ix.value = withSpring(index * STEP, { damping: 30, stiffness: 260, overshootClamping: true });
  }, [index, ix]);
  const indStyle = useAnimatedStyle(() => ({ transform: [{ translateX: ix.value }] }));

  // 初期表示は右端（今日）。選択が変わったら選択チップが見える位置へ寄せる
  const scRef = useRef<ScrollView>(null);
  const visW = useRef(0);
  const didInit = useRef(false);
  useEffect(() => {
    if (!didInit.current) return;
    const x = Math.max(0, index * STEP - (visW.current - CHIP_W) / 2);
    scRef.current?.scrollTo({ x, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function pick(d: string) {
    if (d === value) return;
    Haptics.selectionAsync().catch(() => {});
    onChange(d);
  }

  return (
    <View style={s.row}>
      <ScrollView
        ref={scRef} horizontal showsHorizontalScrollIndicator={false}
        // 「今日」ピルが出る間はその分だけ表示チップを減らし、ヘッダー行からはみ出さない
        style={{ flexGrow: 0, maxWidth: (isToday ? 7 : 5) * STEP - GAP }}
        onLayout={(e) => { visW.current = e.nativeEvent.layout.width; }}
        onContentSizeChange={(w) => {
          if (!didInit.current) { scRef.current?.scrollTo({ x: w, animated: false }); didInit.current = true; }
        }}
      >
        <View style={s.chips}>
          <Animated.View pointerEvents="none" style={[s.indicator, indStyle]} />
          {days.map((d) => {
            const cdt = new Date(d + 'T00:00:00');
            const on = d === value;
            const isT = d === today;
            return (
              <Pressable key={d} style={s.chip} onPress={() => pick(d)} hitSlop={{ top: 6, bottom: 6 }}>
                <Text style={[s.chipW, on && s.chipTOn]}>{WD()[cdt.getDay()]}</Text>
                <Text style={[s.chipD, on && s.chipTOn]}>{cdt.getDate()}</Text>
                {/* 今日チップの小さなドット（選択中は白に反転） */}
                {isT && <View style={[s.todayDot, on && { backgroundColor: '#fff' }]} />}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* 今日へワンタップ帰還（今日以外を見ているときだけ・スプリング入場） */}
      {!isToday && (
        <Animated.View entering={ZoomIn.springify().damping(14)}>
          <Pressable style={s.todayPill} onPress={() => pick(today)} hitSlop={6}>
            <Text style={s.todayPillT}>{t('今日')}</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* 月カレンダー（任意日ジャンプ）。過去日を見ている間はアンバーで気づかせる */}
      <Pressable onPress={() => setOpen(true)} hitSlop={8} style={[s.calBtn, !isToday && s.calBtnPast]}>
        <CalendarDays size={15} color={isToday ? C.sub : '#b45309'} strokeWidth={2.2} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.back} onPress={() => setOpen(false)}>
          <Pressable style={s.pickerCard} onPress={() => {}}>
            <Text style={s.pickerTitle}>{t('記録する日付')}</Text>
            <DateTimePicker
              locale={apiLang()}
              value={dt} mode="date" display="inline" maximumDate={new Date()}
              onChange={(_ev, d) => {
                if (d) {
                  onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
                  setOpen(false);
                }
              }}
            />
            {!isToday && (
              <Pressable style={s.todayBtn} onPress={() => { onChange(today); setOpen(false); }}>
                <Text style={s.todayBtnT}>{t('今日に戻る')}</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chips: { flexDirection: 'row', columnGap: GAP },
  chip: { width: CHIP_W, height: CHIP_H, alignItems: 'center', justifyContent: 'center' },
  indicator: {
    position: 'absolute', left: 0, top: 0, width: CHIP_W, height: CHIP_H,
    borderRadius: 10, backgroundColor: C.ink,
  },
  chipW: { fontSize: 11, lineHeight: 13, fontWeight: '700', color: C.faint },
  chipD: { fontSize: 12, lineHeight: 15, fontWeight: '800', color: C.sub, fontVariant: ['tabular-nums'] },
  chipTOn: { color: '#fff' },
  todayDot: { position: 'absolute', bottom: 3, width: 3, height: 3, borderRadius: 2, backgroundColor: C.teal },
  todayPill: {
    backgroundColor: C.accentBadge, borderWidth: 1, borderColor: C.accentBorder,
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6,
  },
  todayPillT: { fontSize: 11, fontWeight: '800', color: C.teal },
  calBtn: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  calBtnPast: { backgroundColor: '#fef7e8', borderWidth: 1, borderColor: '#f59e0b' },
  back: { flex: 1, backgroundColor: 'rgba(14,17,22,0.35)', justifyContent: 'center', padding: 24 },
  pickerCard: { backgroundColor: C.bg, borderRadius: 20, padding: 14 },
  pickerTitle: { fontSize: 15, fontWeight: '800', color: C.ink, marginBottom: 4, marginLeft: 4 },
  todayBtn: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  todayBtnT: { fontSize: 13, fontWeight: '700', color: C.teal, textDecorationLine: 'underline' },
});
