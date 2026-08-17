// AIコーチ相談タブ（Phase 2）: 本人データを根拠に回答。Web版 /coach の移植
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { apiPost } from '@/lib/api';
import { C } from '@/lib/ui';
import StatusBarMask from '@/components/StatusBarMask';

type Msg = { role: 'user' | 'ai'; text: string };

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
const QUICK = ['気分がすぐれないんだけど、何が原因かな', '過食しちゃった…', '体重が減らなくなってきた', '最近トレの調子が上がらない'];

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

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }} keyboardVerticalOffset={90}>
      <View style={s.wrap}>
        <Text style={s.h}>🧠 AIコーチ <Text style={s.hsub}>— あなたの記録が根拠</Text></Text>
        <ScrollView ref={scrollRef} style={s.log} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
          {msgs.length === 0 && (
            <Text style={s.intro}>直近28日の摂取・収支・栄養素・体重・気分・メモを見た上で答えます。下の例をタップするか、自由に書いてください。</Text>
          )}
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
          {msgs.length === 0 && (
            <View style={s.quickWrap}>
              {QUICK.map((q) => (
                <Pressable key={q} style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]} onPress={() => send(q)}>
                  <Text style={s.chipT}>{q}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
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
      <StatusBarMask />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 16, paddingTop: 64 },
  h: { fontSize: 16, fontWeight: '800', color: C.ink, marginBottom: 8 },
  hsub: { fontSize: 12, fontWeight: '400', color: C.sub },
  log: { flex: 1 },
  intro: { fontSize: 13, color: C.sub, lineHeight: 21, marginBottom: 12 },
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8, maxWidth: '88%' },
  bUser: { backgroundColor: C.ink, alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  bAi: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  bubbleT: { fontSize: 14, lineHeight: 22, color: C.ink },
  quickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  chipT: { fontSize: 12.5, fontWeight: '700', color: C.sub },
  inRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 8 },
  input: {
    flex: 1, minHeight: 42, maxHeight: 100, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    borderRadius: 21, paddingHorizontal: 16, paddingVertical: 10, fontSize: 16, color: C.ink,
  },
  send: { backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 13 },
  sendT: { color: '#fff', fontSize: 13, fontWeight: '800' },
  disclaimer: { fontSize: 10, color: C.faint, marginTop: 6 },
});
