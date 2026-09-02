// コラム（読みもの）: 今日のおすすめ1本＋一覧（未読バッジ）＋全文リーダー
// AIに聞かなくても、数字の意味と行動が分かる状態を目指す
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Modal, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BookOpen, X, ChevronRight } from 'lucide-react-native';
import { getColumns, type Column } from '@/content/columns';
import { C, RADIUS, sheetTopPad, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { isRecent, useRemoteContent } from '@/lib/remoteContent';
import { todayJST } from '@/lib/calc';

const READ_KEY = 'bl-columns-read';
// 「NEW」を出す期間: リモート配信の記事が公開日からこの日数以内で、まだ読んでいないもの
const NEW_DAYS = 30;

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

// 日替わりで1本を選ぶ（未読があれば未読の先頭。全部読んでいれば日付でローテーション）
function pickToday(read: Set<string>): Column {
  const unread = getColumns().filter((c) => !read.has(c.id));
  if (unread.length > 0) return unread[0];
  const day = Math.floor(Date.now() / 86400000);
  return getColumns()[day % getColumns().length];
}

export default function ColumnReader({ variant = 'full' }: { variant?: 'full' | 'compact' } = {}) {
  const [open, setOpen] = useState<Column | null>(null);
  const [read, setRead] = useState<Set<string>>(new Set());
  const insets = useSafeAreaInsets();
  // リモート配信の記事が届いたら（起動後に取得が終わったら）一覧を組み直す
  useRemoteContent();
  const todayStr = todayJST();
  const isNew = (c: Column) => !read.has(c.id) && isRecent(c.publishedAt, todayStr, NEW_DAYS);

  useEffect(() => {
    AsyncStorage.getItem(READ_KEY).then((v) => {
      if (v) { try { setRead(new Set(JSON.parse(v) as string[])); } catch { /* 壊れていたら空から */ } }
    }).catch(() => {});
  }, []);

  const openColumn = useCallback((c: Column) => {
    setOpen(c);
    setRead((prev) => {
      if (prev.has(c.id)) return prev;
      const next = new Set(prev).add(c.id);
      AsyncStorage.setItem(READ_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);

  const today = pickToday(read);
  const rest = getColumns().filter((c) => c.id !== today.id);
  const unreadCount = getColumns().filter((c) => !read.has(c.id)).length;

  const reader = (
      <Modal visible={!!open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(null)}>
        <View style={[s.readerWrap, { paddingTop: sheetTopPad(14) }]}>
          <View style={s.readerHead}>
            <Text style={s.readerEmoji}>{open?.emoji}</Text>
            <Pressable onPress={() => setOpen(null)} hitSlop={10}><X size={22} color={C.sub} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
            <Text style={s.readerTitle}>{open?.title}</Text>
            <Text style={s.readerMeta}>{open?.lead}・{t('約{n}分で読めます', { n: open?.minutes ?? 0 })}</Text>
            {open && <Body text={open.body} />}
            {open && open.sources.length > 0 && (
              <View style={s.srcBox}>
                <Text style={s.srcHead}>{t('参考にした資料')}</Text>
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
  );

  // compact: 相談タブのウェルカムに置く「今日のおすすめ」1枚。
  // AIに聞く画面と読みものは同じ「分からないことを解消する場所」なので隣に置く
  if (variant === 'compact') {
    return (
      <View style={s.compactWrap}>
        <View style={[s.h2Row, { marginBottom: 6 }]}>
          <BookOpen size={15} color={C.teal} />
          <Text style={s.compactH}>{t('読みもの')}</Text>
          {unreadCount > 0 && <View style={s.countBadge}><Text style={s.countBadgeT}>{t('未読')} {unreadCount}</Text></View>}
        </View>
        <Pressable style={({ pressed }) => [s.rec, { marginBottom: 0 }, pressed && { opacity: 0.75 }]} onPress={() => openColumn(today)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={s.recEmoji}>{today.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.recTitle} numberOfLines={1}>{today.title}</Text>
              <Text style={s.recLead} numberOfLines={1}>{today.lead}</Text>
            </View>
          </View>
          <Text style={s.recCta}>{t('約{n}分で読む →', { n: today.minutes })}</Text>
        </Pressable>
        {reader}
      </View>
    );
  }

  return (
    <View style={s.card}>
      <View style={s.h2Row}>
        <BookOpen size={16} color={C.teal} />
        <Text style={s.h2}>{t('読みもの')}<Text style={s.h2sub}>— 全{getColumns().length}本</Text></Text>
        {unreadCount > 0 && <View style={s.countBadge}><Text style={s.countBadgeT}>{t('未読')} {unreadCount}</Text></View>}
      </View>

      {/* 今日のおすすめ（未読の先頭を自動で選ぶ） */}
      <Pressable style={({ pressed }) => [s.rec, pressed && { opacity: 0.75 }]} onPress={() => openColumn(today)}>
        <Text style={s.recLabel}>{t('今日のおすすめ')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
          <Text style={s.recEmoji}>{today.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.recTitle}>{today.title}</Text>
            <Text style={s.recLead} numberOfLines={2}>{today.lead}</Text>
          </View>
        </View>
        <Text style={s.recCta}>{t('約{n}分で読む →', { n: today.minutes })}</Text>
      </Pressable>

      {rest.map((c) => (
        <Pressable key={c.id} style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]} onPress={() => openColumn(c)}>
          <Text style={s.emoji}>{c.emoji}</Text>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={s.title} numberOfLines={1}>{c.title}</Text>
              {/* 新着（リモート配信・公開30日以内・未読）は「NEW」、それ以外の未読は点だけ */}
              {isNew(c)
                ? <View style={s.newPill}><Text style={s.newPillT}>{t('NEW')}</Text></View>
                : !read.has(c.id) && <View style={s.newDot} />}
            </View>
            <Text style={s.lead} numberOfLines={1}>{c.lead}・{t('{n}分', { n: c.minutes })}</Text>
          </View>
          <ChevronRight size={16} color={C.faint} />
        </Pressable>
      ))}

      {reader}
    </View>
  );
}

const s = themed(() => ({
  compactWrap: { alignSelf: 'stretch', marginTop: 18 },
  compactH: { fontSize: 13, fontWeight: '800', color: C.sub },
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: 20, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 16, marginBottom: 12 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  h2: { fontSize: 15, fontWeight: '800', color: C.ink },
  h2sub: { fontSize: 13, fontWeight: '400', color: C.sub },
  countBadge: { marginLeft: 'auto', backgroundColor: C.accentBadge, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  countBadgeT: { fontSize: 11, fontWeight: '800', color: C.teal },
  rec: {
    backgroundColor: C.accentSoft, borderWidth: 1.5, borderColor: C.accentBorder, borderRadius: 16,
    padding: 12, marginBottom: 10,
  },
  recLabel: { fontSize: 11, fontWeight: '800', color: C.teal, letterSpacing: 0.6 },
  recEmoji: { fontSize: 26 },
  recTitle: { fontSize: 17, fontWeight: '800', color: C.ink },
  recLead: { fontSize: 13, color: C.sub, marginTop: 2, lineHeight: 18 },
  recCta: { fontSize: 13, fontWeight: '800', color: C.teal, marginTop: 8, textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: C.line },
  emoji: { fontSize: 21 },
  title: { fontSize: 15, fontWeight: '700', color: C.ink, flexShrink: 1 },
  newDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.teal },
  newPill: { backgroundColor: C.accentBadge, borderRadius: RADIUS.chip, paddingHorizontal: 6, paddingVertical: 1 },
  newPillT: { fontSize: 10, fontWeight: '900', color: C.teal, letterSpacing: 0.4 },
  lead: { fontSize: 13, color: C.sub, marginTop: 2 },
  readerWrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20 },
  readerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  readerEmoji: { fontSize: 30 },
  readerTitle: { fontSize: 21, fontWeight: '800', color: C.ink, lineHeight: 32, marginBottom: 6 },
  readerMeta: { fontSize: 13, color: C.faint, marginBottom: 18 },
  p: { fontSize: 17, lineHeight: 26, color: C.ink },
  srcBox: { marginTop: 26, borderTopWidth: 0.5, borderTopColor: C.line, paddingTop: 14 },
  srcHead: { fontSize: 13, fontWeight: '800', color: C.sub, marginBottom: 6 },
  srcLink: { fontSize: 13, color: C.teal, lineHeight: 20, textDecorationLine: 'underline' },
}));
