// 目標パネル（「変化」タブ内のセグメントとして表示）
// 体重目標＋PFC詳細＋チートデイ登録＋筋トレ重量目標 — Web版依存を撤去しアプリ内で完結
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import { todayJST } from '@/lib/calc';
import { progressStatus, PROTEIN_PER_KG_DEFAULT, FAT_PER_KG_DEFAULT, type Goal } from '@/lib/goal';
import { trainingSeries } from '@/lib/training';

type TGoal = { id: string; name: string; target_kg: number; target_date: string | null };
type Ev = { id: string; date: string; title: string; extra_kcal: number };

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function GoalPanel() {
  const [seg, setSeg] = useState<'weight' | 'training'>('weight');
  const [goal, setGoal] = useState<Goal | null>(null);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [initWeight, setInitWeight] = useState<number | null>(null);
  const [gDate, setGDate] = useState('');
  const [gWeight, setGWeight] = useState('');
  const [gProtein, setGProtein] = useState('');
  const [gFat, setGFat] = useState('');
  const [gFatMax, setGFatMax] = useState('');
  const [pfcOpen, setPfcOpen] = useState(false);
  const [events, setEvents] = useState<Ev[]>([]);
  const [evDate, setEvDate] = useState('');
  const [evKcal, setEvKcal] = useState('800');
  const [evPicker, setEvPicker] = useState(false);
  const [tGoals, setTGoals] = useState<TGoal[]>([]);
  const [bests, setBests] = useState<Map<string, number>>(new Map());
  const [tName, setTName] = useState('');
  const [tKg, setTKg] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const [gRes, wRes, tgRes, histRes, profRes, evRes] = await Promise.all([
      supabase.from('goals').select('*').maybeSingle(),
      supabase.from('entries').select('weight').not('weight', 'is', null).order('date', { ascending: false }).limit(1),
      supabase.from('training_goals').select('id,name,target_kg,target_date').order('created_at', { ascending: true }),
      supabase.from('logs').select('date,text').like('text', '🏋️%').order('at', { ascending: false }).limit(200),
      supabase.from('profiles').select('init_weight').eq('id', session.user.id).maybeSingle(),
      supabase.from('events').select('id,date,title,extra_kcal').gte('date', todayJST()).order('date', { ascending: true }),
    ]);
    if (profRes.data?.init_weight != null) setInitWeight(Number(profRes.data.init_weight));
    if (gRes.data) {
      const g = gRes.data as Goal;
      setGoal(g);
      setGDate(g.target_date); setGWeight(String(g.target_weight ?? ''));
      setGProtein(g.protein_per_kg != null ? String(g.protein_per_kg) : '');
      setGFat(g.fat_per_kg != null ? String(g.fat_per_kg) : '');
      setGFatMax(g.fat_max_g != null ? String(g.fat_max_g) : '');
    }
    if (wRes.data?.length) setLatestWeight(Number(wRes.data[0].weight));
    if (!tgRes.error) setTGoals((tgRes.data as TGoal[]) || []);
    setEvents((evRes.data as Ev[]) || []);
    const series = trainingSeries((histRes.data as { date: string; text: string }[]) || []);
    const b = new Map<string, number>();
    for (const [name, pts] of series) b.set(name, Math.max(...pts.map((p) => p.maxKg)));
    setBests(b);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveWeightGoal() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gDate) || !(Number(gWeight) > 20)) {
      setMsg({ ok: false, text: '目標日と目標体重を入力してください。' }); return;
    }
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const start = goal?.start_weight ?? latestWeight ?? initWeight ?? Number(gWeight);
      const base = {
        user_id: uid, target_date: gDate, target_weight: Number(gWeight),
        start_date: goal?.start_date ?? todayJST(), start_weight: start,
        updated_at: new Date().toISOString(),
      };
      // PFC列が無い旧DB環境でも保存できるようフォールバック（Web版と同じ流儀）
      let { error } = await supabase.from('goals').upsert({
        ...base,
        protein_per_kg: gProtein === '' ? null : Number(gProtein) || null,
        fat_per_kg: gFat === '' ? null : Number(gFat) || null,
        fat_max_g: gFatMax === '' ? null : Number(gFatMax) || null,
      });
      if (error && /protein_per_kg|fat_per_kg|fat_max_g|column|schema/.test(error.message)) {
        ({ error } = await supabase.from('goals').upsert(base));
      }
      if (error) { setMsg({ ok: false, text: '保存に失敗しました。もう一度お試しください。' }); return; }
      await load();
      setMsg({ ok: true, text: '目標を保存し、計画を再計算しました。' });
    } finally { setBusy(false); }
  }

  async function addEvent() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(evDate)) { setMsg({ ok: false, text: 'チートデイの日付を選んでください。' }); return; }
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { data, error } = await supabase.from('events')
        .insert({ user_id: uid, date: evDate, title: '🍖 チートデイ', extra_kcal: Number(evKcal) || 800 })
        .select('id,date,title,extra_kcal').single();
      if (error) { setMsg({ ok: false, text: '登録に失敗しました。もう一度お試しください。' }); return; }
      setEvents((prev) => [...prev, data as Ev].sort((a, b) => (a.date < b.date ? -1 : 1)));
      setEvDate('');
      setMsg({ ok: true, text: 'チートデイを登録しました。前後の日で計画が自動的に吸収します。' });
    } finally { setBusy(false); }
  }

  async function removeEvent(id: string) {
    await supabase.from('events').delete().eq('id', id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
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
    <View>
      {/* セグメント切替 */}
      <View style={s.segWrap}>
        {([['weight', '🎯 体重変化'], ['training', '🏋️ 筋トレ重量']] as const).map(([k, l]) => (
          <Pressable key={k} style={[s.seg, seg === k && s.segOn]} onPress={() => { setSeg(k); setMsg(null); }}>
            <Text style={[s.segT, seg === k && { color: '#fff' }]}>{l}</Text>
          </Pressable>
        ))}
      </View>

      {seg === 'weight' && (
        <>
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
          <Text style={s.label}>目標日</Text>
          <Pressable style={s.input} onPress={() => setShowDatePicker((v) => !v)}>
            <Text style={{ fontSize: 16, color: gDate ? C.ink : C.faint }}>{gDate ? gDate.replace(/-/g, '/') : 'タップして選ぶ'}</Text>
          </Pressable>
          {showDatePicker && (
            <DateTimePicker
              value={gDate ? new Date(gDate + 'T00:00:00') : new Date()}
              mode="date" display="inline" minimumDate={new Date()} locale="ja-JP"
              onChange={(_, d) => { if (d) setGDate(fmt(d)); setShowDatePicker(false); }}
            />
          )}
          <Text style={s.label}>目標体重（kg）</Text>
          <TextInput style={s.input} placeholder="82.0" placeholderTextColor={C.faint} keyboardType="decimal-pad" value={gWeight} onChangeText={setGWeight} />

          {/* PFC詳細（折りたたみ） */}
          <Pressable style={{ marginTop: 12 }} onPress={() => setPfcOpen((v) => !v)} hitSlop={6}>
            <Text style={s.pfcToggle}>{pfcOpen ? '▴' : '▾'} PFC詳細設定（任意）</Text>
          </Pressable>
          {pfcOpen && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>P（g/kg）</Text>
                <TextInput style={s.input} placeholder={String(PROTEIN_PER_KG_DEFAULT)} placeholderTextColor={C.faint} keyboardType="decimal-pad" value={gProtein} onChangeText={setGProtein} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>F（g/kg）</Text>
                <TextInput style={s.input} placeholder={String(FAT_PER_KG_DEFAULT)} placeholderTextColor={C.faint} keyboardType="decimal-pad" value={gFat} onChangeText={setGFat} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>F上限（g/日）</Text>
                <TextInput style={s.input} placeholder="なし" placeholderTextColor={C.faint} keyboardType="number-pad" value={gFatMax} onChangeText={setGFatMax} />
              </View>
            </View>
          )}

          <Pressable style={[s.btnPrimary, { marginTop: 14 }]} onPress={saveWeightGoal} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>目標を保存する</Text>}
          </Pressable>
        </View>

        {/* チートデイ */}
        <View style={s.card}>
          <Text style={s.h2}>🍖 チートデイ</Text>
          <Text style={s.note}>登録した日は目標が+設定kcalに緩み、超過分は前後の日で計画が自動吸収します。</Text>
          {events.map((e) => (
            <View key={e.id} style={s.evRow}>
              <Text style={s.evDate}>{e.date.slice(5).replace('-', '/')}</Text>
              <Text style={s.evTitle}>{e.title}</Text>
              <Text style={s.evKcal}>+{Number(e.extra_kcal).toLocaleString()}kcal</Text>
              <Pressable onPress={() => removeEvent(e.id)} hitSlop={6}>
                <Text style={{ color: C.coral, fontWeight: '800', fontSize: 16 }}>×</Text>
              </Pressable>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'flex-end' }}>
            <View style={{ flex: 1.4 }}>
              <Text style={s.label}>日付</Text>
              <Pressable style={s.input} onPress={() => setEvPicker((v) => !v)}>
                <Text style={{ fontSize: 15, color: evDate ? C.ink : C.faint }}>{evDate ? evDate.replace(/-/g, '/') : '選ぶ'}</Text>
              </Pressable>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>+kcal</Text>
              <TextInput style={s.input} keyboardType="number-pad" value={evKcal} onChangeText={setEvKcal} />
            </View>
            <Pressable style={[s.btnGhost, { paddingHorizontal: 16 }]} onPress={addEvent} disabled={busy}>
              <Text style={s.btnGhostT}>追加</Text>
            </Pressable>
          </View>
          {evPicker && (
            <DateTimePicker
              value={evDate ? new Date(evDate + 'T00:00:00') : new Date()}
              mode="date" display="inline" minimumDate={new Date()} locale="ja-JP"
              onChange={(_, d) => { if (d) setEvDate(fmt(d)); setEvPicker(false); }}
            />
          )}
        </View>
        </>
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
    </View>
  );
}

const s = StyleSheet.create({
  segWrap: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  seg: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  segOn: { backgroundColor: C.ink, borderColor: C.ink },
  segT: { fontSize: 13, fontWeight: '800', color: C.sub },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 16, marginBottom: 12 },
  h2: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 6 },
  statusRow: { marginBottom: 14 },
  statusBig: { fontSize: 24, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  statusSub: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  label: { fontSize: 11, fontWeight: '700', color: C.sub, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 16, color: C.ink },
  pfcToggle: { fontSize: 12.5, fontWeight: '800', color: C.sub },
  btnPrimary: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  btnPrimaryT: { color: '#fff', fontSize: 14, fontWeight: '800' },
  btnGhost: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  btnGhostT: { color: C.ink, fontSize: 13, fontWeight: '800' },
  note: { fontSize: 11.5, color: C.sub, lineHeight: 18, marginBottom: 6 },
  evRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 6, borderTopWidth: 0.5, borderTopColor: C.line },
  evDate: { fontSize: 12.5, fontWeight: '800', color: C.ink, width: 44, fontVariant: ['tabular-nums'] },
  evTitle: { flex: 1, fontSize: 13.5, color: C.ink },
  evKcal: { fontSize: 12.5, fontWeight: '700', color: C.sub, fontVariant: ['tabular-nums'] },
  tgRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tgName: { fontSize: 14, fontWeight: '700', color: C.ink },
  tgNum: { fontSize: 12.5, color: C.sub, fontVariant: ['tabular-nums'] },
  bar: { height: 8, backgroundColor: '#eceeeb', borderRadius: 4, marginTop: 5, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: C.teal, borderRadius: 4 },
  msg: { fontSize: 13, fontWeight: '600', paddingHorizontal: 4 },
});
