// 運動タブ: かんたん記録（散歩レベルの日常運動をMETs換算で1タップ記録）＋筋トレ
// 筋トレ勢だけでなくライトユーザーも「今日も動けた」を記録できるようにする
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { supabase } from '@/lib/supabase';
import { syncEntriesForDate } from '@/lib/sync';
import { C } from '@/lib/ui';
import { todayJST } from '@/lib/calc';
import { ClipboardList, BookOpen, Timer, Footprints, Dumbbell } from 'lucide-react-native';
import StatusBarMask from '@/components/StatusBarMask';
import { useGuideTarget, useGuideScroller } from '@/components/GuideTour';
import HeaderGear from '@/components/HeaderGear';
import QuickLogFab from '@/components/QuickLogFab';

type TRow = { name: string; kg: string; reps: string; sets: string };
type HistRow = { id: string; date: string; text: string };

// かんたん記録: METs換算（消費kcal = METs × 体重kg × 時間h × 1.05）
const ACTIVITIES = [
  { e: '🐕', n: '散歩', mets: 3.0 },
  { e: '🚶', n: 'ウォーキング', mets: 3.5 },
  { e: '🏃', n: 'ランニング', mets: 8.0 },
  { e: '🚴', n: '自転車', mets: 6.0 },
  { e: '🧘', n: 'ヨガ・ストレッチ', mets: 2.5 },
  { e: '🏊', n: '水泳', mets: 6.0 },
  { e: '🧹', n: '家事・掃除', mets: 3.3 },
  { e: '⚽', n: 'スポーツ', mets: 7.0 },
] as const;
const MINUTES = [10, 20, 30, 45, 60, 90] as const;

