// 設定（Phase 1は最小: アカウント情報＋ログアウト。各メニューは順次移植）
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';

export default function SettingsScreen() {
  const [email, setEmail] = useState('');
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user?.email ?? ''));
  }, []);

  return (
    <View style={s.wrap}>
      <Text style={s.h}>設定</Text>
      <View style={s.card}>
        <Text style={s.label}>アカウント</Text>
        <Text style={s.val}>{email || '—'}</Text>
      </View>
      <Text style={s.note}>プロフィール・通知・ヘルスケア連携などの設定は移植中です。それまでは現行アプリで変更できます（データは共通）。</Text>
      <Pressable style={({ pressed }) => [s.btn, pressed && { opacity: 0.8 }]} onPress={() => supabase.auth.signOut()}>
        <Text style={s.btnT}>ログアウト</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, padding: 20, paddingTop: 70 },
  h: { fontSize: 22, fontWeight: '800', color: C.ink, marginBottom: 14 },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { fontSize: 11, fontWeight: '700', color: C.sub, marginBottom: 4 },
  val: { fontSize: 15, color: C.ink, fontWeight: '600' },
  note: { fontSize: 12, color: C.sub, lineHeight: 20, marginBottom: 20 },
  btn: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  btnT: { color: C.coral, fontSize: 14, fontWeight: '800' },
});
