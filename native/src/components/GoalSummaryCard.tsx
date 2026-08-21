// 目標サマリーカード（概要タブ用）: 現状のひとことサマリーを表示し、
// タップするとpageSheetの詳細入力画面（GoalPanel）が開く
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { Target, Dumbbell, ChevronRight, X } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';
import GoalPanel from '@/components/GoalPanel';

export default function GoalSummaryCard({ mode }: { mode: 'weight' | 'training' }) {
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState(t('読み込み中…'));
  const Icon = mode === 'weight' ? Target : Dumbbell;
  const title = mode === 'weight' ? t('体重の目標') : t('筋トレの目標');

  const load = useCallback(async () => {
    if (mode === 'weight') {
      const [g, w] = await Promise.all([
        supabase.from('goals').select('target_weight,target_date').maybeSingle(),
        supabase.from('entries').select('weight').not('weight', 'is', null).order('date', { ascending: false }).limit(1),
      ]);
      if (g.data?.target_weight) {
        const now = w.data?.length ? Number(w.data[0].weight) : null;
        setLine(`${now != null ? `${now.toFixed(1)} → ` : ''}${Number(g.data.target_weight).toFixed(1)}kg・${t('{d}まで', { d: String(g.data.target_date).slice(5).replace('-', '/') })}`);
      } else setLine(t('未設定 — タップして設定'));
    } else {
      const tg = await supabase.from('training_goals').select('name,target_kg').order('created_at', { ascending: true });
      const list = (tg.data ?? []) as { name: string; target_kg: number }[];
      setLine(list.length
        ? list.slice(0, 2).map((x) => `${x.name} ${Number(x.target_kg)}kg`).join('・') + (list.length > 2 ? t(' 他{n}件', { n: list.length - 2 }) : '')
        : t('未設定 — タップして設定'));
    }
  }, [mode]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Pressable style={({ pressed }) => [s.card, pressed && { opacity: 0.75 }]} onPress={() => setOpen(true)}>
        <View style={s.iconWrap}><Icon size={16} color={C.teal} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.line} numberOfLines={1}>{line}</Text>
        </View>
        <ChevronRight size={17} color={C.faint} />
      </Pressable>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet"
             onRequestClose={() => { setOpen(false); load(); }}>
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{title}</Text>
            <Pressable onPress={() => { setOpen(false); load(); }} hitSlop={10}><X size={20} color={C.sub} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
            {mode === 'weight'
              ? <GoalPanel mode="weight" weightSections="all" />
              : <GoalPanel mode="training" />}
            <View style={{ height: 30 }} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12,
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: C.accentBadge,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 15, fontWeight: '800', color: C.ink },
  line: { fontSize: 13, color: C.sub, marginTop: 2 },
  sheet: { flex: 1, backgroundColor: C.bg, padding: 16, paddingTop: 18 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: C.ink },
});
