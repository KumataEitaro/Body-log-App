// 食事タブ（Phase 1コア）: ヒーロー・今日のフィード・AI解析コンポーザー・マイ食品チップ・体重クイック入力
// ロジックはWeb版のlib/*をそのまま移植して使用（データ・計算式は完全互換）
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { apiPost } from '@/lib/api';
import { syncEntriesForDate } from '@/lib/sync';
import { C } from '@/lib/ui';
import { mifflinBMR, EX_ADD, todayJST, type ExLevel } from '@/lib/calc';
import { assessBingeRisk, type BingeRisk, type InsightDay } from '@/lib/insights';
import { detectStruggle } from '@/lib/adaptive';
import { summarizeDay, dayExerciseKcal, type LogRow } from '@/lib/day';
import { sumItems, type FoodItem } from '@/lib/items';
import { addServing, removeServing, servingCount, type MyFoodRow } from '@/lib/foods';
import { computePlan, macroTargets, type Goal, type PlanEvent } from '@/lib/goal';

type Profile = { sex: 'male' | 'female'; height_cm: number; age: number; init_weight: number | null; life_factor: number; display_name: string };
type MyFood = MyFoodRow & { id: string };
type DayLog = LogRow & { id: string; at: string };
type Parsed = { items: FoodItem[]; weight: number | null; waist: number | null; ex: ExLevel | null; adj: number; mood: string | null };

