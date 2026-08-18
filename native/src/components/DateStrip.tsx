// 記録先の日付セレクタ（‹ › で前後移動・中央タップでカレンダー・今日以外はアンバー表示）
// 食事/運動タブで「過去の日付に記録する」ための共通UI（旧Web版の日付選択の復活）
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { todayJST } from '@/lib/calc';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';

function shift(d: string, n: number): string {
  const t = new Date(d + 'T00:00:00');
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
const WD = () => [t('日'), t('月'), t('火'), t('水'), t('木'), t('金'), t('土')];

export default function DateStrip({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const [open, setOpen] = useState(false);
  const today = todayJST();
  const isToday = value === today;
  const dt = new Date(value + 'T00:00:00');
  const label = isToday ? t('今日') : `${dt.getMonth() + 1}/${dt.getDate()}(${WD()[dt.getDay()]})`;

  return (
    <View style={s.row}>
      <Pressable onPress={() => onChange(shift(value, -1))} hitSlop={8} style={s.arrow}>
        <ChevronLeft size={16} color={C.sub} strokeWidth={2.5} />
      </Pressable>
      <Pressable onPress={() => setOpen(true)} style={[s.mid, !isToday && s.midPast]}>
        <Text style={[s.midT, !isToday && { color: '#b45309' }]}>{label}</Text>
      </Pressable>
      <Pressable onPress={() => onChange(shift(value, 1))} hitSlop={8}
                 style={[s.arrow, isToday && { opacity: 0.25 }]} disabled={isToday}>
        <ChevronRight size={16} color={C.sub} strokeWidth={2.5} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.back} onPress={() => setOpen(false)}>
          <Pressable style={s.pickerCard} onPress={() => {}}>
            <Text style={s.pickerTitle}>{t('記録する日付')}</Text>
            <DateTimePicker
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  arrow: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  mid: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 5, minWidth: 74, alignItems: 'center',
  },
  midPast: { borderColor: '#f59e0b', backgroundColor: '#fef7e8' },
  midT: { fontSize: 12.5, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  back: { flex: 1, backgroundColor: 'rgba(14,17,22,0.35)', justifyContent: 'center', padding: 24 },
  pickerCard: { backgroundColor: C.bg, borderRadius: 20, padding: 14 },
  pickerTitle: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 4, marginLeft: 4 },
  todayBtn: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  todayBtnT: { fontSize: 12.5, fontWeight: '700', color: C.teal, textDecorationLine: 'underline' },
});
