// 運動の記録（「概要」タブ）— 週間サマリー/2色カレンダー/週別バランス/筋トレ成長を独立カードに分割
// （1ブロックにまとめると並び替えで一緒に動いてしまうため、ドラッグ単位＝カード単位に揃える）
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { C, themed } from '@/lib/ui';
import { todayJST } from '@/lib/calc';
import { TrendingUp, CalendarDays, Trophy, Share2, Flame, Dumbbell } from 'lucide-react-native';
import ShareStickerModal, { type StickerData } from '@/components/ShareSticker';
import { trainingSeries, volumeVerdict } from '@/lib/training';
import { parse1RMs } from '@/lib/rm';
import { weightLookup } from '@/lib/liftLog';
import { weeklyPartVolumes } from '@/lib/training';
import { LIFT_PARTS, liftPartLabel } from '@/lib/lifts';
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
  // 懸垂などの自重種目は体重が負荷の大半なので、日付ごとの体重が必要
  const [weightRows, setWeightRows] = useState<{ date: string; weight: number | null }[]>([]);
  const load = useCallback(async () => {
    const [lift, run, tgRes, gRes, wRes] = await Promise.all([
      fetchLogs('🏋️', 120),
      fetchLogs('🏃', 240),
      supabase.from('training_goals').select('name,target_kg'),
      supabase.from('goals').select('ex_per_week,ex_weekly_kcal,ex_min_minutes').maybeSingle(),
      supabase.from('entries').select('date,weight').not('weight', 'is', null)
        .order('date', { ascending: false }).limit(400),
    ]);
    setWeightRows((wRes.data as { date: string; weight: number | null }[] | null) ?? []);
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
  const weightAt = weightLookup(weightRows);
  const series = trainingSeries(history, weightAt);
  const exercises = [...series.entries()].sort((a, b) => b[1].length - a[1].length).map(([n]) => n);
  return { history, cardio, goalKg, series, exercises, habit, weightAt };
}

// 運動の記録がまだ無い人向けの空状態。nullを返すと概要の詳細ページが
// 「タイトルだけの真っ白な画面」になる（βフィードバック 2026-09-01）ため、必ず説明を出す
function LiftEmpty({ what }: { what: string }) {
  return (
    <View style={[s.card, { borderStyle: 'dashed', alignItems: 'center', gap: 8 }]}>
      <Dumbbell size={20} color={C.faint} />
      <Text style={{ fontSize: 13.5, color: C.sub, fontWeight: '600', lineHeight: 21, textAlign: 'center' }}>
        {t('まだ運動の記録がありません。運動タブで最初の1セットを記録すると、ここに{what}が育ちはじめます。', { what })}
      </Text>
    </View>
  );
}

// ===== ① 週間サマリー（習慣目標との対比・🔥ストリーク・+食べられるkcal） =====
export function LiftKpiCard() {
  const { history, cardio, habit } = useLifting();
  const router = useRouter();
  const today = todayJST();
  const all = [...history, ...cardio];
  if (all.length === 0) return <LiftEmpty what={t('今週のサマリー')} />;
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
        {streak > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Flame size={13} color={C.teal} fill={C.teal} />
            <Text style={s.streak}>{t('{n}週連続', { n: streak })}</Text>
          </View>
        )}
      </View>
      <View style={s.kpiRow}>
        <View style={s.kpi}>
          <Text style={s.kpiL}>{t('回数')}</Text>
          {/* KPIの大数字は3列固定グリッドのため文字サイズ拡大は上限1.3 */}
          <Text style={s.kpiV} maxFontSizeMultiplier={1.3}>{count}<Text style={s.kpiU}>{habit.perWeek != null ? ` / ${habit.perWeek}回` : t('回')}</Text></Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiL}>{t('消費')}</Text>
          <Text style={s.kpiV} maxFontSizeMultiplier={1.3}>{kcal.toLocaleString()}<Text style={s.kpiU}>{habit.weeklyKcal != null ? ` / ${Number(habit.weeklyKcal).toLocaleString()}` : 'kcal'}</Text></Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiL}>{t('時間')}</Text>
          <Text style={s.kpiV} maxFontSizeMultiplier={1.3}>{mins}<Text style={s.kpiU}>{t('分')}</Text></Text>
        </View>
      </View>
      {kcal > 0 && <Text style={s.earnT}>{t('🍚 今週の運動で +{n}kcal 食べられる分を稼ぎました', { n: kcal.toLocaleString() })}</Text>}
      {minOk > 0 && <Text style={s.muted}>{t('※ {n}分以上の運動を1回とカウントしています', { n: minOk })}</Text>}
      {!hasGoal && (
        <OptionButton style={{ marginTop: 10 }} variant="tonal" label={t('週の目標を決める（設定 → 運動の目標）')}
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
  if (all.length === 0) return <LiftEmpty what={t('運動カレンダー')} />;
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
      <View style={s.h2Row}><CalendarDays size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('運動カレンダー')}</Text></View>
      <MonthCalendar today={today} marks={marks} selected={daySel} mode="training"
                     onSelect={(d) => setDaySel(daySel === d ? null : d)} />
      {daySel && (
        <View style={s.dayBox}>
          <Text style={s.dayHead}>{daySel.replace(/-/g, '/')} {t('の運動')}</Text>
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
  if (all.length === 0) return <LiftEmpty what={t('週別バランス')} />;
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
      <View style={s.h2Row}><TrendingUp size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('週別バランス')}<Text style={s.weekNote}>{t('— 運動時間の内訳')}</Text></Text></View>
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
            <Text style={s.balMin}>{total > 0 ? `${total}${t('分')}` : '—'}</Text>
          </View>
        );
      })}
      <View style={s.balLegend}>
        <View style={[s.legDot, { backgroundColor: C.teal }]} /><Text style={s.muted}>{t('筋トレ')}</Text>
        <View style={[s.legDot, { backgroundColor: CARDIO_GREEN }]} /><Text style={s.muted}>{t('有酸素')}</Text>
        <Text style={s.muted}>{t('・筋トレの時間未記録は1回{n}分換算', { n: LIFT_MIN_DEFAULT })}</Text>
      </View>
    </View>
  );
}

