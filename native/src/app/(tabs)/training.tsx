// トレーニングタブ（Phase 2）: 筋トレ入力・挙上重量の推移・ボリューム判定・履歴。
// Web版 /training の移植（ヘルスケアのワークアウト表示はPhase 3=dev clientビルド後）
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { supabase } from '@/lib/supabase';
import { syncEntriesForDate } from '@/lib/sync';
import { C } from '@/lib/ui';
import { todayJST } from '@/lib/calc';
import { trainingSeries, volumeVerdict } from '@/lib/training';
import SimpleChart from '@/components/SimpleChart';

type TRow = { name: string; kg: string; reps: string; sets: string };
type HistRow = { id: string; date: string; text: string };

export default function TrainingScreen() {
  const [tRows, setTRows] = useState<TRow[]>([{ name: '', kg: '', reps: '', sets: '' }]);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [goalKg, setGoalKg] = useState<Map<string, number>>(new Map());
  const [selEx, setSelEx] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<'kg' | 'volume'>('kg');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const setT = (i: number, patch: Partial<TRow>) => setTRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const load = useCallback(async () => {
    const { data } = await supabase.from('logs').select('id,date,text')
      .like('text', '🏋️%').order('at', { ascending: false }).limit(60);
    setHistory((data as HistRow[]) || []);
    const { data: tg } = await supabase.from('training_goals').select('name,target_kg');
    if (tg) setGoalKg(new Map(tg.map((g: { name: string; target_kg: number }) => [g.name, Number(g.target_kg)])));
  }, []);
  useEffect(() => { load(); }, [load]);

  function trainingText(): string {
    const parts = tRows
      .filter((r) => r.name.trim() && Number(r.kg) > 0 && Number(r.reps) > 0)
      .map((r) => `${r.name.trim()} ${Number(r.kg)}kg×${Number(r.reps)}${Number(r.sets) > 1 ? `×${Number(r.sets)}` : ''}`);
    return parts.length > 0 ? `🏋️ ${parts.join('、')}` : '';
  }

  async function save() {
    const tr = trainingText();
    if (!tr) { setMsg({ ok: false, text: '種目・重量(kg)・回数を入力してください。' }); return; }
    setSaving(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const today = todayJST();
      const { error } = await supabase.from('logs').insert({
        user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
        weight: null, ex: 'オフ', adj: 0, mood: '', text: tr, photo_urls: [],
      });
      if (error) { setMsg({ ok: false, text: '保存に失敗しました。もう一度お試しください。' }); return; }
      await syncEntriesForDate(uid, today);
      setTRows([{ name: '', kg: '', reps: '', sets: '' }]);
      await load();
      setMsg({ ok: true, text: '保存しました。継続が最強の種目です💪' });
    } finally {
      setSaving(false);
    }
  }

  const series = trainingSeries(history);
  const exercises = [...series.entries()].sort((a, b) => b[1].length - a[1].length).map(([n]) => n);
  const activeEx = selEx && series.has(selEx) ? selEx : exercises[0] ?? null;
  const exPoints = activeEx ? series.get(activeEx)! : [];
  const verdict = volumeVerdict(exPoints);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Text style={s.h}>トレーニング</Text>

      {/* 入力 */}
      <View style={s.card}>
        <Text style={s.h2}>🏋️ 今日のトレーニングを記録</Text>
        {tRows.map((r, i) => (
          <View key={i} style={s.tRow}>
            <TextInput style={[s.tIn, { flex: 1 }]} placeholder="種目" placeholderTextColor={C.faint}
                       value={r.name} onChangeText={(v) => setT(i, { name: v })} />
            <TextInput style={[s.tIn, s.tNum]} placeholder="kg" placeholderTextColor={C.faint} keyboardType="decimal-pad"
                       value={r.kg} onChangeText={(v) => setT(i, { kg: v })} />
            <TextInput style={[s.tIn, s.tNum]} placeholder="回" placeholderTextColor={C.faint} keyboardType="number-pad"
                       value={r.reps} onChangeText={(v) => setT(i, { reps: v })} />
            <TextInput style={[s.tIn, s.tNum]} placeholder="set" placeholderTextColor={C.faint} keyboardType="number-pad"
                       value={r.sets} onChangeText={(v) => setT(i, { sets: v })} />
            <Pressable onPress={() => setTRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs))}>
              <Text style={{ color: C.coral, fontSize: 18, fontWeight: '800', padding: 4 }}>×</Text>
            </Pressable>
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Pressable style={[s.btnGhost, { flex: 1 }]} onPress={() => setTRows((rs) => [...rs, { name: '', kg: '', reps: '', sets: '' }])}>
            <Text style={s.btnGhostT}>＋ 種目を追加</Text>
          </Pressable>
          <Pressable style={[s.btnPrimary, { flex: 1 }]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>保存する</Text>}
          </Pressable>
        </View>
        {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
      </View>

      {/* 進捗グラフ */}
      {exercises.length > 0 && (
        <View style={s.card}>
          <Text style={s.h2}>📈 挙上重量の推移</Text>
          <View style={s.chips}>
            {(['kg', 'volume'] as const).map((m) => (
              <Pressable key={m} style={[s.chip, chartMode === m && s.chipOn]} onPress={() => setChartMode(m)}>
                <Text style={[s.chipT, chartMode === m && { color: '#fff' }]}>{m === 'kg' ? '重量(kg)' : 'ボリューム'}</Text>
              </Pressable>
            ))}
          </View>
          <SimpleChart
            points={exPoints.map((p) => ({ date: p.date, value: chartMode === 'kg' ? p.maxKg : p.volume }))}
            unit={chartMode === 'kg' ? 'kg' : 'kg·回'} decimals={0}
            planValue={chartMode === 'kg' && activeEx ? goalKg.get(activeEx) ?? null : null}
          />
          <View style={s.chips}>
            {exercises.map((n) => (
              <Pressable key={n} style={[s.chip, n === activeEx && s.chipOn]} onPress={() => setSelEx(n)}>
                <Text style={[s.chipT, n === activeEx && { color: '#fff' }]}>{n}</Text>
              </Pressable>
            ))}
          </View>
          {verdict && (
            <Text style={[s.verdict, { color: verdict.trend === 'down' ? C.amber : C.teal }]}>
              {verdict.trend === 'up' && `💪 ボリューム上昇中（直近 ${verdict.lastVolume.toLocaleString()}kg·回・平均比 +${verdict.pct}%）`}
              {verdict.trend === 'flat' && `➡️ ボリューム維持（平均比 ${verdict.pct > 0 ? '+' : ''}${verdict.pct}%）。減量中の維持は十分な成果`}
              {verdict.trend === 'down' && `⚠️ ボリューム低下（平均比 ${verdict.pct}%）。赤字が深すぎるサインかも。たんぱく質と睡眠を確認`}
            </Text>
          )}
        </View>
      )}

      {/* 履歴 */}
      <View style={s.card}>
        <Text style={s.h2}>📖 筋トレ履歴</Text>
        {history.length === 0 && <Text style={s.muted}>まだ記録がありません。今日の1セット目から始めましょう。</Text>}
        {history.slice(0, 20).map((h1) => (
          <View key={h1.id} style={s.histRow}>
            <Text style={s.histDate}>{h1.date.slice(5).replace('-', '/')}</Text>
            <Text style={s.histText}>{h1.text.replace(/^🏋️ /, '')}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 64, paddingBottom: 40 },
  h: { fontSize: 22, fontWeight: '800', color: C.ink, marginBottom: 12 },
  h2: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 10 },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 14, marginBottom: 12 },
  tRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 },
  tIn: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, fontSize: 15, color: C.ink },
  tNum: { width: 56, textAlign: 'center' },
  btnPrimary: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  btnPrimaryT: { color: '#fff', fontSize: 13, fontWeight: '800' },
  btnGhost: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  btnGhostT: { color: C.ink, fontSize: 13, fontWeight: '800' },
  msg: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  chips: { flexDirection: 'row', gap: 6, marginVertical: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { fontSize: 12, fontWeight: '700', color: C.sub },
  verdict: { fontSize: 12.5, fontWeight: '600', lineHeight: 19, marginTop: 4 },
  muted: { fontSize: 13, color: C.sub },
  histRow: { flexDirection: 'row', gap: 10, paddingVertical: 7, borderTopWidth: 0.5, borderTopColor: C.line },
  histDate: { fontSize: 11, color: C.faint, fontWeight: '700', width: 40, paddingTop: 2, fontVariant: ['tabular-nums'] },
  histText: { flex: 1, fontSize: 13.5, color: C.ink, lineHeight: 20 },
});