export default function TrainingScreen() {
  const [tRows, setTRows] = useState<TRow[]>([{ name: '', kg: '', reps: '', sets: '' }]);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [restLeft, setRestLeft] = useState<number | null>(null); // レストタイマー残秒
  const trainInputTarget = useGuideTarget('trainInput');
  const trScrollRef = useRef<ScrollView>(null);
  const trY = useRef(0);
  useGuideScroller('/training', useCallback((delta: number) => {
    trScrollRef.current?.scrollTo({ y: Math.max(0, trY.current + delta), animated: true });
  }, []));

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

  // かんたん記録の状態
  const [seg, setSeg] = useState<'easy' | 'lift'>('easy');
  const [actIdx, setActIdx] = useState<number | null>(null);
  const [actMin, setActMin] = useState<number>(30);
  const [actSaving, setActSaving] = useState(false);
  const [myWeight, setMyWeight] = useState<number>(60);
  useEffect(() => {
    supabase.from('entries').select('weight').not('weight', 'is', null)
      .order('date', { ascending: false }).limit(1)
      .then(({ data }) => { if (data?.length) setMyWeight(Number(data[0].weight)); });
  }, []);

  function actKcal(): number {
    if (actIdx == null) return 0;
    return Math.round(ACTIVITIES[actIdx].mets * myWeight * (actMin / 60) * 1.05);
  }

  async function saveActivity() {
    if (actIdx == null) { setMsg({ ok: false, text: '運動の種類を選んでください。' }); return; }
    setActSaving(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const a = ACTIVITIES[actIdx];
      const kcal = actKcal();
      const today = todayJST();
      const { error } = await supabase.from('logs').insert({
        user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
        weight: null, ex: 'オフ', adj: kcal, mood: '',
        text: `🏃 ${a.n} ${actMin}分（約${kcal}kcal消費）`, photo_urls: [],
      });
      if (error) { setMsg({ ok: false, text: '保存に失敗しました。もう一度お試しください。' }); return; }
      await syncEntriesForDate(uid, today);
      setActIdx(null);
      setMsg({ ok: true, text: `${a.n} ${actMin}分を記録しました。今日の目標カロリーに+${kcal}kcal反映されます🎉` });
    } finally { setActSaving(false); }
  }

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
      ref={trScrollRef}
      style={{ flex: 1 }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      onScroll={(e) => { trY.current = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={32}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Text style={s.pageTitle}>運動</Text>

      {/* かんたん記録 ⇄ 筋トレ のセグメント */}
      <View style={s.segWrap}>
        {([['easy', 'かんたん記録', Footprints], ['lift', '筋トレ', Dumbbell]] as const).map(([k, l, Icon]) => (
          <Pressable key={k} style={[s.segBtn, seg === k && s.segBtnOn]} onPress={() => setSeg(k)}>
            <Icon size={14} color={seg === k ? '#fff' : C.sub} />
            <Text style={[s.segBtnT, seg === k && { color: '#fff' }]}>{l}</Text>
          </Pressable>
        ))}
      </View>

      {/* ===== かんたん記録: 散歩レベルでもOK・1タップで消費kcalに反映 ===== */}
      {seg === 'easy' && (
        <View style={s.card} ref={trainInputTarget} collapsable={false}>
          <View style={s.h2Row}><Footprints size={14} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>今日の運動をゆるく記録</Text></View>
          <Text style={s.muted}>犬の散歩でも立派な運動。記録すると今日の目標カロリーに自動反映されます。</Text>
          <View style={s.actGrid}>
            {ACTIVITIES.map((a, i) => (
              <Pressable key={a.n} style={[s.actChip, actIdx === i && s.actChipOn]} onPress={() => setActIdx(i)}>
                <Text style={{ fontSize: 17 }}>{a.e}</Text>
                <Text style={[s.actChipT, actIdx === i && { color: C.teal }]}>{a.n}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[s.muted, { marginTop: 10, marginBottom: 4 }]}>時間</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {MINUTES.map((m) => (
              <Pressable key={m} style={[s.minChip, actMin === m && s.minChipOn]} onPress={() => setActMin(m)}>
                <Text style={[s.minChipT, actMin === m && { color: '#fff' }]}>{m}分</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={[s.btnPrimary, { marginTop: 14 }]} onPress={saveActivity} disabled={actSaving || actIdx == null}>
            {actSaving ? <ActivityIndicator color="#fff" /> : (
              <Text style={s.btnPrimaryT}>
                {actIdx == null ? '運動を選んで記録' : `記録する（約${actKcal()}kcal消費）`}
              </Text>
            )}
          </Pressable>
          {msg && seg === 'easy' && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
        </View>
      )}

      {/* レストタイマー（保存で自動開始・タップで90秒リスタート） */}
      {seg === 'lift' && restLeft != null && (
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
      <View style={[s.card, seg !== 'lift' && { display: 'none' }]}>
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
        {msg && seg === 'lift' && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
      </View>

      {/* 挙上重量グラフは「変化」タブ→筋トレの成長へ移設（入力と振り返りの役割分離） */}
      {seg === 'lift' && history.length > 0 && (
        <Text style={s.moveNote}>📈 挙上重量の推移グラフは「概要」タブ →「筋トレの成長」で見られます</Text>
      )}

      {/* 履歴 */}
      <View style={[s.card, seg !== 'lift' && { display: 'none' }]}>
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
  pageTitle: { fontSize: 21, fontWeight: '600', color: C.ink, marginBottom: 12 },
  segWrap: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  segBtn: {
    flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999,
    paddingVertical: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  segBtnOn: { backgroundColor: C.teal, borderColor: C.teal },
  segBtnT: { fontSize: 13, fontWeight: '800', color: C.sub },
  actGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  actChip: {
    width: '23%', backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.line, borderRadius: 14,
    paddingVertical: 10, alignItems: 'center', gap: 3,
  },
  actChipOn: { borderColor: C.teal, backgroundColor: '#f2faf7' },
  actChipT: { fontSize: 10, fontWeight: '700', color: C.sub, textAlign: 'center' },
  minChip: { backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  minChipOn: { backgroundColor: C.ink, borderColor: C.ink },
  minChipT: { fontSize: 12.5, fontWeight: '800', color: C.sub },
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
