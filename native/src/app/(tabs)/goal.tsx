// 目標タブ（Phase 3）: 体重変化の目標＋筋トレ重量の目標（セグメント切替）
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import { todayJST } from '@/lib/calc';
import { progressStatus, type Goal } from '@/lib/goal';
import { trainingSeries } from '@/lib/training';

type TGoal = { id: string; name: string; target_kg: number; target_date: string | null };

export default function GoalScreen() {
  const [seg, setSeg] = useState<'weight' | 'training'>('weight');
  const [goal, setGoal] = useState<Goal | null>(null);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [initWeight, setInitWeight] = useState<number | null>(null);
  const [gDate, setGDate] = useState('');
  const [gWeight, setGWeight] = useState('');
  const [tGoals, setTGoals] = useState<TGoal[]>([]);
  const [bests, setBests] = useState<Map<string, number>>(new Map());
  const [tName, setTName] = useState('');
  const [tKg, setTKg] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const [gRes, wRes, tgRes, histRes, profRes] = await Promise.all([
      supabase.from('goals').select('*').maybeSingle(),
      supabase.from('entries').select('weight').not('weight', 'is', null).order('date', { ascending: false }).limit(1),
      supabase.from('training_goals').select('id,name,target_kg,target_date').order('created_at', { ascending: true }),
      supabase.from('logs').select('date,text').like('text', '🏋️%').order('at', { ascending: false }).limit(200),
      supabase.from('profiles').select('init_weight').eq('id', session.user.id).maybeSingle(),
    ]);
    if (profRes.data?.init_weight != null) setInitWeight(Number(profRes.data.init_weight));
    if (gRes.data) {
      const g = gRes.data as Goal;
      setGoal(g);
      setGDate(g.target_date); setGWeight(String(g.target_weight ?? ''));
    }
    if (wRes.data?.length) setLatestWeight(Number(wRes.data[0].weight));
    if (!tgRes.error) setTGoals((tgRes.data as TGoal[]) || []);
    const series = trainingSeries((histRes.data as { date: string; text: string }[]) || []);
    const b = new Map<string, number>();
    for (const [name, pts] of series) b.set(name, Math.max(...pts.map((p) => p.maxKg)));
    setBests(b);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveWeightGoal() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gDate) || !(Number(gWeight) > 20)) {
      setMsg({ ok: false, text: '目標日(YYYY-MM-DD)と目標体重を入力してください。' }); return;
    }
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      // Web版と同じ優先順: 既存goal→最新実測→onboarding時の初期体重（目標値へのフォールバックは進捗計算を無意味にするため避ける）
      const start = goal?.start_weight ?? latestWeight ?? initWeight ?? Number(gWeight);
      const { error } = await supabase.from('goals').upsert({
        user_id: uid, target_date: gDate, target_weight: Number(gWeight),
        start_date: goal?.start_date ?? todayJST(), start_weight: start,
        updated_at: new Date().toISOString(),
      });
      if (error) { setMsg({ ok: false, text: '保存に失敗しました。もう一度お試しください。' }); return; }
      await load();
      setMsg({ ok: true, text: '目標を保存し、計画を再計算しました。' });
    } finally { setBusy(false); }
  }

  async function addTrainingGoal() {
    const name = tName.trim(); const kg = Number(tKg);
    if (!name || !(kg > 0)) { setMsg({ ok: false, text: '種目名と目標重量(kg)を入力してください。' }); return; }
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { error } = await supabase.from('training_goals')
        .upsert({ user_id: uid, name, target_kg: kg }, { onConflict: 'user_id,name' });
      if (error) {
        setMsg({ ok: false, text: /does not exist|schema/i.test(error.message) ? 'DBの初回セットアップが未完了です（apply-pending.sqlの実行が必要）。' : '保存に失敗しました。' });
        return;
      }
      setTName(''); setTKg('');
      await load();
      setMsg({ ok: true, text: `「${name} ${kg}kg」を目標に設定しました。トレタブのグラフに目標線が出ます。` });
    } finally { setBusy(false); }
  }

  async function removeTrainingGoal(id: string) {
    await supabase.from('training_goals').delete().eq('id', id);
    setTGoals((prev) => prev.filter((g) => g.id !== id));
  }

  const status = goal && latestWeight != null ? progressStatus(goal, todayJST(), latestWeight) : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Text style={s.h}>目標</Text>

      {/* セグメント切替 */}
      <View style={s.segWrap}>
        {([['weight', '🎯 体重変化'], ['training', '🏋️ 筋トレ重量']] as const).map(([k, l]) => (
          <Pressable key={k} style={[s.seg, seg === k && s.segOn]} onPress={() => { setSeg(k); setMsg(null); }}>
            <Text style={[s.segT, seg === k && { color: '#fff' }]}>{l}</Text>
          </Pressable>
        ))}
      </View>

      {seg === 'weight' && (
        <View style={s.card}>
          {goal && latestWeight != null && (
            <View style={s.statusRow}>
              <Text style={s.statusBig}>{latestWeight.toFixed(1)} → {Number(goal.target_weight).toFixed(1)}kg</Text>
              {status && (
                <Text style={[s.statusSub, { color: status.state === 'behind' ? C.coral : C.teal }]}>
                  {status.state === 'ahead' ? `${Math.abs(status.diffDays)}日先行 🎉` : status.state === 'behind' ? `${Math.abs(status.diffDays)}日遅れ` : '順調 👍'}
                  ・あと{Math.abs(latestWeight - Number(goal.target_weight)).toFixed(1)}kg
                </Text>
              )}
            </View>
          )}
          <Text style={s.label}>目標日（YYYY-MM-DD）</Text>
          <TextInput style={s.input} placeholder="2026-12-31" placeholderTextColor={C.faint} value={gDate} onChangeText={setGDate} autoCapitalize="none" />
          <Text style={s.label}>目標体重（kg）</Text>
          <TextInput style={s.input} placeholder="82.0" placeholderTextColor={C.faint} keyboardType="decimal-pad" value={gWeight} onChangeText={setGWeight} />
          <Pressable style={[s.btnPrimary, { marginTop: 12 }]} onPress={saveWeightGoal} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>目標を保存する</Text>}
          </Pressable>
          <Text style={s.note}>PFC詳細設定・チートデイ登録はPhase 3bで移植予定（現行アプリで設定可・データ共通）</Text>
        </View>
      )}

      {seg === 'training' && (
        <View style={s.card}>
          {tGoals.length === 0 && <Text style={s.note}>まだ目標がありません。種目と目標重量を追加しましょう。</Text>}
          {tGoals.map((tg) => {
            const best = bests.get(tg.name) ?? 0;
            const pct = Math.min(100, Math.round((best / Number(tg.target_kg)) * 100));
            return (
              <View key={tg.id} style={{ marginBottom: 12 }}>
                <View style={s.tgRow}>
                  <Text style={s.tgName}>{tg.name}{pct >= 100 && ' 🎉'}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={s.tgNum}>{best > 0 ? best : '—'} / {Number(tg.target_kg)}kg（{pct}%）</Text>
                    <Pressable onPress={() => removeTrainingGoal(tg.id)}>
                      <Text style={{ color: C.coral, fontWeight: '800', fontSize: 16, padding: 2 }}>×</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` }]} /></View>
              </View>
            );
          })}
          <Text style={s.label}>種目名</Text>
          <TextInput style={s.input} placeholder="ベンチプレス" placeholderTextColor={C.faint} value={tName} onChangeText={setTName} />
          <Text style={s.label}>目標重量（kg）</Text>
          <TextInput style={s.input} placeholder="100" placeholderTextColor={C.faint} keyboardType="decimal-pad" value={tKg} onChangeText={setTKg} />
          <Pressable style={[s.btnPrimary, { marginTop: 12 }]} onPress={addTrainingGoal} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>目標を追加する</Text>}
          </Pressable>
        </View>
      )}

      {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 64, paddingBottom: 40 },
  h: { fontSize: 22, fontWeight: '800', color: C.ink, marginBottom: 12 },
  segWrap: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  seg: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  segOn: { backgroundColor: C.ink, borderColor: C.ink },
  segT: { fontSize: 13, fontWeight: '800', color: C.sub },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 16, marginBottom: 12 },
  statusRow: { marginBottom: 14 },
  statusBig: { fontSize: 24, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  statusSub: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  label: { fontSize: 11, fontWeight: '700', color: C.sub, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 16, color: C.ink },
  btnPrimary: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  btnPrimaryT: { color: '#fff', fontSize: 14, fontWeight: '800' },
  note: { fontSize: 11.5, color: C.sub, lineHeight: 18, marginTop: 10 },
  tgRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tgName: { fontSize: 14, fontWeight: '700', color: C.ink },
  tgNum: { fontSize: 12.5, color: C.sub, fontVariant: ['tabular-nums'] },
  bar: { height: 8, backgroundColor: '#eceeeb', borderRadius: 4, marginTop: 5, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: C.teal, borderRadius: 4 },
  msg: { fontSize: 13, fontWeight: '600', paddingHorizontal: 4 },
});
