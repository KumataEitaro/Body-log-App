// 筋トレ種目を選ぶシート。
// 基本47種を部位別に並べ、無い種目はその場で追加できる（追加分は次回から一覧に出る）。
import { useMemo, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Search, Plus, Trash2 } from 'lucide-react-native';
import { C, sheetTopPad, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { LIFTS, LIFT_PARTS, liftName, useCustomLifts, addCustomLift, removeCustomLift } from '@/lib/lifts';

export default function LiftPicker({ visible, onClose, onPick, history }: {
  visible: boolean;
  onClose: () => void;
  onPick: (canonName: string) => void;
  /** 過去に記録した種目名（よく使うものを先頭に出すため） */
  history?: string[];
}) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  // 追加する種目が「体重が負荷になる（懸垂タイプ）」かどうか
  const [bwNew, setBwNew] = useState(false);
  const custom = useCustomLifts();
  const query = q.trim();

  // 過去に記録した種目を最上部に出す（毎回同じ種目を探させない）
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return (history ?? []).filter((n) => {
      if (!n || seen.has(n)) return false;
      seen.add(n);
      return true;
    }).slice(0, 8);
  }, [history]);

  const match = (name: string) => !query || name.includes(query);

  // 一覧に無い名前はその場で追加して選ぶ（既にある名前ならそのまま選ぶだけ）
  async function addNew() {
    await addCustomLift(query, bwNew);
    onPick(query.trim());
    onClose();
    setQ('');
    setBwNew(false);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.wrap, { paddingTop: sheetTopPad(16) }]}>
        <View style={s.head}>
          <Text style={s.title}>{t('種目を選ぶ')}</Text>
          <Pressable onPress={onClose} hitSlop={10}><X size={22} color={C.sub} /></Pressable>
        </View>

        <View style={s.searchRow}>
          <Search size={15} color={C.faint} />
          <TextInput style={s.search} placeholder={t('種目名で探す・新しく追加する')} placeholderTextColor={C.faint}
                     value={q} onChangeText={setQ} clearButtonMode="while-editing" />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
          {/* 検索語が一覧に無ければ、その名前で追加できる */}
          {query.length > 0
            && !LIFTS.some((l) => l.canon === query || liftName(l.id) === query)
            && !custom.includes(query) && (
            <>
            <Pressable style={s.addRow} onPress={addNew}>
              <View style={s.addIcon}><Plus size={15} color="#fff" strokeWidth={3} /></View>
              <Text style={s.addT}>{t('「{name}」を追加して使う', { name: query })}</Text>
            </Pressable>
            {/* 懸垂タイプ: kg欄が「加重」になり、実負荷=体重＋加重で計算される */}
            <Pressable style={s.bwToggle} onPress={() => setBwNew((v) => !v)} hitSlop={6}>
              <View style={[s.bwBox, bwNew && s.bwBoxOn]}>{bwNew && <Text style={s.bwCheck}>✓</Text>}</View>
              <Text style={s.bwToggleT}>{t('体重が負荷になる種目（懸垂・ディップス系）')}</Text>
            </Pressable>
            </>
          )}

          {recent.length > 0 && query.length === 0 && (
            <>
              <Text style={s.groupT}>{t('最近の種目')}</Text>
              {recent.map((n) => (
                <Pressable key={`r-${n}`} style={s.row} onPress={() => { onPick(n); onClose(); }}>
                  <Text style={s.rowT}>{n}</Text>
                  <Text style={s.arrow}>›</Text>
                </Pressable>
              ))}
            </>
          )}

          {custom.filter(match).length > 0 && (
            <>
              <Text style={s.groupT}>{t('追加した種目')}</Text>
              {custom.filter(match).map((n) => (
                <View key={`c-${n}`} style={s.row}>
                  <Pressable style={{ flex: 1 }} onPress={() => { onPick(n); onClose(); }}>
                    <Text style={s.rowT}>{n}</Text>
                  </Pressable>
                  <Pressable onPress={() => removeCustomLift(n)} hitSlop={10}>
                    <Trash2 size={15} color={C.coral} />
                  </Pressable>
                </View>
              ))}
            </>
          )}

          {LIFT_PARTS.map((p) => {
            const items = LIFTS.filter((l) => l.part === p.key && match(liftName(l.id)));
            if (items.length === 0) return null;
            return (
              <View key={p.key}>
                <Text style={s.groupT}>{t(p.label)}</Text>
                {items.map((l) => (
                  <Pressable key={l.id} style={s.row} onPress={() => { onPick(l.canon); onClose(); }}>
                    <Text style={s.rowT}>{liftName(l.id)}</Text>
                    {/* 自重種目は入れるkgが加重だと選ぶ前に分かるようにする */}
                    {l.bw != null && <Text style={s.bwTag}>{t('加重')}</Text>}
                    <Text style={s.arrow}>›</Text>
                  </Pressable>
                ))}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.chipBg,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 8,
  },
  search: { flex: 1, fontSize: 17, color: C.ink, padding: 0 },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.accentSoft, borderWidth: 1.5, borderColor: C.accentBorder,
    borderRadius: 12, padding: 12, marginBottom: 8,
  },
  addIcon: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: C.teal,
    alignItems: 'center', justifyContent: 'center',
  },
  addT: { flex: 1, fontSize: 15, fontWeight: '700', color: C.teal },
  bwToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 4, marginBottom: 4 },
  bwBox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  bwBoxOn: { backgroundColor: C.teal, borderColor: C.teal },
  bwCheck: { color: '#fff', fontSize: 12, fontWeight: '800' },
  bwToggleT: { fontSize: 13, color: C.sub, fontWeight: '600' },
  groupT: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 14, marginBottom: 3 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: C.line,
  },
  rowT: { flex: 1, fontSize: 15, color: C.ink, fontWeight: '600' },
  bwTag: {
    fontSize: 11, fontWeight: '800', color: C.teal, backgroundColor: C.accentBadge,
    borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden',
  },
  arrow: { fontSize: 21, color: C.faint },
}));
