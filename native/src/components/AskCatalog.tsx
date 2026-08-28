// 「AIに何を聞けるか」の一覧。
//
// 例が4つだけでは、このAIが自分の記録を読んで答えることが伝わらない。
// カテゴリで畳んで全体像を見せ、開くと具体的な質問が並ぶ形にした。
// 検索も付けて、聞きたいことが頭にある人はそこから辿れるようにしている。
import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Search, ChevronDown, ChevronRight, Sparkles } from 'lucide-react-native';
import { C, sheetTopPad } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { askCategories } from '@/content/askExamples';

export default function AskCatalog({ visible, onClose, onPick }: {
  visible: boolean;
  onClose: () => void;
  onPick: (question: string) => void;   // 選ぶと閉じてそのまま送信する
}) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const cats = askCategories();
  const query = q.trim().toLowerCase();

  // 検索中はカテゴリを畳まず、該当した質問だけを並べる
  const hits = useMemo(() => {
    if (!query) return null;
    return cats
      .map((c) => ({ ...c, questions: c.questions.filter((x) => x.toLowerCase().includes(query)) }))
      .filter((c) => c.questions.length > 0);
  }, [query, cats]);

  const list = hits ?? cats;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.wrap, { paddingTop: sheetTopPad(16) }]}>
        <View style={s.head}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 }}>
            <Sparkles size={18} color={C.teal} />
            <Text style={s.title}>{t('何が聞ける？')}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10}><X size={22} color={C.sub} /></Pressable>
        </View>
        <Text style={s.sub}>
          {t('あなたの記録（食事・体重・運動・気分）を根拠に答えます。タップするとそのまま質問できます。')}
        </Text>

        <View style={s.searchRow}>
          <Search size={15} color={C.faint} />
          <TextInput style={s.search} placeholder={t('聞きたいことを探す')} placeholderTextColor={C.faint}
                     value={q} onChangeText={setQ} clearButtonMode="while-editing" />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
          {list.length === 0 && (
            <Text style={s.empty}>{t('見つかりませんでした。そのまま自由に書いても答えられます。')}</Text>
          )}

          {list.map((c) => {
            const expanded = query.length > 0 || open === c.key;
            return (
              <View key={c.key} style={s.cat}>
                <Pressable style={s.catHead}
                           onPress={() => setOpen((cur) => (cur === c.key ? null : c.key))}
                           disabled={query.length > 0}>
                  <Text style={s.catEmoji}>{c.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.catTitle}>{c.title}</Text>
                    <Text style={s.catLead}>{c.lead}</Text>
                  </View>
                  {query.length === 0 && (expanded
                    ? <ChevronDown size={18} color={C.faint} />
                    : <ChevronRight size={18} color={C.faint} />)}
                </Pressable>

                {expanded && c.questions.map((x) => (
                  <Pressable key={x} style={({ pressed }) => [s.qRow, pressed && { backgroundColor: C.pressed }]}
                             onPress={() => { onPick(x); onClose(); }}>
                    <Text style={s.qText}>{x}</Text>
                    <Text style={s.qArrow}>›</Text>
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

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  sub: { fontSize: 13, color: C.sub, lineHeight: 18, marginTop: 6, marginBottom: 10 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.chipBg,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10,
  },
  search: { flex: 1, fontSize: 17, color: C.ink, padding: 0 },
  cat: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    borderRadius: 16, marginBottom: 9, overflow: 'hidden',
  },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 },
  catEmoji: { fontSize: 21 },
  catTitle: { fontSize: 15, fontWeight: '800', color: C.ink },
  catLead: { fontSize: 13, color: C.sub, marginTop: 2 },
  qRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 11, paddingHorizontal: 14,
    borderTopWidth: 0.5, borderTopColor: C.line,
  },
  qText: { flex: 1, fontSize: 15, color: C.ink },
  qArrow: { fontSize: 21, color: C.faint },
  empty: { fontSize: 15, color: C.sub, marginTop: 24, textAlign: 'center', lineHeight: 21 },
});
