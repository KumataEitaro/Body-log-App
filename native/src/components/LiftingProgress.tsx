// 運動の記録（「概要」タブ）— 週間サマリー/2色カレンダー/週別バランス/筋トレ成長を独立カードに分割
// （1ブロックにまとめると並び替えで一緒に動いてしまうため、ドラッグ単位＝カード単位に揃える）
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/ui';
import { todayJST } from '@/lib/calc';
import { TrendingUp, CalendarDays } from 'lucide-react-native';
import { trainingSeries, volumeVerdict } from '@/lib/training';
import { parse1RMs } from '@/lib/rm';
import InteractiveChart from '@/components/InteractiveChart';
import MonthCalendar, { CARDIO_GREEN, type DayMark } from '@/components/MonthCalendar';
import { Chip, OptionButton } from '@/components/ui/Selectable';
import { t } from '@/lib/i18n';

function shiftDate(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
// 週の起点（月曜はじまり）
function weekStartOf(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

type HistRow = { id: string; date: string; text: string; adj?: number | null; ex_minutes?: number | null; ex_km?: number | null };
type Habit = { perWeek: number | null; weeklyKcal: number | null; minMin: number | null };

const LIFT_MIN_DEFAULT = 45; // 筋トレの時間未記録は1回45分換算（バランス/時間集計用）
function minutesOf(r: HistRow): number {
  if (r.ex_minutes != null) return Number(r.ex_minutes);
  const m = r.text.match(/(\d+)分/);
  if (m) return Number(m[1]);
  return r.text.startsWith('🏋️') ? LIFT_MIN_DEFAULT : 0;
}
function kcalOf(r: HistRow): number {
  if (r.adj != null && Number(r.adj) > 0) return Number(r.adj);
  const m = r.text.match(/約([\d,]+)kcal/);
  return m ? Number(m[1].replace(/,/g, '')) : 0;
}

// v17列（ex_minutes等）が無い旧DBでも動くフォールバック付きフェッチ
async function fetchLogs(prefix: string, limit: number): Promise<HistRow[]> {
  const res = await supabase.from('logs').select('id,date,text,adj,ex_minutes,ex_km')
    .like('text', `${prefix}%`).order('at', { ascending: false }).limit(limit);
  if (!res.error) return (res.data as HistRow[]) || [];
  const res2 = await supabase.from('logs').select('id,date,text,adj')
    .like('text', `${prefix}%`).order('at', { ascending: false }).limit(limit);
  return (res2.data as HistRow[]) || [];
}

// 共有データフック（各カードが独立して使う）
function useLifting() {
  const [history, setHistory] = useState<HistRow[]>([]); // 🏋️ 筋トレ
  const [cardio, setCardio] = useState<HistRow[]>([]);   // 🏃 有酸素・かんたん記録
  const [goalKg, setGoalKg] = useState<Map<string, number>>(new Map());
  const [habit, setHabit] = useState<Habit>({ perWeek: null, weeklyKcal: null, minMin: null });
  const load = useCallback(async () => {
    const [lift, run, tgRes, gRes] = await Promise.all([
      fetchLogs('🏋️', 120),
      fetchLogs('🏃', 240),
      supabase.from('training_goals').select('name,target_kg'),
      supabase.from('goals').select('ex_per_week,ex_weekly_kcal,ex_min_minutes').maybeSingle(),
    ]);
    setHistory(lift);
    setCardio(run);
    if (tgRes.data) setGoalKg(new Map(tgRes.data.map((g: { name: string; target_kg: number }) => [g.name, Number(g.target_kg)])));
    if (!gRes.error && gRes.data) {
      setHabit({
        perWeek: gRes.data.ex_per_week != null ? Number(gRes.data.ex_per_week) : null,
        weeklyKcal: gRes.data.ex_weekly_kcal != null ? Number(gRes.data.ex_weekly_kcal) : null,
        minMin: gRes.data.ex_min_minutes != null ? Number(gRes.data.ex_min_minutes) : null,
      });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const series = trainingSeries(history);
  const exercises = [...series.entries()].sort((a, b) => b[1].length - a[1].length).map(([n]) => n);
  return { history, cardio, goalKg, series, exercises, habit };
}

// ===== ① 週間サマリー（習慣目標との対比・🔥ストリーク・+食べられるkcal） =====
export function LiftKpiCard() {
  const { history, cardio, habit } = useLifting();
  const router = useRouter();
  const today = todayJST();
  const all = [...history, ...cardio];
  if (all.length === 0) return null;
  const ws = weekStartOf(today);
  const minOk = habit.minMin ?? 0;
  // 「有効カウント」= 筋トレは常に1回、有酸素は最低分数以上のみ
  const isValid = (r: HistRow) => r.text.startsWith('🏋️') || minutesOf(r) >= minOk;
  const week = all.filter((r) => r.date >= ws);
  const count = new Set(week.filter(isValid).map((r) => r.date)).size;
  const kcal = Math.round(week.reduce((a, r) => a + kcalOf(r), 0));
  const mins = Math.round(week.reduce((a, r) => a + minutesOf(r), 0));
  // ストリーク: 週目標を満たした連続週数（目標なしは運動1回以上の週）。今週は進行中なので未達でも切らない
  let streak = 0;
  for (let i = 0; i < 52; i++) {
    const s0 = shiftDate(ws, -7 * i);
    const s1 = shiftDate(s0, 7);
    const c = new Set(all.filter((r) => r.date >= s0 && r.date < s1 && isValid(r)).map((r) => r.date)).size;
    const met = habit.perWeek != null ? c >= habit.perWeek : c >= 1;
    if (met) streak++;
    else if (i === 0) continue;
    else break;
  }
  const hasGoal = habit.perWeek != null || habit.weeklyKcal != null;
  return (
    <View style={s.card}>
      <View style={[s.h2Row, { justifyContent: 'space-between' }]}>
        <Text style={[s.h2, { marginBottom: 0 }]}>{t('今週の運動')}<Text style={s.weekNote}>{t('— 月曜はじまり')}</Text></Text>
        {streak > 0 && <Text style={s.streak}>🔥 {streak}週連続</Text>}
      </View>
      <View style={s.kpiRow}>
        <View style={s.kpi}>
          <Text style={s.kpiL}>{t('回数')}</Text>
          <Text style={s.kpiV}>{count}<Text style={s.kpiU}>{habit.perWeek != null ? ` / ${habit.perWeek}回` : t('回')}</Text></Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiL}>{t('消費')}</Text>
          <Text style={s.kpiV}>{kcal.toLocaleString()}<Text style={s.kpiU}>{habit.weeklyKcal != null ? ` / ${Number(habit.weeklyKcal).toLocaleString()}` : 'kcal'}</Text></Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiL}>{t('時間')}</Text>
          <Text style={s.kpiV}>{mins}<Text style={s.kpiU}>{t('分')}</Text></Text>
        </View>
      </View>
      {kcal > 0 && <Text style={s.earnT}>🍚 今週の運動で +{kcal.toLocaleString()}kcal 食べられる分を稼ぎました</Text>}
      {minOk > 0 && <Text style={s.muted}>※ {minOk}分以上の運動を1回とカウントしています</Text>}
      {!hasGoal && (
        <OptionButton style={{ marginTop: 10 }} variant="tonal" label="週の目標を決める（設定 → 運動の目標）"
                      onPress={() => router.push('/settings' as never)} />
      )}
    </View>
  );
}

// ===== ② 運動カレンダー（筋トレ=濃緑・有酸素=薄緑・両方=二重ドット） =====
export function LiftCalendarCard() {
  const { history, cardio } = useLifting();
  const [daySel, setDaySel] = useState<string | null>(null);
  const all = [...history, ...cardio];
  if (all.length === 0) return null;
  const today = todayJST();
  const kindMap = new Map<string, 'lift' | 'cardio' | 'both'>();
  for (const r of all) {
    const k: 'lift' | 'cardio' = r.text.startsWith('🏋️') ? 'lift' : 'cardio';
    const cur = kindMap.get(r.date);
    kindMap.set(r.date, cur && cur !== k ? 'both' : (cur ?? k));
  }
  const marks = new Map<string, DayMark>([...kindMap.entries()].map(([d, k]) => [d, { logged: true, over: false, kind: k }]));
  const dayItems = daySel ? all.filter((h) => h.date === daySel) : [];
  return (
    <View style={s.card}>
      <View style={s.h2Row}><CalendarDays size={14} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('運動カレンダー')}</Text></View>
      <MonthCalendar today={today} marks={marks} selected={daySel} mode="training"
                     onSelect={(d) => setDaySel(daySel === d ? null : d)} />
      {daySel && (
        <View style={s.dayBox}>
          <Text style={s.dayHead}>{daySel.replace(/-/g, '/')} の運動</Text>
          {dayItems.length === 0 && <Text style={s.muted}>{t('この日の運動記録はありません。')}</Text>}
          {dayItems.map((h) => (
            <Text key={h.id} style={s.dayText}>
              {h.text.startsWith('🏋️') ? '🏋️ ' : '🏃 '}{h.text.replace(/^🏋️ |^🏃 /, '')}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

// ===== ③ 週別バランス（運動時間のスタック棒・直近8週） =====
export function BalanceCard() {
  const { history, cardio } = useLifting();
  const all = [...history, ...cardio];
  if (all.length === 0) return null;
  const ws = weekStartOf(todayJST());
  const weeks: { label: string; lift: number; cardio: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const s0 = shiftDate(ws, -7 * i);
    const s1 = shiftDate(s0, 7);
    const wk = all.filter((r) => r.date >= s0 && r.date < s1);
    weeks.push({
      label: `${Number(s0.slice(5, 7))}/${Number(s0.slice(8, 10))}`,
      lift: Math.round(wk.filter((r) => r.text.startsWith('🏋️')).reduce((a, r) => a + minutesOf(r), 0)),
      cardio: Math.round(wk.filter((r) => r.text.startsWith('🏃')).reduce((a, r) => a + minutesOf(r), 0)),
    });
  }
  const max = Math.max(1, ...weeks.map((w) => w.lift + w.cardio));
  return (
    <View style={s.card}>
      <View style={s.h2Row}><TrendingUp size={14} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('週別バランス')}<Text style={s.weekNote}>{t('— 運動時間の内訳')}</Text></Text></View>
      {weeks.map((w, i) => {
        const total = w.lift + w.cardio;
        return (
          <View key={i} style={s.balRow}>
            <Text style={s.balLabel}>{w.label}</Text>
            <View style={s.balTrack}>
              {w.lift > 0 && <View style={{ flex: w.lift, backgroundColor: C.teal }} />}
              {w.cardio > 0 && <View style={{ flex: w.cardio, backgroundColor: CARDIO_GREEN }} />}
              <View style={{ flex: Math.max(0.001, max - total) }} />
            </View>
            <Text style={s.balMin}>{total > 0 ? `${total}分` : '—'}</Text>
          </View>
        );
      })}
      <View style={s.balLegend}>
        <View style={[s.legDot, { backgroundColor: C.teal }]} /><Text style={s.muted}>{t('筋トレ')}</Text>
        <View style={[s.legDot, { backgroundColor: CARDIO_GREEN }]} /><Text style={s.muted}>{t('有酸素')}</Text>
        <Text style={s.muted}>・筋トレの時間未記録は1回{LIFT_MIN_DEFAULT}分換算</Text>
      </View>
    </View>
  );
}

// ===== ③ 挙上重量グラフ =====
export function LiftChartCard() {
  const { history, goalKg, series, exercises } = useLifting();
  const [selEx, setSelEx] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<'kg' | '1rm' | 'volume'>('1rm');
  const [exView, setExView] = useState<'chips' | 'list'>('chips');

  useEffect(() => { AsyncStorage.getItem('bl-ex-view').then((v) => { if (v === 'list') setExView('list'); }).catch(() => {}); }, []);
  function toggleExView() {
    const v = exView === 'chips' ? 'list' : 'chips';
    setExView(v);
    AsyncStorage.setItem('bl-ex-view', v).catch(() => {});
  }

  const activeEx = selEx && series.has(selEx) ? selEx : exercises[0] ?? null;
  const exPoints = activeEx ? series.get(activeEx)! : [];
  const verdict = volumeVerdict(exPoints);
  // 推定1RM系列: 履歴テキストから種目別に日毎の最大1RMを抽出（10回×100kgと1回×120kgを同じ土俵で比較）
  const rmByDate = new Map<string, number>();
  if (activeEx) {
    for (const h1 of history) {
      for (const p of parse1RMs(h1.text)) {
        if (p.name !== activeEx) continue;
        const cur = rmByDate.get(h1.date) ?? 0;
        rmByDate.set(h1.date, Math.max(cur, Math.round(p.est)));
      }
    }
  }
  const rmPoints = [...rmByDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, value]) => ({ date, value }));

  if (exercises.length === 0) {
    return (
      <View style={s.card}>
        <View style={s.h2Row}><TrendingUp size={14} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('挙上重量の推移')}</Text></View>
        <Text style={s.muted}>{t('トレタブで筋トレを記録すると、実施カレンダーと種目ごとの成長グラフがここに描かれます。')}</Text>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <View style={s.h2Row}><TrendingUp size={14} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('筋トレの成長')}</Text></View>
      <View style={s.chips}>
        {([['1rm', t('推定1RM')], ['kg', t('実重量')], ['volume', t('ボリューム')]] as const).map(([m, l]) => (
          <Chip key={m} label={l} tone="ink" selected={chartMode === m} onPress={() => setChartMode(m)} />
        ))}
      </View>
      <InteractiveChart
        points={chartMode === '1rm'
          ? rmPoints
          : exPoints.map((p) => ({ date: p.date, value: chartMode === 'kg' ? p.maxKg : p.volume }))}
        unit={chartMode === 'volume' ? 'kg·回' : 'kg'} decimals={0}
        planValue={chartMode === '1rm' && activeEx ? goalKg.get(activeEx) ?? null : null}
        presetDays={null}
      />
      {/* 種目セレクタ（チップ⇄リストの表示切替つき） */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {exView === 'chips' ? (
          <View style={[s.chips, { flex: 1 }]}>
            {exercises.map((n) => (
              <Chip key={n} label={n} tone="ink" selected={n === activeEx} onPress={() => setSelEx(n)} />
            ))}
          </View>
        ) : (
          <View style={{ flex: 1, marginVertical: 8 }}>
            {exercises.map((n) => (
              <Pressable key={n} style={s.listRow} onPress={() => setSelEx(n)}>
                <Text style={[s.listT, n === activeEx && { color: C.ink, fontWeight: '800' }]}>{n}</Text>
                {n === activeEx && <Text style={{ color: C.teal, fontWeight: '800' }}>✓</Text>}
              </Pressable>
            ))}
          </View>
        )}
        <Pressable onPress={toggleExView} hitSlop={8} style={s.viewToggle}>
          <Text style={s.viewToggleT}>{exView === 'chips' ? '☰' : '▤'}</Text>
        </Pressable>
      </View>
      {verdict && (
        <Text style={[s.verdict, { color: verdict.trend === 'down' ? C.amber : C.teal }]}>
          {verdict.trend === 'up' && `💪 ボリューム上昇中（直近 ${verdict.lastVolume.toLocaleString()}kg·回・平均比 +${verdict.pct}%）`}
          {verdict.trend === 'flat' && `➡️ ボリューム維持（平均比 ${verdict.pct > 0 ? '+' : ''}${verdict.pct}%）。減量中の維持は十分な成果`}
          {verdict.trend === 'down' && `⚠️ ボリューム低下（平均比 ${verdict.pct}%）。赤字が深すぎるサインかも。たんぱく質と睡眠を確認`}
        </Text>
      )}
      {activeEx && goalKg.has(activeEx) && chartMode === '1rm' && (
        <Text style={s.muted}>点線＝目標MAX {goalKg.get(activeEx)}kg（RM換算・あと{Math.max(0, (goalKg.get(activeEx) ?? 0) - (rmPoints[rmPoints.length - 1]?.value ?? 0))}kg）</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 14, marginBottom: 12 },
  h2: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 8 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  chips: { flexDirection: 'row', gap: 6, marginVertical: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { fontSize: 12, fontWeight: '700', color: C.sub },
  verdict: { fontSize: 12.5, fontWeight: '600', lineHeight: 19, marginTop: 4 },
  muted: { fontSize: 11, color: C.faint, marginTop: 4 },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 10, marginTop: 4 },
  kpi: { flex: 1, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 12 },
  weekNote: { fontSize: 10.5, fontWeight: '400', color: C.faint },
  streak: { fontSize: 12, fontWeight: '800', color: '#d97706' },
  earnT: { fontSize: 12.5, fontWeight: '700', color: C.teal, marginTop: 2, lineHeight: 19 },
  balRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  balLabel: { width: 38, fontSize: 11, fontWeight: '700', color: C.sub, fontVariant: ['tabular-nums'] },
  balTrack: { flex: 1, height: 14, borderRadius: 7, backgroundColor: C.bg, flexDirection: 'row', overflow: 'hidden' },
  balMin: { width: 48, fontSize: 10.5, color: C.sub, textAlign: 'right', fontVariant: ['tabular-nums'] },
  balLegend: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, flexWrap: 'wrap' },
  legDot: { width: 8, height: 8, borderRadius: 4 },
  kpiL: { fontSize: 10, fontWeight: '700', color: C.sub },
  kpiV: { fontSize: 20, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginTop: 2 },
  kpiU: { fontSize: 11, color: C.sub, fontWeight: '600' },
  dayBox: { borderTopWidth: 0.5, borderTopColor: C.line, marginTop: 8, paddingTop: 8 },
  dayHead: { fontSize: 12.5, fontWeight: '800', color: C.ink, marginBottom: 4, fontVariant: ['tabular-nums'] },
  dayText: { fontSize: 13, color: C.ink, lineHeight: 20, paddingVertical: 3 },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 0.5, borderBottomColor: C.line },
  listT: { fontSize: 13.5, color: C.sub, fontWeight: '600' },
  viewToggle: { marginLeft: 6, marginTop: 8, width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  viewToggleT: { fontSize: 13, color: C.sub, fontWeight: '700' },
});