// ===== 部位別ボリューム（週ごとの総挙上量を部位で遡る） =====
export function PartVolumeCard() {
  const { history, weightAt } = useLifting();
  const [selPart, setSelPart] = useState<string | null>(null);
  const data = weeklyPartVolumes(history, weightAt, 8, todayJST());
  // ボリュームが付いたことのある部位だけチップに出す（空の部位で埋めない）
  const present = new Set<string>();
  for (const w of data) for (const k of Object.keys(w.byPart)) if (w.byPart[k] > 0) present.add(k);
  const parts = [...LIFT_PARTS.map((x) => x.key), 'other'].filter((k) => present.has(k));
  if (parts.length === 0) return <LiftEmpty what={t('部位別ボリューム')} />;

  const valOf = (w: (typeof data)[number]) => (selPart ? (w.byPart[selPart] ?? 0) : w.total);
  const vals = data.map(valOf);
  const max = Math.max(1, ...vals);
  const cur = vals[vals.length - 1];
  const prev = vals[vals.length - 2] ?? 0;
  const delta = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

  return (
    <View style={s.card}>
      <View style={s.h2Row}>
        <TrendingUp size={16} color={C.teal} />
        <Text style={[s.h2, { marginBottom: 0, flex: 1 }]}>{t('部位別ボリューム')}<Text style={s.weekNote}>{t('— 週ごとの総挙上量')}</Text></Text>
      </View>
      <View style={s.pvChips}>
        <Pressable style={[s.chip, s.pvChip, selPart == null && s.pvChipOn]} onPress={() => setSelPart(null)}>
          <Text style={[s.pvChipT, selPart == null && s.pvChipTOn]}>{t('合計')}</Text>
        </Pressable>
        {parts.map((k) => (
          <Pressable key={k} style={[s.chip, s.pvChip, selPart === k && s.pvChipOn]}
                     onPress={() => setSelPart((cur2) => (cur2 === k ? null : k))}>
            <Text style={[s.pvChipT, selPart === k && s.pvChipTOn]}>{t(liftPartLabel(k))}</Text>
          </Pressable>
        ))}
      </View>
      {/* 今週の到達点と先週比。棒より先に「増えたか減ったか」を言葉で返す */}
      <View style={s.pvHead}>
        <Text style={s.pvNow} maxFontSizeMultiplier={1.3}>{cur.toLocaleString()}<Text style={s.pvUnit}> kg</Text></Text>
        <Text style={s.pvDelta}>
          {delta == null ? t('今週') : delta >= 0 ? t('今週（先週比 +{p}%）', { p: delta }) : t('今週（先週比 {p}%）', { p: delta })}
        </Text>
      </View>
      <View style={s.pvBars}>
        {data.map((w, i) => {
          const v = vals[i];
          const hPct = Math.max(v > 0 ? 6 : 2, Math.round((v / max) * 100));
          const isLast = i === data.length - 1;
          return (
            <View key={w.week} style={s.pvBarCol}>
              <View style={[s.pvBarTrack]}>
                <View style={[s.pvBar, { height: `${hPct}%` }, !isLast && { opacity: 0.45 }, v === 0 && { backgroundColor: C.line, opacity: 1 }]} />
              </View>
              <Text style={s.pvBarL}>{Number(w.week.slice(5, 7))}/{Number(w.week.slice(8, 10))}</Text>
            </View>
          );
        })}
      </View>
      <Text style={[s.muted, { marginTop: 8 }]}>{t('自重種目（懸垂など）はその週の体重で実負荷に換算しています。')}</Text>
    </View>
  );
}

