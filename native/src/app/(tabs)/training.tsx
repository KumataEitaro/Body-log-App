// トレーニングタブ（Phase 2）: 筋トレ入力・挙上重量の推移・ボリューム判定・履歴。
// Web版 /training の移植（ヘルスケアのワークアウト表示はPhase 3=dev clientビルド後）
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { supabase } from '@/lib/supabase';
import { syncEntriesForDate } from '@/lib/sync';
import { C } from '@/lib/ui';
import { todayJST } from '@/lib/calc';
import { ClipboardList, BookOpen, Timer } from 'lucide-react-native';
import StatusBarMask from '@/components/StatusBarMask';
import { useGuideTarget } from '@/components/GuideTour';
import HeaderGear from '@/components/HeaderGear';
import QuickLogFab from '@/components/QuickLogFab';

type TRow = { name: string; kg: string; reps: string; sets: string };
type HistRow = { id: string; date: string; text: string };

export default function TrainingScreen() {
  const [tRows, setTRows] = useState<TRow[]>([{ name: '', kg: '', reps: '', sets: '' }]);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [restLeft, setRestLeft] = useState<number | null>(null); // レストタイマー残秒
  const trainInputTarget = useGuideTarget('trainInput');

  // レストタイマーのカウントダウン
  useEffect(() => {
    if (restLeft == null || restLeft <= 0) return;
    const t = setInterval(() => setRestLeft((v) => (v == null || v <= 1 ? 0 : v - 1)), 1000);
    return () => clearInterval(t);
  }, [restLeft]);

  // 前回参照: 同じ種目の直近記録をテキストから抽出（例: ベンチプレス 80kg×8×3）
  function lastRecordOf(name: string): { text: string; kg: number; date: string } | null {
    if (!name.trim()) return null;
    for (const h1 of history) {
      const re = new RegExp(`${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ([\\d.]+)kg(×\\d+(?:×\\d+)?)?`);
      const m = h1.text.match(re);
      if (m) return { text: `${m[1]}kg${m[2] || ''}`, kg: Number(m[1]), date: h1.date };
    }
    return null;
  }
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const setT = (i: number, patch: Partial<TRow>) => setTRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const load = useCallback(async () => {
    const { data } = await supabase.from('logs').select('id,date,text')
      .like('text', '🏋️%').order('at', { ascending: false }).limit(60);
    setHistory((data as HistRow[]) || []);
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
      setRestLeft(90); // 保存でレストタイマー自動開始
      setMsg({ ok: true, text: '保存しました。継続が最強の種目です💪' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <ScrollView
      style={{ flex: 1 }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Text style={s.h}>トレーニング</Text>

      {/* レストタイマー（保存で自動開始・タップで90秒リスタート） */}
      {restLeft != null && (
        <Pressable style={s.rest} onPress={() => setRestLeft(90)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Timer size={15} color={C.teal} />
            <Text style={s.restL}>レスト</Text>
          </View>
          <Text style={s.restN}>
            {restLeft > 0
              ? `${String(Math.floor(restLeft / 60)).padStart(2, '0')}:${String(restLeft % 60).padStart(2, '0')}`
              : '終了💪'}
          </Text>
          <Text style={s.restHint}>{restLeft > 0 ? 'タップで90秒に戻す' : '次のセットへ！'}</Text>
        </Pressable>
      )}

      {/* 入力 */}
      <View style={s.card} ref={trainInputTarget} collapsable={false}>
        <View style={s.h2Row}><ClipboardList size={14} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>今日のトレーニングを記録</Text></View>
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
        {/* 前回参照: 同種目の直近記録と更新判定 */}
        {(() => {
          const first = tRows.find((r) => r.name.trim());
          if (!first) return null;
          const prev = lastRecordOf(first.name);
          if (!prev) return null;
          const curKg = Number(first.kg);
          const diff = curKg > 0 ? Math.round((curKg - prev.kg) * 10) / 10 : null;
          return (
            <Text style={s.prevRef}>
              前回: {first.name.trim()} {prev.text}（{prev.date.slice(5).replace('-', '/')}）
              {diff != null && diff > 0 && <Text style={{ color: C.teal, fontWeight: '800' }}> → +{diff}kg 更新💪</Text>}
              {diff != null && diff < 0 && <Text style={{ color: C.sub }}> → {diff}kg</Text>}
            </Text>
          );
        })()}
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

      {/* 挙上重量グラフは「変化」タブ→筋トレの成長へ移設（入力と振り返りの役割分離） */}
      {history.length > 0 && (
        <Text style={s.moveNote}>📈 挙上重量の推移グラフは「概要」タブ →「筋トレの成長」で見られます</Text>
      )}

      {/* 履歴 */}
      <View style={s.card}>
        <View style={s.h2Row}><BookOpen size={14} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>筋トレ履歴</Text></View>
        {history.length === 0 && <Text style={s.muted}>まだ記録がありません。今日の1セット目から始めましょう。</Text>}
        {history.slice(0, 20).map((h1) => (
          <View key={h1.id} style={s.histRow}>
            <Text style={s.histDate}>{h1.date.slice(5).replace('-', '/')}</Text>
            <Text style={s.histText}>{h1.text.replace(/^🏋️ /, '')}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
    <QuickLogFab />
    <StatusBarMask />
    <HeaderGear />
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 64, paddingBottom: 40 },
  h: { fontSize: 22, fontWeight: '800', color: C.ink, marginBottom: 12 },
  h2: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 10 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  rest: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#e6f7f2', borderWidth: 1, borderColor: 'rgba(5,150,105,0.3)',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12,
  },
  restL: { fontSize: 12, fontWeight: '800', color: C.ink },
  restN: { fontSize: 20, fontWeight: '900', color: C.teal, fontVariant: ['tabular-nums'] },
  restHint: { fontSize: 10, color: C.sub },
  prevRef: { fontSize: 11.5, color: C.sub, marginTop: 4, lineHeight: 17 },
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
  moveNote: { fontSize: 11.5, color: C.sub, marginBottom: 12, paddingHorizontal: 4, lineHeight: 17 },
  muted: { fontSize: 13, color: C.sub },
  histRow: { flexDirection: 'row', gap: 10, paddingVertical: 7, borderTopWidth: 0.5, borderTopColor: C.line },
  histDate: { fontSize: 11, color: C.faint, fontWeight: '700', width: 40, paddingTop: 2, fontVariant: ['tabular-nums'] },
  histText: { flex: 1, fontSize: 13.5, color: C.ink, lineHeight: 20 },
});
