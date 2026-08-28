// 通知センター: 「いま入力すべきこと」を一覧で見て、その場で該当画面へ飛べる
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Modal, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X, BellRing, Check } from 'lucide-react-native';
import { C, sheetTopPad } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { buildTodos, badgeCount, type Todo } from '@/lib/todos';

/** 未対応件数を購読する（⚙や設定行のバッジ用） */
export function useTodoBadge() {
  const [count, setCount] = useState(0);
  const [todos, setTodos] = useState<Todo[]>([]);
  const refresh = useCallback(async () => {
    try {
      const r = await buildTodos();
      setTodos(r.todos);
      setCount(badgeCount(r.todos));
    } catch { /* 取得できなくてもバッジを出さないだけ */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { count, todos, refresh };
}

export default function NotificationCenter({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [todos, setTodos] = useState<Todo[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTodos(null);
    buildTodos().then((r) => setTodos(r.todos)).catch(() => setTodos([]));
  }, [visible]);

  function go(todo: Todo) {
    onClose();
    setTimeout(() => router.push(todo.route as never), 250);
  }

  const urgencyStyle = (u: Todo['urgency']) =>
    u === 'now' ? { bg: C.coralWeak, fg: C.coral, label: t('今日中') }
    : u === 'soon' ? { bg: C.accentBadge, fg: C.teal, label: t('今週中') }
    : { bg: C.chipBg, fg: C.sub, label: t('任意') };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.wrap}>
        <View style={s.head}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <BellRing size={19} color={C.teal} />
            <Text style={s.title}>{t('通知センター')}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10}><X size={22} color={C.sub} /></Pressable>
        </View>
        <Text style={s.sub}>{t('設定した目標をもとに、いま入力すべきことを並べています。')}</Text>

        {todos === null ? (
          <ActivityIndicator color={C.teal} style={{ marginTop: 30 }} />
        ) : todos.length === 0 ? (
          <View style={s.doneBox}>
            <View style={s.doneCircle}><Check size={30} color="#fff" strokeWidth={3} /></View>
            <Text style={s.doneT}>{t('今日やることは全部終わっています')}</Text>
            <Text style={s.doneSub}>{t('この調子で。明日もまた記録しましょう。')}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
            {todos.map((todo) => {
              const u = urgencyStyle(todo.urgency);
              return (
                <Pressable key={todo.key} style={({ pressed }) => [s.row, pressed && { backgroundColor: C.pressed }]}
                           onPress={() => go(todo)}>
                  <Text style={s.icon}>{todo.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={s.rowT} numberOfLines={1}>{t(todo.title)}</Text>
                      <View style={[s.tag, { backgroundColor: u.bg }]}>
                        <Text style={[s.tagT, { color: u.fg }]}>{u.label}</Text>
                      </View>
                    </View>
                    <Text style={s.rowSub}>{t(todo.detail)}</Text>
                  </View>
                  <Text style={s.arrow}>›</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/** 数字バッジ（0件なら何も出さない） */
export function TodoBadge({ count, style }: { count: number; style?: object }) {
  if (count <= 0) return null;
  return (
    <View style={[s.badge, style]}>
      <Text style={s.badgeT}>{count > 9 ? '9+' : count}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: sheetTopPad(16) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  sub: { fontSize: 13, color: C.sub, marginTop: 6, marginBottom: 12, lineHeight: 18 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 6,
    borderBottomWidth: 0.5, borderBottomColor: C.line, borderRadius: 10,
  },
  icon: { fontSize: 21 },
  rowT: { fontSize: 15, fontWeight: '700', color: C.ink, flexShrink: 1 },
  rowSub: { fontSize: 13, color: C.sub, marginTop: 3, lineHeight: 18 },
  arrow: { fontSize: 21, color: C.faint },
  tag: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1.5 },
  tagT: { fontSize: 11, fontWeight: '800' },
  doneBox: { alignItems: 'center', marginTop: 50 },
  doneCircle: { width: 62, height: 62, borderRadius: 31, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  doneT: { fontSize: 17, fontWeight: '800', color: C.ink, marginTop: 14 },
  doneSub: { fontSize: 13, color: C.sub, marginTop: 6 },
  badge: {
    minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.coral,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  badgeT: { color: '#fff', fontSize: 11, fontWeight: '900' },
});
