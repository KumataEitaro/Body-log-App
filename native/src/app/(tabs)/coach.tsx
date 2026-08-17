// AIコーチ相談タブ: 本人データを根拠に回答
// 初期状態は中央寄せのウェルカムUI（アイコン+2x2クイック質問）。会話開始後は通常のタイムライン
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { apiPost } from '@/lib/api';
import { C } from '@/lib/ui';
import StatusBarMask from '@/components/StatusBarMask';
import QuickLogFab from '@/components/QuickLogFab';

type Msg = { role: 'user' | 'ai'; text: string };

const QUICK = [
  { e: '🥪', t: '過食しちゃった時の対処法' },
  { e: '📉', t: '体重が落ちない原因は？' },
  { e: '🏋️', t: '今日の筋トレアドバイス' },
  { e: '💤', t: '気分が乗らない時は？' },
] as const;

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

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [msgs, busy]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const hist = msgs.slice(-6);
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setBusy(true);
    try {
      const { ok, json } = await apiPost<{ ok: boolean; answer?: string; error?: string }>(
        '/api/coach', { question, history: hist });
      if (!ok || !json?.ok || !json.answer) {
        setMsgs((m) => [...m, { role: 'ai', text: json?.error || 'うまく答えられませんでした。もう一度お試しください。' }]);
        return;
      }
      setMsgs((m) => [...m, { role: 'ai', text: json.answer! }]);
    } catch {
      setMsgs((m) => [...m, { role: 'ai', text: '通信に失敗しました。電波状況を確認してください。' }]);
    } finally {
      setBusy(false);
    }
  }

  const empty = msgs.length === 0 && !busy;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={s.wrap}>
        {empty ? (
          /* ===== Empty State: 中央寄せのウェルカムUI ===== */
          <View style={s.welcomeWrap}>
            <View style={s.welcomeIcon}><Text style={{ fontSize: 36 }}>🧠</Text></View>
            <Text style={s.welcomeTitle}>AIコーチに相談する</Text>
            <Text style={s.welcomeSub}>直近の食事・体重・栄養ログをもとにアドバイスします</Text>
            <View style={s.quickGrid}>
              {QUICK.map((q) => (
                <Pressable key={q.t} style={({ pressed }) => [s.quickCard, pressed && { opacity: 0.7 }]} onPress={() => send(q.t)}>
                  <Text style={s.quickEmoji}>{q.e}</Text>
                  <Text style={s.quickT}>{q.t}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          /* ===== 会話タイムライン ===== */
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 56, paddingBottom: 8 }}
                      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {msgs.map((m, i) => (
              <View key={i} style={[s.bubble, m.role === 'user' ? s.bUser : s.bAi]}>
                {m.role === 'ai'
                  ? <RichText text={m.text} style={s.bubbleT} />
                  : <Text style={[s.bubbleT, { color: '#fff' }]}>{m.text}</Text>}
              </View>
            ))}
            {busy && (
              <View style={[s.bubble, s.bAi, { flexDirection: 'row', gap: 8, alignItems: 'center' }]}>
                <ActivityIndicator size="small" color={C.teal} />
                <Text style={s.bubbleT}>データを確認しています…</Text>
              </View>
            )}
          </ScrollView>
        )}

        {/* 入力ドック（下部固定・キーボード直上に追従） */}
        <View style={s.inRow}>
          <TextInput style={s.input} placeholder="相談してみる…" placeholderTextColor={C.faint}
                     value={input} onChangeText={setInput} multiline />
          <Pressable style={({ pressed }) => [s.send, (busy || !input.trim()) && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
                     onPress={() => send(input)} disabled={busy || !input.trim()}>
            <Text style={s.sendT}>送信</Text>
          </Pressable>
        </View>
        <Text style={s.disclaimer}>医療的な診断はできません。深刻な不調が続く場合は医療機関へ。</Text>
      </View>
      <QuickLogFab />
      <StatusBarMask />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16, paddingBottom: 6 },
  welcomeWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 30 },
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
  inRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 6 },
  input: {
    flex: 1, minHeight: 42, maxHeight: 100, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    borderRadius: 21, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 16, color: C.ink,
  },
  send: { backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 13 },
  sendT: { color: '#fff', fontSize: 13, fontWeight: '800' },
  disclaimer: { fontSize: 10, color: C.faint, marginTop: 5 },
});
