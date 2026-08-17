// 設定タブ（Phase 3）: プロフィール編集・アカウント削除（App Store審査必須 5.1.1(v)）・ログアウト
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { apiPost } from '@/lib/api';
import { C } from '@/lib/ui';
import { mifflinBMR } from '@/lib/calc';
import { healthAvailable, requestHealthAuth, importWeights, readActivitySummary, type HealthDaySummary } from '@/lib/health';
import StatusBarMask from '@/components/StatusBarMask';

export default function SettingsScreen() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [height, setHeight] = useState('170');
  const [age, setAge] = useState('30');
  const [life, setLife] = useState('1.3');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [delConfirm, setDelConfirm] = useState('');
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthMsg, setHealthMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [activity, setActivity] = useState<HealthDaySummary[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      setEmail(session?.user?.email ?? '');
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
      if (prof) {
        setName(prof.display_name || '');
        if (prof.sex) setSex(prof.sex);
        if (prof.height_cm != null) setHeight(String(prof.height_cm));
        if (prof.age != null) setAge(String(prof.age));
        if (prof.life_factor != null) setLife(String(prof.life_factor));
      }
    })();
  }, []);

  async function saveProfile() {
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { error } = await supabase.from('profiles').update({
        display_name: name.trim(), sex,
        height_cm: Number(height) || 170, age: Number(age) || 30,
        life_factor: Number(life) || 1.3,
      }).eq('id', uid);
      setMsg(error ? { ok: false, text: '保存に失敗しました。もう一度お試しください。' } : { ok: true, text: '保存しました。' });
    } finally { setBusy(false); }
  }

  function confirmDelete() {
    if (delConfirm !== '削除') return;
    Alert.alert(
      'アカウントを完全に削除しますか？',
      '記録・写真・目標・マイ食品のすべてが削除されます。この操作は取り消せません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: '完全に削除する', style: 'destructive', onPress: deleteAccount },
      ],
    );
  }

  async function deleteAccount() {
    setBusy(true); setMsg(null);
    try {
      const { ok, json } = await apiPost<{ ok: boolean; error?: string }>('/api/account/delete', {});
      if (!ok || !json?.ok) { setMsg({ ok: false, text: json?.error || '削除に失敗しました。もう一度お試しください。' }); return; }
      // アカウントはサーバー側で消滅済み。グローバルsignOutはdead sessionでエラーになり得るためローカルのみ確実に破棄
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    } finally { setBusy(false); }
  }

  async function healthImportWeights() {
    setHealthBusy(true); setHealthMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      if (!(await requestHealthAuth())) { setHealthMsg({ ok: false, text: 'ヘルスケアへのアクセスが許可されませんでした。' }); return; }
      const res = await importWeights(uid, 90);
      if ('error' in res) { setHealthMsg({ ok: false, text: res.error }); return; }
      setHealthMsg({ ok: true, text: res.imported > 0 ? `体重を ${res.imported} 日分 取り込みました。グラフに反映されます。` : '新しく取り込める体重データはありませんでした。' });
    } finally { setHealthBusy(false); }
  }

  async function healthShowActivity() {
    setHealthBusy(true); setHealthMsg(null);
    try {
      if (!(await requestHealthAuth())) { setHealthMsg({ ok: false, text: 'ヘルスケアへのアクセスが許可されませんでした。' }); return; }
      const res = await readActivitySummary(7);
      if ('error' in res) { setHealthMsg({ ok: false, text: res.error }); return; }
      setActivity(res);
      if (res.length === 0) setHealthMsg({ ok: true, text: '直近7日のデータが見つかりませんでした。' });
    } finally { setHealthBusy(false); }
  }

  const bmrPreview = mifflinBMR(sex, 70, Number(height) || 0, Number(age) || 0);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Text style={s.h}>設定</Text>

      {/* プロフィール */}
      <View style={s.card}>
        <Text style={s.h2}>👤 プロフィール</Text>
        <Text style={s.label}>アカウント</Text>
        <Text style={s.val}>{email || '—'}</Text>
        <Text style={s.label}>表示名</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="表示名" placeholderTextColor={C.faint} />
        <Text style={s.label}>性別</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['male', '男性'], ['female', '女性']] as const).map(([k, l]) => (
            <Pressable key={k} style={[s.segMini, sex === k && s.segMiniOn]} onPress={() => setSex(k)}>
              <Text style={[s.segMiniT, sex === k && { color: '#fff' }]}>{l}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>身長(cm)</Text>
            <TextInput style={s.input} keyboardType="number-pad" value={height} onChangeText={setHeight} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>年齢</Text>
            <TextInput style={s.input} keyboardType="number-pad" value={age} onChangeText={setAge} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>生活係数</Text>
            <TextInput style={s.input} keyboardType="decimal-pad" value={life} onChangeText={setLife} />
          </View>
        </View>
        <Text style={s.note}>基礎代謝は最新の体重で自動計算されます（体重70kgなら約 {Math.round(bmrPreview)} kcal）</Text>
        <Pressable style={[s.btnPrimary, { marginTop: 12 }]} onPress={saveProfile} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>保存する</Text>}
        </Pressable>
      </View>

      {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}

      {/* ヘルスケア連携（Expo Goでは案内のみ・TestFlight/dev clientで有効） */}
      <View style={s.card}>
        <Text style={s.h2}>⌚ ヘルスケア連携</Text>
        {!healthAvailable() ? (
          <Text style={s.note}>この機能はTestFlight版で有効になります（Expo Goプレビューでは利用できません）。</Text>
        ) : (
          <>
            <Text style={s.note}>Appleヘルスケアから体重を取り込み、歩数・睡眠を確認できます。データは機能提供のみに使用し、広告等には一切使用しません。</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Pressable style={[s.btnGhost, { flex: 1 }]} onPress={healthImportWeights} disabled={healthBusy}>
                {healthBusy ? <ActivityIndicator color={C.ink} /> : <Text style={s.btnGhostT}>⚖️ 体重を取込（90日）</Text>}
              </Pressable>
              <Pressable style={[s.btnGhost, { flex: 1 }]} onPress={healthShowActivity} disabled={healthBusy}>
                <Text style={s.btnGhostT}>👟 歩数・睡眠を見る</Text>
              </Pressable>
            </View>
            {activity && activity.length > 0 && (
              <View style={{ marginTop: 10 }}>
                {activity.map((a) => (
                  <View key={a.date} style={s.actRow}>
                    <Text style={s.actDate}>{a.date.slice(5).replace('-', '/')}</Text>
                    <Text style={s.actVal}>👟 {a.steps.toLocaleString()}歩</Text>
                    <Text style={s.actVal}>😴 {a.sleepH > 0 ? `${a.sleepH}h` : '—'}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
        {healthMsg && <Text style={[s.msg, { color: healthMsg.ok ? C.teal : C.coral, marginTop: 8 }]}>{healthMsg.text}</Text>}
      </View>

      <Text style={s.note}>通知・マイ食品管理・言語切替は現行Web版で設定できます（データ共通）</Text>

      {/* ログアウト */}
      <Pressable style={[s.btnGhost, { marginTop: 16 }]} onPress={() => supabase.auth.signOut()}>
        <Text style={s.btnGhostT}>ログアウト</Text>
      </Pressable>

      {/* アカウント削除（審査必須） */}
      <View style={[s.card, { borderColor: C.coral, marginTop: 24 }]}>
        <Text style={[s.h2, { color: C.coral }]}>⚠️ アカウント削除</Text>
        <Text style={s.note}>アカウントと全データ（記録・写真・目標・マイ食品）を完全に削除します。この操作は取り消せません。</Text>
        <Text style={s.label}>確認のため「削除」と入力</Text>
        <TextInput style={s.input} value={delConfirm} onChangeText={setDelConfirm} placeholder="削除" placeholderTextColor={C.faint} />
        <Pressable style={[s.btnDanger, { marginTop: 12 }, delConfirm !== '削除' && { opacity: 0.4 }]}
                   onPress={confirmDelete} disabled={busy || delConfirm !== '削除'}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>アカウントを完全に削除する</Text>}
        </Pressable>
      </View>
    </ScrollView>
    <StatusBarMask />
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 64, paddingBottom: 40 },
  h: { fontSize: 22, fontWeight: '800', color: C.ink, marginBottom: 12 },
  h2: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 8 },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 16, marginBottom: 12 },
  label: { fontSize: 11, fontWeight: '700', color: C.sub, marginTop: 12, marginBottom: 4 },
  val: { fontSize: 14, color: C.ink, fontWeight: '600' },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 16, color: C.ink },
  segMini: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  segMiniOn: { backgroundColor: C.ink, borderColor: C.ink },
  segMiniT: { fontSize: 13, fontWeight: '700', color: C.sub },
  btnPrimary: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  btnPrimaryT: { color: '#fff', fontSize: 14, fontWeight: '800' },
  btnGhost: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  btnGhostT: { color: C.ink, fontSize: 13, fontWeight: '800' },
  btnDanger: { backgroundColor: C.coral, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  note: { fontSize: 11.5, color: C.sub, lineHeight: 18, marginTop: 4 },
  msg: { fontSize: 13, fontWeight: '600', marginBottom: 8, paddingHorizontal: 4 },
  actRow: { flexDirection: 'row', gap: 12, paddingVertical: 5, borderTopWidth: 0.5, borderTopColor: C.line, alignItems: 'center' },
  actDate: { fontSize: 11.5, color: C.faint, fontWeight: '700', width: 40, fontVariant: ['tabular-nums'] },
  actVal: { fontSize: 12.5, color: C.ink, fontVariant: ['tabular-nums'] },
});
