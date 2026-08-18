// AIコーチ相談タブ: 本人データを根拠に回答
// 初期状態は中央寄せのウェルカムUI（アイコン+2x2クイック質問）。会話開始後は通常のタイムライン
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ArrowUp, Utensils, TrendingDown, Dumbbell, Moon, ChevronDown, History, X, type LucideIcon } from 'lucide-react-native';
import { Keyboard } from 'react-native';
import { useKeyboardVisible } from '@/lib/useKeyboardVisible';
import AiCoachLogo from '@/components/AiCoachLogo';
import { apiPost } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import StatusBarMask from '@/components/StatusBarMask';
import { useGuideTarget } from '@/components/GuideTour';
import HeaderGear from '@/components/HeaderGear';
import ColumnReader from '@/components/ColumnReader';
import { t } from '@/lib/i18n';

// AIが提案した目標変更（承認制で直接適用する）
type CoachAction =
  | { kind: 'pfc'; protein_per_kg?: number; fat_per_kg?: number; label: string }
  | { kind: 'weight'; target_weight?: number; target_date?: string; label: string }
  | { kind: 'training'; name: string; target_kg: number; label: string };

type Msg = { role: 'user' | 'ai'; text: string; action?: CoachAction; applied?: boolean };

// 過去の相談は端末に保存して日付で振り返れるようにする
type HistEntry = { d: string; role: 'user' | 'ai'; text: string };
const HIST_KEY = 'bl-coach-history';
const HIST_MAX = 800;

const quickList = (): { Icon: LucideIcon; t: string }[] => [
  { Icon: Utensils, t: t('過食しちゃった時の対処法') },
  { Icon: TrendingDown, t: t('体重が落ちない原因は？') },
  { Icon: Dumbbell, t: t('今日の筋トレアドバイス') },
  { Icon: Moon, t: t('気分が乗らない時は？') },
];

// AI回答の軽量リッチ表示: **太字**・「・」箇条書き・空行をネイティブに描画（Wall of Text対策）
function RichText({ text, style }: { text: string; style: object }) {
  const bold = (s2: string) =>
    s2.split(/\*\*(.+?)\*\*/g).map((p, j) => (j % 2 === 1 ? <Text key={j} style={{ fontWeight: '800' }}>{p}</Text> : p));
  return (
    <View>
      {text.split('\n').map((ln, i) => {
        if (ln.trim() === '') return <View key={i} style={{ height: 7 }} />;
        const m = ln.match(/^[・\-•]\s?(.*)$/);
        if (m) {
          return (
            <View key={i} style={{ flexDirection: 'row', marginTop: 2 }}>
              <Text style={[style, { marginRight: 5 }]}>・</Text>
              <Text style={[style, { flex: 1 }]}>{bold(m[1])}</Text>
            </View>
          );
        }
        return <Text key={i} style={style}>{bold(ln)}</Text>;
      })}
    </View>
  );
}