function timeJST(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function shiftDate(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function LogScreen() {
  const [uid, setUid] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [events, setEvents] = useState<(PlanEvent & { id: string })[]>([]);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [myFoods, setMyFoods] = useState<MyFood[]>([]);
  const [dayLogs, setDayLogs] = useState<DayLog[]>([]);
  const [chat, setChat] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [wWeight, setWWeight] = useState('');

  const today = todayJST();

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;
    setUid(userId);
    const [profRes, goalRes, evRes, wRes, foodRes, logRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('goals').select('*').maybeSingle(),
      supabase.from('events').select('id,date,title,extra_kcal').order('date', { ascending: true }),
      supabase.from('entries').select('weight,date').not('weight', 'is', null).order('date', { ascending: false }).limit(1),
      supabase.from('my_foods').select('id,name,kind,unit,kcal,p,f,c,serving_label,serving_ratio').order('created_at', { ascending: true }).limit(30),
      supabase.from('logs').select('*').eq('date', todayJST()).order('at', { ascending: true }),
    ]);
    if (profRes.data) setProfile(profRes.data as Profile);
    if (goalRes.data) setGoal(goalRes.data as Goal);
    setEvents((evRes.data as (PlanEvent & { id: string })[]) || []);
    if (wRes.data?.length) setLatestWeight(Number(wRes.data[0].weight));
    setMyFoods((foodRes.data as MyFood[]) || []);
    setDayLogs((logRes.data as DayLog[]) || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ===== 目安・ヒーロー計算（Web版と同一ロジック） =====
  const summary = summarizeDay(dayLogs);
  const weightForBmr = summary.weight ?? latestWeight ?? (profile?.init_weight != null ? Number(profile.init_weight) : 70);
  const bmr = profile ? mifflinBMR(profile.sex, weightForBmr, Number(profile.height_cm), Number(profile.age)) : 0;
  const target = profile ? Math.round(bmr * Number(profile.life_factor)) + Math.round(dayExerciseKcal(dayLogs)) : 0;
  const plan = goal && profile ? computePlan(goal, today, weightForBmr, events, goal.absorb_days) : null;
  const todayEvent = events.find((e) => e.date === today) ?? null;
  const planIntakeBase = plan ? Math.max(target - plan.requiredDailyWithEvents, Math.round(bmr)) : null;
  const planIntake = planIntakeBase != null && todayEvent ? planIntakeBase + Math.round(Number(todayEvent.extra_kcal)) : planIntakeBase;
  const goalKcal = planIntake ?? target;
  const eaten = Math.round(summary.intake ?? 0);
  const left = goalKcal - eaten;
  const macros = profile ? macroTargets(weightForBmr, goalKcal, goal?.protein_per_kg, goal?.fat_per_kg, goal?.fat_max_g) : null;
  const eatenP = Math.round(summary.p ?? 0);

  // ===== AI解析（チップ追加分は保持して追記マージ＝Web版と同じ） =====
  async function parse() {
    if (!chat.trim()) { setMsg({ ok: false, text: 'メモを書いてください（写真対応はPhase 2）。' }); return; }
    setAnalyzing(true); setMsg(null);
    try {
      const { ok, json } = await apiPost<{ ok: boolean; error?: string; result?: { items?: FoodItem[]; weight?: number; waist?: number; ex?: string; adj?: number; mood?: string } }>(
        '/api/parse-food', { text: chat, lang: 'ja' });
      if (!ok || !json?.ok || !json.result) { setMsg({ ok: false, text: json?.error || '解析に失敗しました。もう一度お試しください。' }); return; }
      const base = parsed?.items ?? [];
      const items = [...base, ...(json.result.items || [])];
      setParsed({
        items,
        weight: json.result.weight ?? parsed?.weight ?? null,
        waist: json.result.waist ?? parsed?.waist ?? null,
        ex: (json.result.ex as ExLevel) ?? parsed?.ex ?? null,
        adj: Number(json.result.adj) || parsed?.adj || 0,
        mood: json.result.mood ?? parsed?.mood ?? null,
      });
    } catch {
      setMsg({ ok: false, text: '通信に失敗しました。電波状況を確認してください。' });
    } finally {
      setAnalyzing(false);
    }
  }

  function tapFood(fd: MyFood) {
    const items = addServing(parsed?.items ?? [], fd);
    setParsed((p) => ({ items, weight: p?.weight ?? null, waist: p?.waist ?? null, ex: p?.ex ?? null, adj: p?.adj ?? 0, mood: p?.mood ?? null }));
  }
  function decFood(fd: MyFood) {
    if (!parsed) return;
    const items = removeServing(parsed.items, fd);
    if (items.length === 0 && parsed.weight == null && !parsed.ex) setParsed(null);
    else setParsed({ ...parsed, items });
  }

  async function save() {
    if (!uid || !parsed) return;
    setSaving(true); setMsg(null);
    try {
      const total = sumItems(parsed.items);
      const hasMeal = parsed.items.length > 0;
      const { error } = await supabase.from('logs').insert({
        user_id: uid, date: today,
        items: parsed.items,
        kcal: hasMeal ? total.kcal : null,
        p: hasMeal ? total.p : null, f: hasMeal ? total.f : null, c: hasMeal ? total.c : null,
        weight: parsed.weight, waist: parsed.waist,
        ex: parsed.ex ?? 'オフ', adj: parsed.adj, mood: parsed.mood || '', text: chat, photo_urls: [],
      });
      if (error) { setMsg({ ok: false, text: '保存に失敗しました。もう一度お試しください。' }); return; }
      await syncEntriesForDate(uid, today);
      setChat(''); setParsed(null);
      await load();
      setMsg({ ok: true, text: '保存しました。' });
    } finally {
      setSaving(false);
    }
  }

  async function saveWeight() {
    const w = Number(wWeight);
    if (!uid || !(w > 20 && w < 300)) { setMsg({ ok: false, text: '体重は20〜300kgで入力してください。' }); return; }
    setSaving(true);
    try {
      await supabase.from('logs').insert({
        user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
        weight: Math.round(w * 10) / 10, ex: 'オフ', adj: 0, mood: '', text: '', photo_urls: [],
      });
      await syncEntriesForDate(uid, today);
      setWWeight('');
      await load();
      setMsg({ ok: true, text: `体重 ${w.toFixed(1)}kg を記録しました。` });
    } finally {
      setSaving(false);
    }
  }

  // ===== 過食リスクの事前検知（Web版と同一ロジック・AsyncStorageで今日1回スヌーズ） =====
  const [bingeRisk, setBingeRisk] = useState<BingeRisk | null>(null);
  useEffect(() => {
    if (!profile) return;
    (async () => {
      try {
        if (await AsyncStorage.getItem('bl-risk-snooze') === todayJST()) return;
        const t = todayJST();
        const { data } = await supabase.from('entries')
          .select('date,intake,p,ex,adj,mood,food_text')
          .gte('date', shiftDate(t, -28)).lt('date', t)
          .order('date', { ascending: true });
        if (!data || data.length < 5) return; // データが薄いうちは主張しない
        const base = Math.round(mifflinBMR(profile.sex, weightForBmr, Number(profile.height_cm), Number(profile.age)) * Number(profile.life_factor));
        const days: InsightDay[] = data.map((r) => {
          const dayTarget = base + (EX_ADD[(r.ex as ExLevel) || 'オフ'] ?? 0) + (Number(r.adj) || 0);
          const intake = r.intake == null ? null : Number(r.intake);
          return {
            date: String(r.date), intake,
            p: r.p == null ? null : Number(r.p),
            diff: intake == null ? null : Math.round(intake - dayTarget),
            mood: r.mood as string | null, text: r.food_text as string | null,
          };
        });
        const risk = assessBingeRisk(days, new Date(t + 'T00:00:00').getDay());
        if (risk.level !== 'low') setBingeRisk(risk);
      } catch { /* ベストエフォート */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  async function snoozeRisk() {
    try { await AsyncStorage.setItem('bl-risk-snooze', todayJST()); } catch { /* 無視 */ }
    setBingeRisk(null);
  }

  // 1タップ予防: 今日だけ目標を+200kcal緩める（チートデイ吸収の仕組みに乗せる）
  async function addRecoveryEvent() {
    if (!uid) return;
    const { data: ev, error } = await supabase.from('events')
      .insert({ user_id: uid, date: today, title: '🕊 リカバリー枠', extra_kcal: 200 })
      .select('id,date,title,extra_kcal').single();
    if (error) { setMsg({ ok: false, text: '設定に失敗しました。もう一度お試しください。' }); return; }
    setEvents((prev) => [...prev, ev as PlanEvent & { id: string }]);
    await snoozeRisk();
    setMsg({ ok: true, text: '🕊 今日の目標を+200kcal緩めました。我慢しすぎないことが、結局いちばん速いです。' });
  }

  // ===== 昨日の穴埋め（未記録の爆食日を翌日に低摩擦で回収する・Web版と同一） =====
  const [backfill, setBackfill] = useState<{ date: string; binge: boolean } | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMore, setBackfillMore] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const t = todayJST();
        if (await AsyncStorage.getItem('bl-backfill-snooze') === t) return;
        const y = shiftDate(t, -1);
        const [{ data: e }, { data: first }] = await Promise.all([
          supabase.from('entries').select('intake,mood,food_text').eq('date', y).maybeSingle(),
          supabase.from('entries').select('date').order('date', { ascending: true }).limit(1),
        ]);
        if (!first || first.length === 0 || first[0].date > y) return; // 始めたばかり
        if (e?.intake != null) return; // 昨日は記録済み
        const binge = detectStruggle([String(e?.mood || ''), String(e?.food_text || '')]) === 'binge';
        setBackfill({ date: y, binge });
      } catch { /* 穴埋めは本体機能に影響させない */ }
    })();
  }, []);

  async function backfillSave(extra: number) {
    if (!backfill || !profile || !uid || backfillBusy) return;
    setBackfillBusy(true);
    try {
      const baseEst = Math.round(mifflinBMR(profile.sex, weightForBmr, Number(profile.height_cm), Number(profile.age)) * Number(profile.life_factor));
      const { error } = await supabase.from('logs').insert({
        user_id: uid, date: backfill.date, at: `${backfill.date}T21:00:00+09:00`,
        items: [], kcal: baseEst + extra, p: null, f: null, c: null, weight: null,
        ex: 'オフ', adj: 0, mood: '',
        text: extra > 0 ? `（あとから概算: 食べすぎ +${extra}kcal）` : '（あとから確定: だいたい目安どおり）',
        photo_urls: [],
      });
      if (error) { setMsg({ ok: false, text: '保存に失敗しました。もう一度お試しください。' }); return; }
      await syncEntriesForDate(uid, backfill.date);
      setBackfill(null);
      setMsg({
        ok: true,
        text: extra > 0
          ? `昨日を「食べすぎ +${extra.toLocaleString()}kcal」として記録しました。今日から立て直しましょう！`
          : '昨日を「目安どおり（±0）」で確定しました。',
      });
    } finally {
      setBackfillBusy(false);
    }
  }

  async function backfillSnooze() {
    try { await AsyncStorage.setItem('bl-backfill-snooze', todayJST()); } catch { /* 無視 */ }
    setBackfill(null);
  }

  function feedTitle(l: DayLog): string {
    const items = (l.items as FoodItem[]) || [];
    if (l.kcal != null && items.length > 0) {
      const names = items.slice(0, 3).map((it) => (it.qty && it.qty !== '×1' ? `${it.name} ${it.qty}` : it.name)).join('、');
      return names + (items.length > 3 ? ` ほか${items.length - 3}品` : '');
    }
    if (l.weight != null) return `体重 ${Number(l.weight).toFixed(1)}kg`;
    if (l.ex && l.ex !== 'オフ') return `運動 ${l.ex}`;
    return String(l.text || l.mood || '記録').slice(0, 40);
  }

  const parsedTotal = parsed ? sumItems(parsed.items) : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.brand}>▍BodyLog <Text style={s.beta}>ネイティブβ</Text></Text>

        {/* ヒーロー */}
        {profile && (
          <View style={s.hero}>
            <Text style={s.heroL}>{left < 0 ? 'オーバー' : 'あと食べられる'}{plan ? '（計画）' : '（維持）'}</Text>
            <Text style={[s.heroN, left < 0 && { color: C.coral }]}>
              {Math.abs(left).toLocaleString()}<Text style={s.heroU}> kcal</Text>
            </Text>
            <View style={s.hline}><View style={[s.hfill, { width: `${Math.min(100, Math.max(0, (eaten / Math.max(1, goalKcal)) * 100))}%` }, left < 0 && { backgroundColor: C.coral }]} /></View>
            <View style={s.heroMeta}>
              <Text style={s.metaT}>摂取 {eaten.toLocaleString()}</Text>
              {macros && <Text style={s.metaT}>P {eatenP}/{macros.p}g</Text>}
              <Text style={s.metaT}>目標 {goalKcal.toLocaleString()}</Text>
            </View>
          </View>
        )}

        {/* 昨日の穴埋めカード（責めないトーン） */}
        {backfill && (
          <View style={[s.card, { borderColor: C.amber, borderWidth: 1.5 }]}>
            <Text style={s.h2}>{backfill.binge ? '🍃 昨日の分、ざっくりだけ記録しませんか' : '📝 昨日の記録がありません'}</Text>
            <Text style={s.mutedT}>
              {backfill.binge
                ? '食べすぎた日ほど、記録すると立て直しが速くなります。ざっくりでOK。誰にも見られません。'
                : 'ざっくりでOKです。未記録の日が続くと、収支の数字と現実が少しずつズレていきます。'}
            </Text>
            {!backfillMore ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Pressable style={[s.btnPrimary, { flex: 1, marginTop: 0 }]} disabled={backfillBusy} onPress={() => backfillSave(0)}>
                  {backfillBusy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>だいたい目安どおり（±0）</Text>}
                </Pressable>
                <Pressable style={[s.btnGhost, { flex: 1 }]} disabled={backfillBusy} onPress={() => setBackfillMore(true)}>
                  <Text style={s.btnGhostT}>食べすぎた…</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {[500, 1000, 2000].map((n) => (
                  <Pressable key={n} style={s.chipBtn} disabled={backfillBusy} onPress={() => backfillSave(n)}>
                    <Text style={s.chipBtnT}>+{n.toLocaleString()}kcal くらい</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Pressable onPress={backfillSnooze} style={{ marginTop: 8, alignSelf: 'center' }} hitSlop={8}>
              <Text style={[s.mutedT, { textDecorationLine: 'underline' }]}>あとで</Text>
            </Pressable>
          </View>
        )}

        {/* 過食リスクの事前アラート（理由つき・1タップ予防） */}
        {bingeRisk && (
          <View style={[s.card, { borderColor: bingeRisk.level === 'high' ? C.coral : C.amber, borderWidth: 1.5 }]}>
            <Text style={s.h2}>{bingeRisk.level === 'high' ? '🌪 今日は食欲が爆発しやすい状態です' : '🌤 今日は食欲が乱れやすいかも'}</Text>
            {bingeRisk.reasons.map((r) => (
              <Text key={r.key} style={[s.mutedT, { lineHeight: 20 }]}>・{r.text}</Text>
            ))}
            <Text style={[s.mutedT, { marginTop: 6 }]}>
              これは失敗のサインではなく、準備のサインです。たんぱく質多めの食事と「我慢しすぎない設定」が効きます。
            </Text>
            {plan && !todayEvent ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Pressable style={[s.btnPrimary, { flex: 1, marginTop: 0 }]} onPress={addRecoveryEvent}>
                  <Text style={s.btnPrimaryT}>🕊 今日は+200kcal緩める</Text>
                </Pressable>
                <Pressable style={[s.btnGhost, { flex: 1 }]} onPress={snoozeRisk}>
                  <Text style={s.btnGhostT}>大丈夫、気をつける</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={[s.btnGhost, { marginTop: 10, flex: 0 }]} onPress={snoozeRisk}>
                <Text style={s.btnGhostT}>OK、気をつける</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* 今日のフィード */}
        <View style={s.card}>
          <Text style={s.h2}>今日の記録 <Text style={s.h2sub}>— {dayLogs.length}件</Text></Text>
          {dayLogs.length === 0 && <Text style={s.mutedT}>まだ記録がありません。下から1回分ずつ記録しましょう。</Text>}
          {dayLogs.map((l) => (
            <View key={l.id} style={s.feedRow}>
              <Text style={s.feedTime}>{timeJST(l.at)}</Text>
              <Text style={s.feedTitle} numberOfLines={2}>{feedTitle(l)}</Text>
              {l.kcal != null && <Text style={s.feedKcal}>{Math.round(Number(l.kcal)).toLocaleString()}<Text style={s.feedU}> kcal</Text></Text>}
            </View>
          ))}
        </View>

        {/* 解析結果（保存前の確認） */}
        {parsed && (
          <View style={[s.card, { borderColor: C.teal, borderWidth: 1.5 }]}>
            <Text style={s.h2}>保存前の確認</Text>
            {parsed.items.map((it, i) => (
              <View key={i} style={s.feedRow}>
                <Text style={[s.feedTitle, { marginLeft: 0 }]}>{it.name} {it.qty}</Text>
                <Text style={s.feedKcal}>{Math.round(it.kcal)}<Text style={s.feedU}> kcal</Text></Text>
              </View>
            ))}
            <View style={s.heroMeta}>
              {parsedTotal && parsed.items.length > 0 && <Text style={s.metaT}>合計 {Math.round(parsedTotal.kcal)}kcal / P{Math.round(parsedTotal.p)} F{Math.round(parsedTotal.f)} C{Math.round(parsedTotal.c)}</Text>}
              {parsed.weight != null && <Text style={s.metaT}>体重 {parsed.weight}kg</Text>}
              {parsed.ex && parsed.ex !== 'オフ' && <Text style={s.metaT}>運動 {parsed.ex}</Text>}
            </View>
            <Pressable style={({ pressed }) => [s.btnPrimary, pressed && { opacity: 0.85 }]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>この内容で保存する</Text>}
            </Pressable>
          </View>
        )}

        {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}

        {/* コンポーザー */}
        <View style={s.card}>
          <TextInput
            style={s.ta} multiline placeholder={'食事・体重・気分を自由に…\n例）昼は牛丼並盛とサラダ。体重73.5kg'}
            placeholderTextColor={C.faint} value={chat} onChangeText={setChat}
          />
          {/* マイ食品チップ（連打で×2、−で減） */}
          {myFoods.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} keyboardShouldPersistTaps="handled">
              {myFoods.map((fd) => {
                const cnt = parsed ? servingCount(parsed.items, fd) : null;
                return (
                  <View key={fd.id} style={[s.chip, cnt != null && s.chipOn]}>
                    <Pressable onPress={() => tapFood(fd)} style={s.chipMain}>
                      <Text style={[s.chipT, cnt != null && { color: C.ink }]}>
                        {cnt == null ? '＋ ' : ''}{fd.name}{cnt != null ? ` ×${cnt % 1 === 0 ? cnt : cnt.toFixed(1)}` : ''}
                      </Text>
                    </Pressable>
                    {cnt != null && (
                      <Pressable onPress={() => decFood(fd)} style={s.chipMinus}>
                        <Text style={{ color: C.coral, fontWeight: '800', fontSize: 15 }}>−</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}
          <Pressable style={({ pressed }) => [s.btnPrimary, pressed && { opacity: 0.85 }]} onPress={parse} disabled={analyzing}>
            {analyzing ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryT}>✨ AI解析</Text>}
          </Pressable>

          {/* 体重クイック入力 */}
          <View style={s.wRow}>
            <TextInput style={s.wInput} placeholder={latestWeight != null ? latestWeight.toFixed(1) : '73.5'}
                       placeholderTextColor={C.faint} keyboardType="decimal-pad" value={wWeight} onChangeText={setWWeight} />
            <Text style={s.wUnit}>kg</Text>
            <Pressable style={({ pressed }) => [s.btnGhost, pressed && { opacity: 0.7 }]} onPress={saveWeight} disabled={saving || !wWeight}>
              <Text style={s.btnGhostT}>⚖️ 体重を記録</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 64 },
  brand: { fontSize: 18, fontWeight: '800', color: C.ink, marginBottom: 12 },
  beta: { fontSize: 11, color: C.teal, fontWeight: '700' },
  hero: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 18, marginBottom: 12 },
  heroL: { fontSize: 11, fontWeight: '700', color: C.sub, letterSpacing: 0.5 },
  heroN: { fontSize: 44, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginVertical: 2 },
  heroU: { fontSize: 15, color: C.sub, fontWeight: '600' },
  hline: { height: 5, backgroundColor: '#eceeeb', borderRadius: 3, overflow: 'hidden', marginVertical: 8 },
  hfill: { height: 5, backgroundColor: C.teal, borderRadius: 3 },
  heroMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, flexWrap: 'wrap' },
  metaT: { fontSize: 12, color: C.sub, fontVariant: ['tabular-nums'] },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 16, marginBottom: 12 },
  h2: { fontSize: 13, fontWeight: '800', color: C.ink, letterSpacing: 0.8, marginBottom: 8 },
  h2sub: { fontWeight: '400', color: C.sub, letterSpacing: 0 },
  mutedT: { fontSize: 13, color: C.sub, lineHeight: 20 },
  feedRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 7, borderTopWidth: 0.5, borderTopColor: C.line, gap: 8 },
  feedTime: { fontSize: 11, color: C.faint, fontWeight: '700', width: 40, paddingTop: 2, fontVariant: ['tabular-nums'] },
  feedTitle: { flex: 1, fontSize: 14.5, color: C.ink, lineHeight: 20 },
  feedKcal: { fontSize: 14, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  feedU: { fontSize: 10, color: C.faint },
  msg: { fontSize: 13, fontWeight: '600', marginBottom: 10, paddingHorizontal: 4 },
  ta: {
    minHeight: 88, maxHeight: 180, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, padding: 12, fontSize: 16, color: C.ink, textAlignVertical: 'top',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.panel,
    borderWidth: 1.5, borderColor: C.line, borderRadius: 999, marginRight: 6, overflow: 'hidden',
  },
  chipOn: { borderColor: C.ink },
  chipMain: { paddingVertical: 9, paddingLeft: 13, paddingRight: 11 },
  chipMinus: { paddingVertical: 9, paddingHorizontal: 12, borderLeftWidth: 1.5, borderLeftColor: C.line },
  chipT: { fontSize: 12.5, fontWeight: '700', color: C.sub },
  btnPrimary: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  btnPrimaryT: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  wRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  wInput: {
    width: 90, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    padding: 10, fontSize: 16, color: C.ink, textAlign: 'center', fontVariant: ['tabular-nums'],
  },
  wUnit: { fontSize: 13, color: C.sub, fontWeight: '600' },
  btnGhost: { flex: 1, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  btnGhostT: { color: C.ink, fontSize: 13, fontWeight: '800' },
  chipBtn: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  chipBtnT: { fontSize: 12.5, fontWeight: '700', color: C.sub },
});
