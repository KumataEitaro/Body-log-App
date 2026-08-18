// コラム（読みもの）: 一覧カード＋全文リーダー
// AIに聞かなくても、数字の意味と行動が分かる状態を目指す
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Modal, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookOpen, X, ChevronRight } from 'lucide-react-native';
import { COLUMNS, type Column } from '@/content/columns';
import { C } from '@/lib/ui';

// **太字** と ・箇条書き と空行に対応した軽量レンダラ
function Body({ text }: { text: string }) {
  const bold = (line: string) =>
    line.split(/\*\*(.+?)\*\*/g).map((p, j) => (j % 2 === 1 ? <Text key={j} style={{ fontWeight: '800' }}>{p}</Text> : p));
  return (
    <View>
      {text.split('\n').map((ln, i) => {
        if (ln.trim() === '') return <View key={i} style={{ height: 12 }} />;
        const m = ln.match(/^・\s?(.*)$/);
        if (m) {
          return (
            <View key={i} style={{ flexDirection: 'row', marginTop: 4 }}>
              <Text style={[s.p, { marginRight: 6 }]}>・</Text>
              <Text style={[s.p, { flex: 1 }]}>{bold(m[1])}</Text>
            </View>
          );
        }
        return <Text key={i} style={s.p}>{bold(ln)}</Text>;
      })}
    </View>
  );
}

export default function ColumnReader({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState<Column | null>(null);
  const insets = useSafeAreaInsets();
  const list = compact ? COLUMNS.slice(0, 3) : COLUMNS;

  return (
    <View style={compact ? undefined : s.card}>
      <View style={s.h2Row}>
        <BookOpen size={14} color={C.teal} />
        <Text style={s.h2}>読みもの <Text style={s.h2sub}>— 数字の意味がわかる5本</Text></Text>
      </View>
      {list.map((c) => (
        <Pressable key={c.id} style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]} onPress={() => setOpen(c)}>
          <Text style={s.emoji}>{c.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{c.title}</Text>
            <Text style={s.lead} numberOfLines={1}>{c.lead}・{c.minutes}分</Text>
          </View>
          <ChevronRight size={16} color={C.faint} />
        </Pressable>
      ))}

      <Modal visible={!!open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(null)}>
        <View style={[s.readerWrap, { paddingTop: 14 }]}>
          <View style={s.readerHead}>
            <Text style={s.readerEmoji}>{open?.emoji}</Text>
            <Pressable onPress={() => setOpen(null)} hitSlop={10}><X size={22} color={C.sub} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
            <Text style={s.readerTitle}>{open?.title}</Text>
            <Text style={s.readerMeta}>{open?.lead}・約{open?.minutes}分で読めます</Text>
            {open && <Body text={open.body} />}
            {open && open.sources.length > 0 && (
              <View style={s.srcBox}>
                <Text style={s.srcHead}>参考にした資料</Text>
                {open.sources.map((src) => (
                  <Pressable key={src.url} onPress={() => Linking.openURL(src.url).catch(() => {})} hitSlop={6}>
                    <Text style={s.srcLink}>・{src.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 16, marginBottom: 12 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  h2: { fontSize: 13, fontWeight: '800', color: C.ink },
  h2sub: { fontSize: 11, fontWeight: '400', color: C.sub },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: C.line },
  emoji: { fontSize: 20 },
  title: { fontSize: 13.5, fontWeight: '700', color: C.ink },
  lead: { fontSize: 11, color: C.sub, marginTop: 2 },
  readerWrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20 },
  readerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  readerEmoji: { fontSize: 30 },
  readerTitle: { fontSize: 22, fontWeight: '800', color: C.ink, lineHeight: 32, marginBottom: 6 },
  readerMeta: { fontSize: 11.5, color: C.faint, marginBottom: 18 },
  p: { fontSize: 15, lineHeight: 26, color: C.ink },
  srcBox: { marginTop: 26, borderTopWidth: 0.5, borderTopColor: C.line, paddingTop: 14 },
  srcHead: { fontSize: 11, fontWeight: '800', color: C.sub, marginBottom: 6 },
  srcLink: { fontSize: 11.5, color: C.teal, lineHeight: 20, textDecorationLine: 'underline' },
});