export default function CoachScreen() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const welcomeTarget = useGuideTarget('welcome');
  const kbVisible = useKeyboardVisible();
  const [histOpen, setHistOpen] = useState(false);
  const [histQ, setHistQ] = useState('');
  const [hist, setHist] = useState<HistEntry[]>([]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [msgs, busy]);

  // 他タブで開いたキーボードを引き継がない（入力欄をタップしたときだけ立ち上げる）
  useFocusEffect(useCallback(() => { Keyboard.dismiss(); }, []));

  // 相談履歴のロード＆追記（端末ローカル・日付検索用）
  useEffect(() => {
    AsyncStorage.getItem(HIST_KEY).then((raw) => {
      if (raw) { try { setHist(JSON.parse(raw)); } catch { /* 壊れていたら空から */ } }
    });
  }, []);
  function logHist(role: 'user' | 'ai', text: string) {
    setHist((prev) => {
      const next = [...prev, { d: new Date().toISOString(), role, text }].slice(-HIST_MAX);
      AsyncStorage.setItem(HIST_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  // 検索（日付 "8/15"・"2026/8/15" or キーワード）→ 日付ごとにグループ化（新しい日が上）
  const histGroups = useMemo(() => {
    const q = histQ.trim().toLowerCase();
    const fmt = (iso: string) => {
      const t = new Date(iso);
      return `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()}`;
    };
    const groups: { date: string; items: HistEntry[] }[] = [];
    for (const e of hist) {
      const date = fmt(e.d);
      if (q && !date.includes(q) && !date.slice(5).includes(q) && !e.text.toLowerCase().includes(q)) continue;
      const g = groups[groups.length - 1];
      if (g && g.date === date) g.items.push(e);
      else groups.push({ date, items: [e] });
    }
    return groups.reverse();
  }, [hist, histQ]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const history = msgs.slice(-6);
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    logHist('user', question);
    setInput('');
    setBusy(true);
    try {
      const { ok, json } = await apiPost<{ ok: boolean; answer?: string; action?: CoachAction | null; error?: string }>(
        '/api/coach', { question, history });
      if (!ok || !json?.ok || !json.answer) {
        setMsgs((m) => [...m, { role: 'ai', text: json?.error || t('うまく答えられませんでした。もう一度お試しください。') }]);
        return;
      }
      setMsgs((m) => [...m, { role: 'ai', text: json.answer!, action: json.action ?? undefined }]);
      logHist('ai', json.answer!);
    } catch {
      setMsgs((m) => [...m, { role: 'ai', text: t('通信に失敗しました。電波状況を確認してください。') }]);
    } finally {
      setBusy(false);
    }
  }

  // AI提案の目標を承認制で適用（確認ダイアログ→goals/training_goals更新）
  function applyAction(a: CoachAction, idx: number) {
    Alert.alert('目標を更新しますか？', a.label, [
      { text: t('キャンセル'), style: 'cancel' },
      {
        text: t('適用する'),
        onPress: async () => {
          const { data: { session } } = await supabase.auth.getSession();
          const uid = session?.user?.id;
          if (!uid) return;
          let error: { message: string } | null = null;
          if (a.kind === 'pfc') {
            const patch: Record<string, number> = {};
            if (a.protein_per_kg != null) patch.protein_per_kg = Number(a.protein_per_kg);
            if (a.fat_per_kg != null) patch.fat_per_kg = Number(a.fat_per_kg);
            ({ error } = await supabase.from('goals').update(patch).eq('user_id', uid));
          } else if (a.kind === 'weight') {
            const patch: Record<string, number | string> = {};
            if (a.target_weight != null) patch.target_weight = Number(a.target_weight);
            if (a.target_date) patch.target_date = a.target_date;
            ({ error } = await supabase.from('goals').update(patch).eq('user_id', uid));
          } else if (a.kind === 'training') {
            ({ error } = await supabase.from('training_goals')
              .upsert({ user_id: uid, name: a.name, target_kg: Number(a.target_kg) }, { onConflict: 'user_id,name' }));
          }
          if (error) {
            setMsgs((m) => [...m, { role: 'ai', text: t('目標の更新に失敗しました。「概要」タブから手動で設定してください。') }]);
            return;
          }
          setMsgs((m) => m.map((x, i) => (i === idx ? { ...x, applied: true } : x)));
        },
      },
    ]);
  }

  const empty = msgs.length === 0 && !busy;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={s.wrap}>
        {empty ? (
          /* ===== Empty State: 中央寄せのウェルカムUI（キーボード表示中はスクロールしてロゴまで見える） ===== */
          <ScrollView
            contentContainerStyle={[s.welcomeScroll, { paddingTop: insets.top + 8 }]}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}>
            <View style={s.welcomeWrap} ref={welcomeTarget} collapsable={false}
                  onStartShouldSetResponder={() => { Keyboard.dismiss(); return false; }}>
              <View style={{ marginBottom: 14 }}><AiCoachLogo size={72} /></View>
              <Text style={s.welcomeTitle}>{t('AIコーチに相談する')}</Text>
              <Text style={s.welcomeSub}>{t('直近の食事・体重・栄養ログをもとにアドバイスします')}</Text>
              <View style={s.quickGrid}>
                {quickList().map((q) => (
                  <Pressable key={q.t} style={({ pressed }) => [s.quickCard, pressed && { opacity: 0.7 }]} onPress={() => send(q.t)}>
                    <q.Icon color={C.teal} size={21} strokeWidth={2.2} />
                    <Text style={s.quickT}>{q.t}</Text>
                  </Pressable>
                ))}
              </View>
              {/* 聞く前に読める知識（PFCの意味など、毎回AIに聞かなくて済むように） */}
              <View style={{ alignSelf: 'stretch', marginTop: 22 }}>
                <ColumnReader />
              </View>
            </View>
          </ScrollView>
        ) : (
          /* ===== 会話タイムライン ===== */
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 52, paddingBottom: 8 }}
                      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {msgs.map((m, i) => (
              <View key={i}>
                <View style={[s.bubble, m.role === 'user' ? s.bUser : s.bAi]}>
                  {m.role === 'ai'
                    ? <RichText text={m.text} style={s.bubbleT} />
                    : <Text style={[s.bubbleT, { color: '#fff' }]}>{m.text}</Text>}
                </View>
                {/* 目標変更の提案アクションカード（承認制） */}
                {m.action && (
                  <View style={s.actionCard}>
                    <Text style={s.actionLabel}>💡 {m.action.label}</Text>
                    {m.applied ? (
                      <Text style={s.actionDone}>{t('✓ 適用しました（「概要」タブに反映）')}</Text>
                    ) : (
                      <Pressable style={s.actionBtn} onPress={() => applyAction(m.action!, i)}>
                        <Text style={s.actionBtnT}>{t('この目標を適用する')}</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            ))}
            {busy && (
              <View style={[s.bubble, s.bAi, { flexDirection: 'row', gap: 8, alignItems: 'center' }]}>
                <ActivityIndicator size="small" color={C.teal} />
                <Text style={s.bubbleT}>{t('データを確認しています…')}</Text>
              </View>
            )}
          </ScrollView>
        )}

        {/* 入力ドック（下部固定・フィールド内右端にインライン送信アイコン） */}
        <View style={s.inRow}>
          {kbVisible && (
            <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8} style={s.kbDismiss}>
              <ChevronDown size={19} color={C.sub} strokeWidth={2.5} />
            </Pressable>
          )}
          <TextInput style={s.input} placeholder="相談してみる…" placeholderTextColor={C.faint}
                     value={input} onChangeText={setInput} multiline />
          <Pressable
            style={[s.sendInline, { backgroundColor: input.trim() && !busy ? C.teal : C.line }]}
            onPress={() => send(input)} disabled={busy || !input.trim()} hitSlop={6}>
            <ArrowUp color="#fff" size={16} strokeWidth={3} />
          </Pressable>
        </View>
        <Text style={s.disclaimer}>{t('医療的な診断はできません。深刻な不調が続く場合は医療機関へ。')}</Text>
      </View>
      <StatusBarMask />
      <HeaderGear />
      {/* 中央上: タブタイトル（履歴と⚙の間） */}
      <Text style={[s.pageTitle, { top: insets.top + 12 }]} pointerEvents="none">{t('相談')}</Text>
      {/* 左上: 相談履歴（⚙とミラー配置） */}
      <Pressable style={[s.histBtn, { top: insets.top + 8 }]} onPress={() => { Keyboard.dismiss(); setHistOpen(true); }} hitSlop={10}>
        <History size={16} color={C.sub} />
      </Pressable>

      {/* ===== 相談履歴モーダル: 日付グループ＋日付/キーワード検索 ===== */}
      <Modal visible={histOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setHistOpen(false)}>
        <View style={s.histWrap}>
          <View style={s.histHead}>
            <Text style={s.histTitle}>{t('相談履歴')}</Text>
            <Pressable onPress={() => setHistOpen(false)} hitSlop={10}><X size={20} color={C.sub} /></Pressable>
          </View>
          <TextInput
            style={s.histSearch} placeholder="日付やキーワードで検索（例: 8/15、タンパク質）" placeholderTextColor={C.faint}
            value={histQ} onChangeText={setHistQ} returnKeyType="search" clearButtonMode="while-editing"
          />
          {histGroups.length === 0 ? (
            <Text style={s.histEmpty}>{hist.length === 0 ? 'まだ相談履歴がありません。' : t('該当する履歴が見つかりません。')}</Text>
          ) : (
            <ScrollView style={{ flex: 1 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
              {histGroups.map((g) => (
                <View key={g.date} style={{ marginBottom: 16 }}>
                  <Text style={s.histDate}>{g.date}</Text>
                  {g.items.map((e, i) => (
                    <View key={i} style={[s.bubble, e.role === 'user' ? s.bUser : s.bAi]}>
                      {e.role === 'ai'
                        ? <RichText text={e.text} style={s.bubbleT} />
                        : <Text style={[s.bubbleT, { color: '#fff' }]}>{e.text}</Text>}
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16, paddingBottom: 6 },
  welcomeScroll: { flexGrow: 1, justifyContent: 'center', paddingBottom: 10 },
  welcomeWrap: { alignItems: 'center', paddingBottom: 30 },
  welcomeIcon: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: C.panel,
    borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  welcomeTitle: { fontSize: 19, fontWeight: '800', color: C.ink },
  welcomeSub: { fontSize: 12.5, color: C.sub, marginTop: 6, marginBottom: 20, textAlign: 'center', lineHeight: 19 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  quickCard: {
    width: '46%', backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16,
    paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center', gap: 6,
  },
  quickEmoji: { fontSize: 22 },
  quickT: { fontSize: 12, fontWeight: '700', color: C.ink, textAlign: 'center', lineHeight: 17 },
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8, maxWidth: '88%' },
  bUser: { backgroundColor: C.ink, alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  bAi: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  bubbleT: { fontSize: 14, lineHeight: 22, color: C.ink },
  actionCard: {
    alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: C.accentBadge,
    borderWidth: 1, borderColor: C.teal, borderRadius: 14, padding: 12, marginBottom: 8, marginTop: -2,
  },
  actionLabel: { fontSize: 13, fontWeight: '700', color: C.ink, lineHeight: 19 },
  actionBtn: { backgroundColor: C.teal, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16, alignSelf: 'flex-start', marginTop: 8 },
  actionBtnT: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  actionDone: { color: C.teal, fontSize: 12.5, fontWeight: '800', marginTop: 8 },
  inRow: {
    flexDirection: 'row', alignItems: 'flex-end', marginTop: 6,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 22,
    paddingLeft: 14, paddingRight: 5, paddingVertical: 5,
  },
  input: { flex: 1, minHeight: 32, maxHeight: 100, fontSize: 16, color: C.ink, paddingTop: 6, paddingBottom: 6 },
  sendInline: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 0 },
  kbDismiss: { width: 28, height: 32, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  disclaimer: { fontSize: 10, color: C.faint, marginTop: 5 },
  pageTitle: { position: 'absolute', alignSelf: 'center', fontSize: 15, fontWeight: '600', color: C.ink, zIndex: 29 },
  histBtn: {
    position: 'absolute', left: 16, zIndex: 30,
    width: 30, height: 30, borderRadius: 9,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.panel,
    alignItems: 'center', justifyContent: 'center',
  },
  histWrap: { flex: 1, backgroundColor: C.bg, padding: 16, paddingTop: 18 },
  histHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  histTitle: { fontSize: 17, fontWeight: '800', color: C.ink },
  histSearch: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.ink, marginBottom: 12,
  },
  histDate: { fontSize: 12, fontWeight: '800', color: C.sub, marginBottom: 6 },
  histEmpty: { fontSize: 13, color: C.sub, marginTop: 24, textAlign: 'center' },
});
