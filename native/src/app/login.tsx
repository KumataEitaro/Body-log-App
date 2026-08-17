// ログイン / 新規登録（Web版と同じSupabaseアカウント）
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';

export default function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [info, setInfo] = useState('');

  async function login() {
    if (!email.trim() || !password) { setMsg('メールとパスワードを入力してください。'); return; }
    setBusy(true); setMsg(''); setInfo('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setMsg(/invalid login/i.test(error.message) ? 'メールまたはパスワードが違います。' : 'ログインに失敗しました。通信環境を確認してください。');
    }
    // 成功時は_layoutの認証ゲートが自動でタブへ遷移させる
  }

  async function signup() {
    const mail = email.trim();
    if (!mail || !password) { setMsg('メールとパスワードを入力してください。'); return; }
    if (password.length < 8) { setMsg('パスワードは8文字以上にしてください。'); return; }
    if (password !== password2) { setMsg('確認用パスワードが一致しません。'); return; }
    setBusy(true); setMsg(''); setInfo('');
    const { data, error } = await supabase.auth.signUp({ email: mail, password });
    setBusy(false);
    if (error) {
      setMsg(/already registered/i.test(error.message) ? 'このメールアドレスは登録済みです。ログインしてください。'
        : /invalid/i.test(error.message) ? 'メールアドレスの形式を確認してください。'
        : '登録に失敗しました。通信環境を確認してください。');
      return;
    }
    // メール確認が有効な場合はセッションが返らない → 確認メール案内
    if (!data.session) {
      setInfo(`確認メールを ${mail} に送りました。メール内のリンクを開いてから、ログインしてください。`);
      setMode('login');
    }
    // セッションが返った場合は_layoutの認証ゲートが自動遷移
  }

  const isLogin = mode === 'login';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
      <View style={s.inner}>
        <Text style={s.logo}>▍BodyLog</Text>
        <Text style={s.sub}>{isLogin ? 'おかえりなさい。記録を続けましょう' : '無料アカウントを作成（Web版と共通）'}</Text>

        {/* ログイン/新規登録の切り替え */}
        <View style={s.segWrap}>
          {([['login', 'ログイン'], ['signup', '新規登録']] as const).map(([k, l]) => (
            <Pressable key={k} style={[s.seg, mode === k && s.segOn]} onPress={() => { setMode(k); setMsg(''); setInfo(''); }}>
              <Text style={[s.segT, mode === k && { color: '#fff' }]}>{l}</Text>
            </Pressable>
          ))}
        </View>

        <TextInput style={s.input} placeholder="メールアドレス" placeholderTextColor={C.faint}
                   autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
        <TextInput style={s.input} placeholder={isLogin ? 'パスワード' : 'パスワード（8文字以上）'} placeholderTextColor={C.faint}
                   secureTextEntry autoComplete={isLogin ? 'password' : 'new-password'} value={password} onChangeText={setPassword} />
        {!isLogin && (
          <TextInput style={s.input} placeholder="パスワード（確認用）" placeholderTextColor={C.faint}
                     secureTextEntry value={password2} onChangeText={setPassword2} />
        )}
        {msg ? <Text style={s.err}>{msg}</Text> : null}
        {info ? <Text style={s.info}>{info}</Text> : null}
        <Pressable style={({ pressed }) => [s.btn, pressed && { opacity: 0.8 }]} onPress={isLogin ? login : signup} disabled={busy}>
          <Text style={s.btnT}>{busy ? (isLogin ? 'ログイン中…' : '登録中…') : (isLogin ? 'ログイン' : 'アカウントを作成')}</Text>
        </Pressable>
        {!isLogin && (
          <Text style={s.terms}>登録すると、記録データはあなた専用の領域に保存されます。退会（データ完全削除）はいつでも設定からできます。</Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, justifyContent: 'center' },
  inner: { paddingHorizontal: 28 },
  logo: { fontSize: 28, fontWeight: '800', color: C.ink, marginBottom: 6 },
  sub: { fontSize: 13, color: C.sub, marginBottom: 18 },
  segWrap: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  seg: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  segOn: { backgroundColor: C.ink, borderColor: C.ink },
  segT: { fontSize: 13, fontWeight: '800', color: C.sub },
  input: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: C.ink, marginBottom: 10,
  },
  err: { color: C.coral, fontSize: 13, marginBottom: 6 },
  info: { color: C.teal, fontSize: 13, marginBottom: 6, lineHeight: 19 },
  btn: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  btnT: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 1 },
  terms: { fontSize: 11, color: C.faint, marginTop: 12, lineHeight: 17, textAlign: 'center' },
});
