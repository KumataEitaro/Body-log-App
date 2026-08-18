// 運動タブ: かんたん記録（散歩レベルの日常運動をMETs換算で1タップ記録）＋筋トレ
// 筋トレ勢だけでなくライトユーザーも「今日も動けた」を記録できるようにする
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, Modal } from 'react-native';
import { healthAvailable, requestHealthAuth, listWorkouts, importWorkouts, type HKWorkout } from '@/lib/health';
import { supabase } from '@/lib/supabase';
import { syncEntriesForDate } from '@/lib/sync';
import { C } from '@/lib/ui';
import { todayJST } from '@/lib/calc';
import { ClipboardList, BookOpen, Timer, Footprints, Dumbbell } from 'lucide-react-native';
import StatusBarMask from '@/components/StatusBarMask';
import { useGuideTarget, useGuideScroller } from '@/components/GuideTour';
import HeaderGear from '@/components/HeaderGear';
import QuickLogFab from '@/components/QuickLogFab';
import DateStrip from '@/components/DateStrip';
import { SegmentedControl, Chip, OptionButton, SEL } from '@/components/ui/Selectable';
import { epley1RM, parse1RMs, repsNeededFor } from '@/lib/rm';

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

  // 記録先の日付（既定=今日。過去日にも記録できる）
  const [viewDate, setViewDate] = useState(todayJST());

  // かんたん記録の状態
  const [seg, setSeg] = useState<'easy' | 'lift'>('easy');
  const [actIdx, setActIdx] = useState<number | null>(null);
  const [actMin, setActMin] = useState<number>(30);
  const [actKm, setActKm] = useState(''); // 距離（km・徒歩/ラン/自転車のみ任意入力）
  const [actSaving, setActSaving] = useState(false);
  const [myWeight, setMyWeight] = useState<number>(60);
  useEffect(() => {
    supabase.from('entries').select('weight').not('weight', 'is', null)
      .order('date', { ascending: false }).limit(1)
      .then(({ data }) => { if (data?.length) setMyWeight(Number(data[0].weight)); });
  }, []);

  // ヘルスケア取込モード（Apple Watch等のワークアウトを一括登録）
  const [hkOpen, setHkOpen] = useState(false);
  const [hkList, setHkList] = useState<HKWorkout[]>([]);
  const [hkSel, setHkSel] = useState<Set<string>>(new Set());
  const [hkBusy, setHkBusy] = useState(false);
  const [hkMsg, setHkMsg] = useState('');
  async function openHk() {
    if (!healthAvailable()) { setMsg({ ok: false, text: 'ヘルスケア取込はTestFlight版でのみ使えます（Expo Goでは動きません）。' }); return; }
    setHkOpen(true); setHkBusy(true); setHkMsg(''); setHkList([]);
    try {
      if (!(await requestHealthAuth())) { setHkMsg('ヘルスケアへのアクセスが許可されませんでした。iOSの設定 > プライバシー > ヘルスケア から許可できます。'); return; }
      const r = await listWorkouts(30);
      if ('error' in r) { setHkMsg(r.error); return; }
      setHkList(r);
      setHkSel(new Set(r.map((w) => w.id)));
      if (r.length === 0) setHkMsg('直近30日のワークアウトが見つかりませんでした。');
    } finally { setHkBusy(false); }
  }
  async function importSelected() {
    const items = hkList.filter((w) => hkSel.has(w.id));
    if (items.length === 0) return;
    setHkBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const r = await importWorkouts(uid, items);
      if ('error' in r) { setHkMsg(r.error); return; }
      setHkOpen(false);
      setMsg({ ok: true, text: `⌚ ${r.imported}件を取り込みました${r.skipped > 0 ? `（${r.skipped}件は取込済みでスキップ）` : ''}。消費kcalが目標カロリーに反映されます。` });
    } finally { setHkBusy(false); }
  }

  const DIST_OK = ['散歩', 'ウォーキング', 'ランニング', '自転車'];
  function actKcal(): number {
    if (actIdx == null) return 0;
    const a = ACTIVITIES[actIdx];
    const km = Number(actKm);
    // 距離が入っていれば距離ベースの推定に切替（精度が上がる）
    if (km > 0 && DIST_OK.includes(a.n)) {
      const perKgKm = a.n === 'ランニング' ? 1.05 : a.n === '自転車' ? 0.35 : 0.55;
      return Math.round(perKgKm * myWeight * km);
    }
    return Math.round(a.mets * myWeight * (actMin / 60) * 1.05);
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
      const km = Number(actKm) > 0 && DIST_OK.includes(a.n) ? Number(actKm) : null;
      const today = viewDate;
      const base = {
        user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
        weight: null, ex: 'オフ', adj: kcal, mood: '',
        text: `🏃 ${a.n} ${actMin}分${km ? ` ${km}km` : ''}（約${kcal}kcal消費）`, photo_urls: [],
      };
      // v17列（ex_minutes/ex_km）が無い旧DBでも保存できるようフォールバック
      let { error } = await supabase.from('logs').insert({ ...base, ex_minutes: actMin, ex_km: km });
      if (error && /ex_minutes|ex_km|column|schema/i.test(error.message)) {
        ({ error } = await supabase.from('logs').insert(base));
      }
      if (error) { setMsg({ ok: false, text: '保存に失敗しました。もう一度お試しください。' }); return; }
      await syncEntriesForDate(uid, today);
      setActIdx(null); setActKm('');
      setMsg({ ok: true, text: `${a.n} ${actMin}分${km ? ` ${km}km` : ''}を記録しました。目標カロリーに+${kcal}kcal反映されます🎉` });
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
      const today = viewDate;
      const { error } = await supabase.from('logs').insert({
        user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
        weight: null, ex: 'オフ', adj: 0, mood: '', text: tr, photo_urls: [],
      });
      if (error) { setMsg({ ok: false, text: '保存に失敗しました。もう一度お試しください。' }); return; }
      await syncEntriesForDate(uid, today);

      // RMフィードバック: 推定1RM(Epley)を目標・自己ベストと照合して一言返す
      let fb = '保存しました。継続が最強の種目です💪';
      try {
        const first = tRows.find((r) => r.name.trim() && Number(r.kg) > 0 && Number(r.reps) > 0);
        if (first) {
          const name = first.name.trim();
          const est = Math.round(epley1RM(Number(first.kg), Number(first.reps)));
          let bestPast = 0; // 保存前の履歴から同種目の過去最高1RM
          for (const h1 of history) for (const p of parse1RMs(h1.text)) {
            if (p.name === name) bestPast = Math.max(bestPast, Math.round(p.est));
          }
          const { data: tg } = await supabase.from('training_goals').select('target_kg').eq('name', name).maybeSingle();
          const goalKg = tg ? Math.round(Number(tg.target_kg)) : null;
          if (goalKg && est >= goalKg) {
            fb = `🎉 目標達成！${name} 推定MAX ${est}kg（目標${goalKg}kg超え）。次の目標を設定しよう`;
          } else if (goalKg) {
            const need = repsNeededFor(goalKg, Number(first.kg));
            fb = `おしい！RM換算だとMAX ${est}kg。目標${goalKg}kgまであと${goalKg - est}kg${need && need > Number(first.reps) ? `（${Number(first.kg)}kgなら${need}回で到達）` : ''}`;
          } else if (bestPast > 0 && est > bestPast) {
            fb = `自己ベスト更新💪 ${name} 推定MAX ${est}kg（前回比 +${est - bestPast}kg）`;
          } else {
            fb = `保存しました。${name} 推定MAX ${est}kg（RM換算）`;
          }
        }
      } catch { /* フィードバックが取れなくても保存は成功している */ }

      setTRows([{ name: '', kg: '', reps: '', sets: '' }]);
      await load();
      setRestLeft(90); // 保存でレストタイマー自動開始
      setMsg({ ok: true, text: fb });
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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginRight: 38 }}>
        <Text style={[s.pageTitle, { marginBottom: 0 }]}>運動</Text>
        <DateStrip value={viewDate} onChange={setViewDate} />
      </View>

      {/* かんたん記録 ⇄ 筋トレ のセグメント */}
      <View style={{ marginBottom: 14 }}>
        <SegmentedControl
          options={[
            { key: 'easy', label: 'かんたん記録', icon: <Footprints size={14} color={C.sub} /> },
            { key: 'lift', label: '筋トレ', icon: <Dumbbell size={14} color={C.sub} /> },
          ]}
          value={seg} onChange={setSeg}
        />
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
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {MINUTES.map((m) => (
              <Chip key={m} label={`${m}分`} tone="ink" selected={actMin === m} onPress={() => setActMin(m)} />
            ))}
            <TextInput style={s.freeMin} placeholder="分" placeholderTextColor={C.faint} keyboardType="number-pad"
                       value={MINUTES.includes(actMin as typeof MINUTES[number]) ? '' : String(actMin)}
                       onChangeText={(v) => { const n = Number(v); if (n > 0) setActMin(n); }} />
          </View>
          {actIdx != null && DIST_OK.includes(ACTIVITIES[actIdx].n) && (
            <>
              <Text style={[s.muted, { marginTop: 10, marginBottom: 4 }]}>距離（km・任意。入れると消費kcalの精度が上がります）</Text>
              <TextInput style={[s.freeMin, { width: 110 }]} placeholder="5.0" placeholderTextColor={C.faint}
                         keyboardType="decimal-pad" value={actKm} onChangeText={setActKm} />
            </>
          )}
          <OptionButton
            style={{ marginTop: 14 }}
            label={actIdx == null ? '運動を選んで記録' : `記録する（約${actKcal()}kcal消費）`}
            onPress={saveActivity} busy={actSaving} disabled={actIdx == null}
          />
          <OptionButton style={{ marginTop: 8 }} variant="tonal" label="⌚ ヘルスケアから取り込む（Apple Watch等）" onPress={openHk} />
          {msg && seg === 'easy' && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
        </View>
      )}

      {/* ===== ヘルスケア取込モーダル ===== */}
      <Modal visible={hkOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setHkOpen(false)}>
        <View style={s.hkWrap}>
          <View style={s.hkHead}>
            <Text style={s.hkTitle}>⌚ ヘルスケアから取り込む</Text>
            <Pressable onPress={() => setHkOpen(false)} hitSlop={10}><Text style={s.hkClose}>×</Text></Pressable>
          </View>
          <Text style={s.hkSub}>直近30日のワークアウト。タップで取込対象を選べます（取込済みは自動でスキップ）。</Text>
          {hkBusy && hkList.length === 0 && <ActivityIndicator color={C.teal} style={{ marginTop: 30 }} />}
          {hkMsg !== '' && <Text style={s.hkMsg}>{hkMsg}</Text>}
          <ScrollView style={{ flex: 1, marginTop: 8 }}>
            {hkList.map((w) => {
              const on = hkSel.has(w.id);
              return (
                <Pressable key={w.id} style={[s.hkRow, !on && { opacity: 0.4 }]}
                           onPress={() => setHkSel((prev) => { const n = new Set(prev); if (n.has(w.id)) n.delete(w.id); else n.add(w.id); return n; })}>
                  <Text style={s.hkCheck}>{on ? '☑' : '☐'}</Text>
                  <Text style={s.hkDate}>{w.date.slice(5).replace('-', '/')}</Text>
                  <Text style={s.hkName} numberOfLines={1}>{w.name}</Text>
                  <Text style={s.hkMeta}>{w.minutes}分{w.km ? ` ${w.km}km` : ''} ・ {w.kcal}kcal</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {hkList.length > 0 && (
            <OptionButton variant="teal" label={`選択した${[...hkSel].length}件を取り込む`}
                          onPress={importSelected} busy={hkBusy} disabled={hkSel.size === 0} />
          )}
        </View>
      </Modal>

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
          <OptionButton style={{ flex: 1 }} variant="tonal" label="＋ 種目を追加"
                        onPress={() => setTRows((rs) => [...rs, { name: '', kg: '', reps: '', sets: '' }])} />
          <OptionButton style={{ flex: 1 }} label="保存する" onPress={save} busy={saving} />
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
    width: '23%', backgroundColor: SEL.chipBg, borderWidth: 1.5, borderColor: C.line, borderRadius: 16,
    paddingVertical: 10, alignItems: 'center', gap: 3,
  },
  actChipOn: { borderColor: C.teal, backgroundColor: SEL.tealSoft },
  actChipT: { fontSize: 10, fontWeight: '700', color: C.sub, textAlign: 'center' },
  hkWrap: { flex: 1, backgroundColor: C.bg, padding: 16, paddingTop: 18 },
  hkHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hkTitle: { fontSize: 17, fontWeight: '800', color: C.ink },
  hkClose: { fontSize: 24, color: C.sub, fontWeight: '600', paddingHorizontal: 6 },
  hkSub: { fontSize: 11.5, color: C.sub, marginTop: 6, lineHeight: 17 },
  hkMsg: { fontSize: 12.5, fontWeight: '600', color: C.sub, marginTop: 16, textAlign: 'center' },
  hkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: C.line },
  hkCheck: { fontSize: 16, color: C.teal },
  hkDate: { width: 44, fontSize: 11.5, color: C.sub, fontVariant: ['tabular-nums'] },
  hkName: { flex: 1, fontSize: 13.5, fontWeight: '700', color: C.ink },
  hkMeta: { fontSize: 11.5, color: C.sub, fontVariant: ['tabular-nums'] },
  freeMin: {
    width: 72, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 12.5, color: C.ink, textAlign: 'center',
  },
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
