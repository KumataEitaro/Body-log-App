// ログイン（Web版と同じSupabaseアカウント）
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function login() {
    if (!email.trim() || !password) { setMsg('メールとパスワードを入力してください。'); return; }
    setBusy(true); setMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setMsg(/invalid login/i.test(error.message) ? 'メールまたはパスワードが違います。' : 'ログインに失敗しました。通信環境を確認してください。');
    }
    // 成功時は_layoutの認証ゲートが自動でタブへ遷移させる
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
      <View style={s.inner}>
        <Text style={s.logo}>▍BodyLog</Text>
        <Text style={s.sub}>ネイティブ版（β）— Web版と同じアカウントでログイン</Text>
        <TextInput style={s.input} placeholder="メールアドレス" placeholderTextColor={C.faint}
                   autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <TextInput style={s.input} placeholder="パスワード" placeholderTextColor={C.faint}
                   secureTextEntry value={password} onChangeText={setPassword} />
        {msg ? <Text style={s.err}>{msg}</Text> : null}
        <Pressable style={({ pressed }) => [s.btn, pressed && { opacity: 0.8 }]} onPress={login} disabled={busy}>
          <Text style={s.btnT}>{busy ? 'ログイン中…' : 'ログイン'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, justifyContent: 'center' },
  inner: { paddingHorizontal: 28 },
  logo: { fontSize: 28, fontWeight: '800', color: C.ink, marginBottom: 6 },
  sub: { fontSize: 13, color: C.sub, marginBottom: 24 },
  input: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: C.ink, marginBottom: 10,
  },
  err: { color: C.coral, fontSize: 13, marginBottom: 6 },
  btn: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  btnT: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 1 },
});
