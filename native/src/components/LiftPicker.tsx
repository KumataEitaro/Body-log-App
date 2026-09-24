// 筋トレ種目を選ぶシート。
// 基本47種を部位別に並べ、無い種目はその場で追加できる（追加分は次回から一覧に出る）。
//
// 【ユーザー追加種目（2026-09-24）】名前だけでなく
//   ・対象部位（部位別ボリューム統計・履歴の部位フィルタに入る）
//   ・体重が負荷になる種目か（懸垂タイプ。kg欄が加重/補助になる）
//   ・ダンベル種目か（重さを片側で入力。記録は `片側20kg` と書き、ボリュームは両側ぶん）
// を選んで足す。追加した種目は選んだ部位のグループの中に並ぶ（部位なしは「その他」）。
// 行のゴミ箱で一覧から外せる（過去の記録は消えない。記録テキストは種目名で自立している）。
import { useMemo, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Search, Plus, Trash2 } from 'lucide-react-native';
import { C, sheetTopPad, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import {
  LIFTS, LIFT_PARTS, OTHER_PART, liftName, liftPartLabel,
  useCustomLiftDefs, addCustomLift, removeCustomLift, type CustomLift,
} from '@/lib/lifts';
import { Chip } from '@/components/ui/Selectable';
import { useThemeRefresh } from '@/lib/theme';

export default function LiftPicker({ visible, onClose, onPick, history }: {
  visible: boolean;
  onClose: () => void;
  onPick: (canonName: string) => void;
  /** 過去に記録した種目名（よく使うものを先頭に出すため） */
  history?: string[];
}) {
  useThemeRefresh();   // 壁（ThemeRemount）の外に出る Modal を持つので、自分でテーマを購読する（2026-09-17）
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  // 追加する種目の属性: 体重が負荷になる（懸垂タイプ）／ダンベル（片側入力）／対象部位（未選択は「その他」）
  const [bwNew, setBwNew] = useState(false);
  const [dbNew, setDbNew] = useState(false);
  const [partNew, setPartNew] = useState<string | null>(null);
  const custom = useCustomLiftDefs();
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
  const partOfCustom = (c: CustomLift) => c.part ?? OTHER_PART;

  function resetForm() {
    setQ('');
    setBwNew(false);
    setDbNew(false);
    setPartNew(null);
  }
  function pick(name: string) {
    onPick(name);
    onClose();
  }

  // 一覧に無い名前はその場で追加して選ぶ（既にある名前ならそのまま選ぶだけ）
  async function addNew() {
    const name = query;
    await addCustomLift(name, { bodyweight: bwNew, part: partNew, dumbbell: dbNew });
    pick(name);
    resetForm();
  }

  const canAdd = query.length > 0
    && !LIFTS.some((l) => l.canon === query || liftName(l.id) === query)
    && !custom.some((c) => c.n === query);

  /** 追加した種目の行。ゴミ箱で一覧から外せる */
  const customRow = (c: CustomLift) => (
    <View key={`c-${c.n}`} style={s.row}>
      <Pressable style={s.rowMain} onPress={() => pick(c.n)}>
        <Text style={s.rowT}>{c.n}</Text>
        {/* 属性は選ぶ前に分かるようにタグで出す（加重=kg欄が加重・ダンベル=kgは片側） */}
        {c.bw != null && <Text style={s.bwTag}>{t('加重')}</Text>}
        {c.db && <Text style={s.bwTag}>{t('ダンベル')}</Text>}
      </Pressable>
      <Pressable onPress={() => removeCustomLift(c.n)} hitSlop={10}
                 accessibilityRole="button" accessibilityLabel={t('「{name}」を一覧から削除', { name: c.n })}>
        <Trash2 size={15} color={C.coral} />
      </Pressable>
    </View>
  );

  const otherCustom = custom.filter((c) => partOfCustom(c) === OTHER_PART && match(c.n));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.wrap, { paddingTop: sheetTopPad(16) }]}>
        <View style={s.head}>
          <Text style={s.title}>{t('種目を選ぶ')}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('とじる')}>
            <X size={22} color={C.sub} />
          </Pressable>
        </View>

        <View style={s.searchRow}>
          <Search size={15} color={C.faint} />
          <TextInput style={s.search} placeholder={t('種目名で探す・新しく追加する')} placeholderTextColor={C.faint}
                     value={q} onChangeText={setQ} clearButtonMode="while-editing" />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
          {/* 検索語が一覧に無ければ、その名前で追加できる */}
          {canAdd && (
            <View style={s.addBox}>
              <Pressable style={s.addRow} onPress={addNew}>
                <View style={s.addIcon}><Plus size={15} color="#fff" strokeWidth={3} /></View>
                <Text style={s.addT}>{t('「{name}」を追加して使う', { name: query })}</Text>
              </Pressable>

              {/* 対象部位: 部位別ボリューム統計と履歴の部位フィルタに入る（未選択は「その他」） */}
              <Text style={s.formLabel}>{t('対象部位')}</Text>
              <View style={s.chips}>
                {[...LIFT_PARTS, { key: OTHER_PART, label: liftPartLabel(OTHER_PART) }].map((p) => (
                  <Chip key={p.key} label={t(p.label)} selected={partNew === p.key}
                        onPress={() => setPartNew((cur) => (cur === p.key ? null : p.key))} />
                ))}
              </View>
              {partNew == null && <Text style={s.helper}>{t('部位を選ぶと部位別ボリュームに入ります')}</Text>}

              {/* 懸垂タイプ: kg欄が「加重」になり、実負荷=体重＋加重で計算される */}
              <Pressable style={s.toggle} onPress={() => setBwNew((v) => !v)} hitSlop={6}
                         accessibilityRole="checkbox" accessibilityState={{ checked: bwNew }} accessibilityLabel={t('体重が負荷になる種目（懸垂・ディップス系）')}>
                <View style={[s.box, bwNew && s.boxOn]}>{bwNew && <Text style={s.check}>✓</Text>}</View>
                <Text style={s.toggleT}>{t('体重が負荷になる種目（懸垂・ディップス系）')}</Text>
              </Pressable>
              {/* ダンベル: kg欄が片側の重さになり、記録は `片側20kg`・ボリュームは両側ぶん */}
              <Pressable style={s.toggle} onPress={() => setDbNew((v) => !v)} hitSlop={6}
                         accessibilityRole="checkbox" accessibilityState={{ checked: dbNew }} accessibilityLabel={t('ダンベル種目（重さは片側で入力）')}>
                <View style={[s.box, dbNew && s.boxOn]}>{dbNew && <Text style={s.check}>✓</Text>}</View>
                <Text style={s.toggleT}>{t('ダンベル種目（重さは片側で入力）')}</Text>
              </Pressable>
            </View>
          )}

          {recent.length > 0 && query.length === 0 && (
            <>
              <Text style={s.groupT}>{t('最近の種目')}</Text>
              {recent.map((n) => (
                <Pressable key={`r-${n}`} style={s.row} onPress={() => pick(n)}>
                  <Text style={s.rowT}>{n}</Text>
                  <Text style={s.arrow}>›</Text>
                </Pressable>
              ))}
            </>
          )}

          {/* 部位ごと: 基本種目のあとに、その部位で追加した種目を並べる */}
          {LIFT_PARTS.map((p) => {
            const items = LIFTS.filter((l) => l.part === p.key && match(liftName(l.id)));
            const mine = custom.filter((c) => partOfCustom(c) === p.key && match(c.n));
            if (items.length === 0 && mine.length === 0) return null;
            return (
              <View key={p.key}>
                <Text style={s.groupT}>{t(p.label)}</Text>
                {items.map((l) => (
                  <Pressable key={l.id} style={s.row} onPress={() => pick(l.canon)}>
                    <Text style={s.rowT}>{liftName(l.id)}</Text>
                    {/* 自重種目は入れるkgが加重だと、ダンベル種目はkgが片側だと選ぶ前に分かるようにする */}
                    {l.bw != null && <Text style={s.bwTag}>{t('加重')}</Text>}
                    {l.db && <Text style={s.bwTag}>{t('ダンベル')}</Text>}
                    <Text style={s.arrow}>›</Text>
                  </Pressable>
                ))}
                {mine.map(customRow)}
              </View>
            );
          })}

          {/* 部位を選ばずに追加した種目（旧バージョンで足したものを含む） */}
          {otherCustom.length > 0 && (
            <View>
              <Text style={s.groupT}>{t(liftPartLabel(OTHER_PART))}</Text>
              {otherCustom.map(customRow)}
            </View>
          )}
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
  addBox: { marginBottom: 6 },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.accentSoft, borderWidth: 1.5, borderColor: C.accentBorder,
    borderRadius: 12, padding: 12, marginBottom: 8,
  },
  addIcon: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: C.teal,
    alignItems: 'center', justifyContent: 'center',
  },
  addT: { flex: 1, fontSize: 15, fontWeight: '700', color: C.accentInk },
  formLabel: { fontSize: 12, fontWeight: '800', color: C.sub, marginTop: 4, marginBottom: 6, paddingHorizontal: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6, paddingHorizontal: 4 },
  helper: { fontSize: 12, color: C.faint, lineHeight: 17, marginBottom: 4, paddingHorizontal: 4 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 4, marginBottom: 2 },
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: C.teal, borderColor: C.teal },
  check: { color: '#fff', fontSize: 12, fontWeight: '800' },   // アクセント塗り面の上の白文字は固定色
  toggleT: { flex: 1, fontSize: 13, color: C.sub, fontWeight: '600', lineHeight: 18 },
  groupT: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 14, marginBottom: 3 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: C.line,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowT: { flex: 1, fontSize: 15, color: C.ink, fontWeight: '600' },
  bwTag: {
    fontSize: 11, fontWeight: '800', color: C.accentInk, backgroundColor: C.accentBadge,
    borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden',
  },
  arrow: { fontSize: 21, color: C.faint },
}));