// ===== ③ 挙上重量グラフ =====
export function LiftChartCard() {
  const { weightAt, history, goalKg, series, exercises } = useLifting();
  const [selEx, setSelEx] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<'kg' | '1rm' | 'volume'>('1rm');
  const [exView, setExView] = useState<'chips' | 'list'>('chips');

  useEffect(() => { AsyncStorage.getItem('bl-ex-view').then((v) => { if (v === 'list') setExView('list'); }).catch(() => {}); }, []);
  function toggleExView() {
    const v = exView === 'chips' ? 'list' : 'chips';
    setExView(v);
    AsyncStorage.setItem('bl-ex-view', v).catch(() => {});
  }

  // 種目ゼロ（筋トレ未記録）はチップも線も無い骨だけのカードになるため空状態を出す
  if (exercises.length === 0) return <LiftEmpty what={t('挙上重量の推移')} />;

  const activeEx = selEx && series.has(selEx) ? selEx : exercises[0] ?? null;
  const exPoints = activeEx ? series.get(activeEx)! : [];
  const verdict = volumeVerdict(exPoints);
  // 推定1RM系列: 履歴テキストから種目別に日毎の最大1RMを抽出（10回×100kgと1回×120kgを同じ土俵で比較）
  const rmByDate = new Map<string, number>();
  if (activeEx) {
    for (const h1 of history) {
      for (const p of parse1RMs(h1.text, weightAt(h1.date))) {
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
        <View style={s.h2Row}><TrendingUp size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('挙上重量の推移')}</Text></View>
        <Text style={s.muted}>{t('トレタブで筋トレを記録すると、実施カレンダーと種目ごとの成長グラフがここに描かれます。')}</Text>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <View style={s.h2Row}><TrendingUp size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('挙上重量の推移')}</Text></View>
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
          {verdict.trend === 'up' && t('💪 ボリューム上昇中（直近 {v}kg·回・平均比 +{p}%）', { v: verdict.lastVolume.toLocaleString(), p: verdict.pct })}
          {verdict.trend === 'flat' && t('➡️ ボリューム維持（平均比 {p}%）。減量中の維持は十分な成果', { p: `${verdict.pct > 0 ? '+' : ''}${verdict.pct}` })}
          {verdict.trend === 'down' && t('⚠️ ボリューム低下（平均比 {p}%）。赤字が深すぎるサインかも。たんぱく質と睡眠を確認', { p: verdict.pct })}
        </Text>
      )}
      {activeEx && goalKg.has(activeEx) && chartMode === '1rm' && (
        <Text style={s.muted}>{t('点線＝目標MAX {kg}kg（RM換算・あと{left}kg）', { kg: goalKg.get(activeEx) ?? 0, left: Math.max(0, (goalKg.get(activeEx) ?? 0) - (rmPoints[rmPoints.length - 1]?.value ?? 0)) })}</Text>
      )}
    </View>
  );
}

// ===== ⑥ 自己ベスト（種目ごとの最高記録。直近14日の更新は NEW! で祝う） =====
export function PersonalBestCard() {
  const { series, goalKg } = useLifting();
  const [sticker, setSticker] = useState<StickerData | null>(null);
  const today = todayJST();
  const rows = [...series.entries()].map(([name, pts]) => {
    let best = { kg: 0, date: '' };
    for (const p of pts) if (p.maxKg > best.kg) best = { kg: p.maxKg, date: p.date };
    return { name, kg: best.kg, date: best.date };
  }).filter((r) => r.kg > 0)
    .sort((a, b) => b.kg - a.kg)
    .slice(0, 8);
  if (rows.length === 0) return <LiftEmpty what={t('自己ベスト')} />;
  const isNew = (d: string) => shiftDate(d, 14) >= today;   // 直近14日以内の更新
  const topKg = rows[0].kg;
  return (
    <View style={s.card}>
      <View style={s.h2Row}><Trophy size={16} color={C.teal} /><Text style={[s.h2, { marginBottom: 0 }]}>{t('自己ベスト')}</Text></View>
      {rows.map((r) => {
        const goal = goalKg.get(r.name);
        return (
          <View key={r.name} style={s.prRow}>
            <Text style={s.prName} numberOfLines={1}>{r.name}</Text>
            <View style={s.prBarTrack}>
              <View style={[s.prBarFill, { width: `${Math.max(6, (r.kg / topKg) * 100)}%` }]} />
            </View>
            <View style={{ alignItems: 'flex-end', minWidth: 84 }}>
              <Text style={s.prKg}>
                {r.kg}<Text style={s.prUnit}>kg</Text>
                {isNew(r.date) && <Text style={s.prNew}> NEW!</Text>}
              </Text>
              <Text style={s.prDate}>{r.date.slice(5).replace('-', '/')}{goal ? ` ・ ${t('目標')}${goal}kg` : ''}</Text>
            </View>
            <Pressable hitSlop={8} onPress={() => setSticker({ kind: 'pr', name: r.name, kg: Math.round(r.kg), date: r.date })}>
              <Share2 size={15} color={C.faint} />
            </Pressable>
          </View>
        );
      })}
      <Text style={[s.muted, { marginTop: 8 }]}>{t('実重量ベースの最高記録（自重種目は体重込み）。共有アイコンでストーリー用の透過ステッカーを作れます。')}</Text>
      <ShareStickerModal data={sticker} visible={sticker != null} onClose={() => setSticker(null)} />
    </View>
  );
}

