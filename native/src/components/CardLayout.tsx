// カードの並び替え＋表示/非表示を扱う共通レイヤー（Apple ヘルスケアの「リストを編集」に相当）
// 編集モード: 各カードの左上に⊖、見出しの右に⊕。⊕で非表示カードの一覧を開いて戻せる。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Minus, Plus, X, Search } from 'lucide-react-native';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';

export type CardLayout = { order: string[]; hidden: string[] };

/** 保存済みレイアウトを現行のカード構成へすり合わせる（カードが増減しても壊れない） */
export function mergeLayout(saved: Partial<CardLayout> | null, all: string[]): CardLayout {
  const savedOrder = Array.isArray(saved?.order) ? saved!.order.filter((k) => all.includes(k)) : [];
  const order = [...savedOrder, ...all.filter((k) => !savedOrder.includes(k))];
  const hidden = (Array.isArray(saved?.hidden) ? saved!.hidden : []).filter((k) => all.includes(k));
  return { order, hidden };
}

/** レイアウトの読み書き（キーごとに独立して保存する） */
export function useCardLayout(storageKey: string, all: string[]) {
  const [layout, setLayout] = useState<CardLayout>(() => mergeLayout(null, all));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        const parsed = raw ? (JSON.parse(raw) as Partial<CardLayout>) : null;
        setLayout(mergeLayout(parsed, all));
      })
      .catch(() => setLayout(mergeLayout(null, all)))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const save = useCallback((next: CardLayout) => {
    setLayout(next);
    AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
  }, [storageKey]);

  const hide = useCallback((key: string) => {
    setLayout((prev) => {
      if (prev.hidden.includes(key)) return prev;
      const next = { ...prev, hidden: [...prev.hidden, key] };
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [storageKey]);

  const show = useCallback((key: string) => {
    setLayout((prev) => {
      const next = { ...prev, hidden: prev.hidden.filter((k) => k !== key) };
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [storageKey]);

  const setOrder = useCallback((order: string[]) => {
    setLayout((prev) => ({ ...prev, order }));
  }, []);

  const reset = useCallback(() => {
    const next = mergeLayout(null, all);
    setLayout(next);
    AsyncStorage.removeItem(storageKey).catch(() => {});
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const visible = useMemo(
    () => layout.order.filter((k) => !layout.hidden.includes(k)),
    [layout],
  );

  return { layout, visible, loaded, hide, show, setOrder, save, reset };
}

/** 編集モード中にカードを包み、左上に⊖を出す */
export function HideableCard({ editing, onHide, label, children }: {
  editing: boolean;
  onHide: () => void;
  label: string;
  children: React.ReactNode;
}) {
  if (!editing) return <>{children}</>;
  return (
    <View>
      {children}
      <Pressable style={s.minusBtn} onPress={onHide} hitSlop={10} accessibilityLabel={t('{label}を非表示', { label })}>
        <Minus size={16} color="#fff" strokeWidth={3.5} />
      </Pressable>
    </View>
  );
}

/** カード内に置く⊖バッジ（カードのJSXを包まずに済むので既存レイアウトを壊さない） */
export function MinusBadge({ editing, onPress }: { editing: boolean; onPress: () => void }) {
  if (!editing) return null;
  return (
    <Pressable style={s.minusBtn} onPress={onPress} hitSlop={10}>
      <Minus size={16} color="#fff" strokeWidth={3.5} />
    </Pressable>
  );
}

/** 非表示カードを戻す画面（検索付き。ヘルスケアの「リストを編集」に相当） */
export function AddCardSheet({ visible: open, onClose, hidden, labels, onShow, shownKeys }: {
  visible: boolean;
  onClose: () => void;
  hidden: string[];
  labels: Record<string, string>;
  onShow: (key: string) => void;
  shownKeys: string[];
}) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const match = (k: string) => (labels[k] ?? k).toLowerCase().includes(q.trim().toLowerCase());
  const hiddenHits = hidden.filter(match);
  const shownHits = shownKeys.filter(match);

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.sheet, { paddingTop: 16 }]}>
        <View style={s.sheetHead}>
          <Text style={s.sheetTitle}>{t('表示する項目を編集')}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={s.doneBtn}>
            <Text style={s.doneT}>{t('完了')}</Text>
          </Pressable>
        </View>

        <View style={s.searchRow}>
          <Search size={15} color={C.faint} />
          <TextInput style={s.search} placeholder={t('検索')} placeholderTextColor={C.faint}
                     value={q} onChangeText={setQ} clearButtonMode="while-editing" />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
          {hiddenHits.length > 0 && (
            <>
              <Text style={s.groupT}>{t('非表示中')}</Text>
              {hiddenHits.map((k) => (
                <Pressable key={k} style={s.row} onPress={() => onShow(k)}>
                  <View style={s.plusCircle}><Plus size={14} color="#fff" strokeWidth={3.5} /></View>
                  <Text style={s.rowT}>{labels[k] ?? k}</Text>
                </Pressable>
              ))}
            </>
          )}

          <Text style={s.groupT}>{t('表示中')}</Text>
          {shownHits.map((k) => (
            <View key={k} style={s.row}>
              <View style={s.checkCircle}><X size={12} color={C.faint} strokeWidth={3} /></View>
              <Text style={[s.rowT, { color: C.sub }]}>{labels[k] ?? k}</Text>
            </View>
          ))}

          {hidden.length === 0 && (
            <Text style={s.note}>{t('いまは全部表示しています。カードの左上の⊖で隠せます。')}</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  minusBtn: {
    position: 'absolute', top: -6, left: -6, width: 26, height: 26, borderRadius: 13,
    backgroundColor: C.coral, alignItems: 'center', justifyContent: 'center', zIndex: 20,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 4,
  },
  sheet: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: C.ink },
  doneBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: C.teal },
  doneT: { color: '#fff', fontSize: 15, fontWeight: '800' },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.chipBg,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10,
  },
  search: { flex: 1, fontSize: 17, color: C.ink, padding: 0 },
  groupT: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 14, marginBottom: 4, letterSpacing: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: C.line },
  plusCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  checkCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.chipBg, alignItems: 'center', justifyContent: 'center' },
  rowT: { flex: 1, fontSize: 17, color: C.ink, fontWeight: '600' },
  note: { fontSize: 13, color: C.sub, marginTop: 20, lineHeight: 20 },
});