const s = themed(() => ({
  prRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  prName: { width: 96, fontSize: 13, fontWeight: '700', color: C.ink },
  prBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.track, overflow: 'hidden' },
  prBarFill: { height: 8, borderRadius: 4, backgroundColor: C.teal },
  prKg: { fontSize: 15, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  prUnit: { fontSize: 11, fontWeight: '600', color: C.sub },
  prNew: { fontSize: 11, fontWeight: '900', color: C.coral },
  prDate: { fontSize: 10.5, color: C.faint },
  pvChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  pvChip: { paddingHorizontal: 11, paddingVertical: 6 },
  pvChipOn: { backgroundColor: C.ink, borderColor: C.ink },
  pvChipT: { fontSize: 13, fontWeight: '700', color: C.sub },
  pvChipTOn: { color: C.panel },  // ink地の文字はダークで反転するため背景トークンで吸収
  pvHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 },
  pvNow: { fontSize: 21, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  pvUnit: { fontSize: 13, color: C.sub, fontWeight: '700' },
  pvDelta: { fontSize: 13, color: C.sub, fontWeight: '700' },
  pvBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 2 },
  pvBarCol: { flex: 1, alignItems: 'center' },
  pvBarTrack: { height: 92, width: '100%', justifyContent: 'flex-end' },
  pvBar: { width: '100%', borderRadius: 5, backgroundColor: C.teal },
  pvBarL: { fontSize: 11, color: C.faint, marginTop: 4, fontVariant: ['tabular-nums'] },
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: 20, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 14, marginBottom: 12 },
  h2: { fontSize: 17, fontWeight: '800', color: C.ink, marginBottom: 8 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  chips: { flexDirection: 'row', gap: 6, marginVertical: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { fontSize: 13, fontWeight: '700', color: C.sub },
  verdict: { fontSize: 13, fontWeight: '600', lineHeight: 19, marginTop: 4 },
  muted: { fontSize: 13, color: C.faint, marginTop: 4 },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 10, marginTop: 4 },
  kpi: { flex: 1, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 12 },
  weekNote: { fontSize: 11, fontWeight: '400', color: C.faint },
  // 連続記録の強調はアンバー。ダークでは明るいアンバーへ入れ替わる必要があるのでトークンで
  streak: { fontSize: 13, fontWeight: '800', color: C.amber },
  earnT: { fontSize: 13, fontWeight: '700', color: C.teal, marginTop: 2, lineHeight: 19 },
  balRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  balLabel: { width: 38, fontSize: 13, fontWeight: '700', color: C.sub, fontVariant: ['tabular-nums'] },
  balTrack: { flex: 1, height: 14, borderRadius: 7, backgroundColor: C.bg, flexDirection: 'row', overflow: 'hidden' },
  balMin: { width: 48, fontSize: 11, color: C.sub, textAlign: 'right', fontVariant: ['tabular-nums'] },
  balLegend: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, flexWrap: 'wrap' },
  legDot: { width: 8, height: 8, borderRadius: 4 },
  kpiL: { fontSize: 11, fontWeight: '700', color: C.sub },
  kpiV: { fontSize: 21, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginTop: 2 },
  kpiU: { fontSize: 13, color: C.sub, fontWeight: '600' },
  dayBox: { borderTopWidth: 0.5, borderTopColor: C.line, marginTop: 8, paddingTop: 8 },
  dayHead: { fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 4, fontVariant: ['tabular-nums'] },
  dayText: { fontSize: 15, color: C.ink, lineHeight: 21, paddingVertical: 3 },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 0.5, borderBottomColor: C.line },
  listT: { fontSize: 15, color: C.sub, fontWeight: '600' },
  viewToggle: { marginLeft: 6, marginTop: 8, width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  viewToggleT: { fontSize: 15, color: C.sub, fontWeight: '700' },
}));
