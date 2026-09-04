// 週次レビュー（docs/STRATEGY.md §6「週末」・§7 N4）。
//
// 【この画面の役割】数字を並べない。並べるのは既存の「週のふりかえり詳細」（週間ダイジェスト＋
// カレンダー）の仕事で、この画面は要約に徹する:
//   ①今週のBodyLog（期間） ②体重変化を大きく1つ ③平均摂取・推定消費を小さく1行ずつ
//   ④端末内の算術で作る評価文（AIを呼ばない＝コスト0・オフラインでも必ず出る）
//   ⑤来週の目標を1つだけ＋選んだ理由＋「この目標にする」
//   ⑥今週の収穫（バッジ・自己ベスト・新しい法則から最大2つ）
//   ⑦下部に「くわしく見る」→ 既存の数字の一覧へ
//
// 【演出は静かに】週次は毎週来るものなので祝祭にしない。体重の数字だけ軽く数え上げ、
// 触覚は開いた瞬間の1回だけ。reduceMotion では数え上げも即値になる（lib/motion）。
//
// 【王冠ゲート】既存の digest と同じ（src=digest）。無料プランでは見出しと体重変化までを見せ、
// 評価文と来週の目標を「スタンダードで開きます」の1枚に置き換える（ぼかさない＝law-detailと同じ流儀）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useThemeRefresh } from '@/lib/theme';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CalendarDays, ChevronRight, Sparkles, Target, TrendingUp, Trophy, BookOpen, Check } from 'lucide-react-native';
import { C, rgba, RADIUS, SPACE, ICON, HEAD, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { useGate } from '@/lib/gate';
import CrownBadge from '@/components/CrownBadge';
import BadgeIcon from '@/components/BadgeIcon';
import { useCountUp, useReduceMotion } from '@/lib/motion';
import { supabase } from '@/lib/supabase';
import { mifflinBMR, todayJST } from '@/lib/calc';
import { buildDayFeatures, type DayFeature } from '@/lib/features';
import { badgeById, WEEK_GOAL_KEY } from '@/lib/achievements';
import { latestLawRaw, lawText } from '@/lib/laws';
import { PROTEIN_PER_KG_DEFAULT } from '@/lib/goal';
import { getPurpose } from '@/lib/purpose';
import { WEEK_STEPS_GOAL_KEY } from '@/components/WeekStepsBar';
import {
  buildWeekReviewInput, nextWeekGoal, pickReviewWeek, readWeekGoal, saveWeekGoal,
  shiftDays, weekGoalProgress, weekGoalText, weekGoalUnit, weeklyVerdict, weekStats,
  type SavedWeekGoal, type WeekGoal, type WeekStats, type WeekVerdict, type WeekDayInput,
} from '@/lib/weeklyReview';

// 'YYYY-MM-DD' → '09/07'（アプリ全体の短い日付表記に合わせる）
const md = (d: string) => d.slice(5).replace('-', '/');

/** 今週の収穫（最大2つ）。バッジはメダル絵を流用し、他は小さな丸アイコンで並べる */
type Harvest =
  | { kind: 'badge'; id: string; title: string; sub: string }
  | { kind: 'pr'; title: string; sub: string }
  | { kind: 'law'; title: string; sub: string };

type Loaded = {
  week: WeekStats;
  verdict: WeekVerdict;
  goal: WeekGoal;
  /** 来週の目標を実行する週（＝対象週の翌週の月曜）。保存キーはこの週で持つ */
  goalWeek: string;
  /** 対象週の7日（保存済み目標の進捗を数えるのに使う） */
  days: WeekDayInput[];
  harvest: Harvest[];
  /** すでに保存済みの「この週にやる目標」（対象週の目標）＝翌週に見る進捗 */
  running: { goal: SavedWeekGoal; n: number; m: number; over: boolean } | null;
};

export default function WeeklyReviewScreen() {
  useThemeRefresh(); // テーマ変更で再描画（再マウントはしない・lib/theme.ts）
  const router = useRouter();
  const gate = useGate();
  const locked = gate.gated('digest');
  const reduce = useReduceMotion();
  const [data, setData] = useState<Loaded | null>(null);
  const [saved, setSaved] = useState(false);
  const hapticDone = useRef(false);

  const load = useCallback(async () => {
    const today = todayJST();
    let features: DayFeature[] = [];
    try { features = await buildDayFeatures(90); } catch { /* 通信断でもキャッシュ分で組む */ }
    const weekStart = pickReviewWeek(features, today);

    // ===== 目標の水準（たんぱく質・歩数・記録日数）を集める =====
    let bmr: number | null = null;
    let proteinGoalG: number | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const [prof, goalRow] = await Promise.all([
          supabase.from('profiles').select('sex,height_cm,age').eq('id', session.user.id).maybeSingle(),
          supabase.from('goals').select('protein_per_kg').maybeSingle(),
        ]);
        const weights = features.filter((f) => f.weight != null);
        const w = weights.length ? Number(weights[weights.length - 1].weight) : null;
        const p = prof.data as { sex: 'male' | 'female'; height_cm: number; age: number } | null;
        if (p && w != null) bmr = Math.round(mifflinBMR(p.sex, w, Number(p.height_cm), Number(p.age)));
        if (w != null) {
          const perKg = Number((goalRow.data as { protein_per_kg?: number | null } | null)?.protein_per_kg) || PROTEIN_PER_KG_DEFAULT;
          proteinGoalG = Math.round(w * perKg);
        }
      }
    } catch { /* プロフィールが引けなくても週の要約は出す（推定消費がモデル値に落ちるだけ） */ }

    const kv = await AsyncStorage.multiGet([WEEK_GOAL_KEY, WEEK_STEPS_GOAL_KEY]).catch(() => []);
    const recordGoalDays = Number(kv?.[0]?.[1]) || 7;
    const weekSteps = Number(kv?.[1]?.[1]) || 0;
    // 歩数は週目標しか持っていないので1日あたりへ割る（オフ=null＝歩数の目標は候補に出さない）
    const stepsGoalPerDay = weekSteps > 0 ? Math.round(weekSteps / 7) : null;

    const input = buildWeekReviewInput(features, {
      today, weekStart,
      bulk: getPurpose() === 'bulk',
      bmr, proteinGoalG, stepsGoalPerDay, recordGoalDays,
    });
    const week = weekStats(input);
    const goalWeek = shiftDays(weekStart, 7);

    // ===== 今週の収穫（最大2つ・優先はバッジ→自己ベスト→新しい法則） =====
    const harvest: Harvest[] = [];
    try {
      const earned = JSON.parse((await AsyncStorage.getItem('bl-badges-earned')) || '{}') as Record<string, string>;
      for (const [id, on] of Object.entries(earned)) {
        if (on < weekStart || on > week.weekEnd) continue;
        const b = badgeById(id);
        if (b) harvest.push({ kind: 'badge', id, title: b.name, sub: t('バッジを獲得') });
      }
    } catch { /* 収穫は飾り。読めなければ並べない */ }
    if (week.prDays > 0) harvest.push({ kind: 'pr', title: t('自己ベストを更新'), sub: t('今週{n}日', { n: week.prDays }) });
    try {
      const law = await latestLawRaw();
      if (law && law.foundAt >= weekStart && law.foundAt <= week.weekEnd) {
        harvest.push({ kind: 'law', title: lawText(law.kind, law.p).title, sub: t('新しい法則が見つかりました') });
      }
    } catch { /* 同上 */ }

    // ===== 先週この画面で決めた目標の進捗（＝いま振り返っている週の目標） =====
    let running: Loaded['running'] = null;
    const cur = await readWeekGoal(weekStart);
    if (cur) {
      const pr = weekGoalProgress(cur, input.days);
      running = { goal: cur, ...pr };
    }

    setData({
      week, verdict: weeklyVerdict(week), goal: nextWeekGoal(week, features),
      goalWeek, days: input.days, harvest: harvest.slice(0, 2), running,
    });
    setSaved((await readWeekGoal(goalWeek)) != null);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 触覚は開いた瞬間の1回だけ（軽い成功感。週次は静かに）
  useEffect(() => {
    if (data == null || hapticDone.current) return;
    hapticDone.current = true;
    if (!reduce) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [data, reduce]);

  // 体重変化の数え上げ（0.1kg刻みなので10倍の整数で数え、表示で戻す）
  const deltaTarget = data?.week.weightDelta == null ? 0 : Math.round(Math.abs(data.week.weightDelta) * 10);
  const deltaCount = useCountUp(deltaTarget, 600);

  async function chooseGoal() {
    if (data == null) return;
    Haptics.selectionAsync().catch(() => {});
    await saveWeekGoal(data.goalWeek, data.goal);
    setSaved(true);
  }

  const header = (
    <Stack.Screen options={{
      headerShown: true, title: '', headerBackTitle: t('戻る'),
      headerTintColor: C.teal, headerShadowVisible: false, headerStyle: { backgroundColor: C.bg },
    }} />
  );

  if (data == null) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {header}
        <ActivityIndicator color={C.teal} style={{ marginTop: 60 }} />
      </View>
    );
  }

  const { week, verdict, goal, harvest, running } = data;
  const dW = week.weightDelta;
  const good = week.goodDelta;
  // 前進しているか（増量目的なら増えたぶんが前進）。±0.1kg未満は水分の範囲なので中立の色
  const tone = good == null || Math.abs(good) < 0.1 ? C.ink : good > 0 ? C.successInk : C.coral;
  const shown = (deltaCount / 10).toFixed(1);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {header}
      <ScrollView contentContainerStyle={s.scroll}>
        {/* ① 見出し＋期間（月〜日） */}
        <Text style={s.kicker}>{week.isCurrentWeek ? t('今週のBodyLog') : t('先週のBodyLog')}</Text>
        <View style={s.periodRow}>
          <CalendarDays size={ICON.sm} color={C.sub} />
          <Text style={s.period}>{t('{a}〜{b}の7日間', { a: md(week.weekStart), b: md(week.weekEnd) })}</Text>
        </View>

        {/* ② 体重変化を主役に大きく1つ。数字はこの画面でここだけが大きい */}
        <View style={s.hero}>
          {dW == null ? (
            <>
              <Text style={[s.heroVal, { color: C.faint }]} maxFontSizeMultiplier={1.2}>—</Text>
              <Text style={s.heroLabel}>{t('体重の記録が2日あると、ここに変化が出ます')}</Text>
            </>
          ) : (
            <>
              <Text style={[s.heroVal, { color: tone }]} maxFontSizeMultiplier={1.2}>
                {dW > 0 ? '+' : dW < 0 ? '−' : ''}{shown}<Text style={s.heroUnit}>kg</Text>
              </Text>
              <Text style={s.heroLabel}>{t('今週の体重の変化')}</Text>
            </>
          )}
        </View>

        {/* ③ 平均摂取・推定消費は小さく1行ずつ（主役の隣に置かない） */}
        <View style={s.factRow}>
          <Text style={s.factLabel}>{t('平均摂取')}</Text>
          <Text style={s.factVal}>{week.avgIntake != null ? t('{n}kcal', { n: week.avgIntake.toLocaleString() }) : '—'}</Text>
        </View>
        <View style={s.factRow}>
          <Text style={s.factLabel}>{t('推定消費')}</Text>
          <Text style={s.factVal}>{week.burnKcal != null ? t('{n}kcal', { n: week.burnKcal.toLocaleString() }) : '—'}</Text>
        </View>
        {/* 推定消費の出どころを1行だけ添える（実測があるならそれを使ったことを隠さない） */}
        {week.burnSource != null && (
          <Text style={s.factNote}>
            {week.burnSource === 'health' ? t('ヘルスケアの実測（安静時＋活動）から')
              : week.burnSource === 'weight' ? t('今週の体重変化と摂取から逆算')
                : t('あなたの目安カロリーから')}
          </Text>
        )}

        {locked ? (
          // 王冠ゲート: 評価文と来週の目標をカード1枚に置き換える（見出しと体重変化までは見せる）
          <Pressable style={s.gateCard} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push('/paywall?src=digest' as never); }}>
            <CrownBadge size={18} />
            <Text style={s.gateT}>{t('スタンダードで開きます')}</Text>
            <Text style={s.gateSub}>{t('今週の評価と「来週の目標を1つだけ」はスタンダードで読めます。')}</Text>
            <View style={s.gateCta}><Text style={s.gateCtaT}>{t('プランを見る')}</Text></View>
          </Pressable>
        ) : (
          <>
            {/* ④ 評価文（端末内の算術。AIは呼ばない） */}
            <View style={s.verdictCard}>
              <View style={s.cardHead}>
                <Sparkles size={ICON.md} color={C.teal} />
                <Text style={s.cardHeadT}>{t('今週はこんな週でした')}</Text>
              </View>
              <Text style={s.verdictT}>{verdict.text}</Text>
            </View>

            {/* ⑤ 来週の目標を1つだけ＋選んだ理由 */}
            <View style={s.goalCard}>
              <View style={s.cardHead}>
                <Target size={ICON.md} color={C.accentInk} />
                <Text style={s.cardHeadT}>{t('来週の目標は、これ1つだけ')}</Text>
              </View>
              <Text style={s.goalT}>{goal.text}</Text>
              <Text style={s.goalReason}>{goal.reason}</Text>
              {saved ? (
                <View style={s.goalDone}>
                  <Check size={ICON.sm} color={C.successInk} strokeWidth={ICON.strokeBold} />
                  <Text style={s.goalDoneT}>{t('来週の目標にしました')}</Text>
                </View>
              ) : (
                <Pressable style={({ pressed }) => [s.goalBtn, pressed && { opacity: 0.85 }]} onPress={chooseGoal}>
                  <Text style={s.goalBtnT}>{t('この目標にする')}</Text>
                </Pressable>
              )}
            </View>

            {/* 先週この画面で決めた目標の進捗（この週にやると決めたぶん） */}
            {running && (
              <View style={s.runCard}>
                <Text style={s.runT}>{weekGoalText(running.goal)}</Text>
                <Text style={[s.runN, running.over && { color: C.amber }]}>
                  {t('{n}/{m}{u}', { n: running.n, m: running.m, u: weekGoalUnit(running.goal) })}
                </Text>
              </View>
            )}

            {/* ⑥ 今週の収穫（最大2つ。バッジのメダル絵を流用する） */}
            {harvest.length > 0 && (
              <View style={s.harvestWrap}>
                <Text style={s.sectionH}>{t('今週の収穫')}</Text>
                {harvest.map((h, i) => (
                  <View key={`${h.kind}-${i}`} style={s.harvestRow}>
                    {h.kind === 'badge'
                      ? <BadgeIcon id={h.id} size={38} earned />
                      : (
                        <View style={s.harvestIcon}>
                          {h.kind === 'pr' ? <Trophy size={ICON.md} color={C.teal} /> : <BookOpen size={ICON.md} color={C.teal} />}
                        </View>
                      )}
                    <View style={{ flex: 1 }}>
                      <Text style={s.harvestT} numberOfLines={2}>{h.title}</Text>
                      <Text style={s.harvestSub}>{h.sub}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ⑦ 数字の一覧は既存の詳細ページの役割。ここからは入口だけを渡す */}
        <Pressable style={({ pressed }) => [s.moreRow, pressed && { backgroundColor: C.pressed }]}
                   onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push('/(tabs)/changes?open=week' as never); }}>
          <TrendingUp size={ICON.md} color={C.teal} />
          <View style={{ flex: 1 }}>
            <Text style={s.moreT}>{t('くわしく見る')}</Text>
            <Text style={s.moreSub}>{t('記録日数・先週比・平均収支・カレンダー')}</Text>
          </View>
          <ChevronRight size={ICON.lg} color={C.faint} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = themed(() => ({
  scroll: { padding: SPACE.screen, paddingBottom: 48 },
  kicker: { fontSize: 13, fontWeight: '800', color: C.accentInk, letterSpacing: 0.4 },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  period: { fontSize: 13, color: C.sub },

  // 主役の体重変化
  hero: { alignItems: 'center', paddingVertical: 26, marginTop: 12, marginBottom: 6 },
  heroVal: { fontSize: 56, fontWeight: '800', color: C.ink, letterSpacing: -1 },
  heroUnit: { fontSize: 22, fontWeight: '800', color: C.sub },
  heroLabel: { fontSize: 13, color: C.sub, marginTop: 6, textAlign: 'center' },

  // 小さく1行ずつの事実
  factRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.line },
  factLabel: { fontSize: 13, color: C.sub },
  factVal: { fontSize: 14, fontWeight: '700', color: C.ink },
  factNote: { fontSize: 11, color: C.faint, marginTop: 6 },

  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  cardHeadT: { ...HEAD.card, color: C.ink },

  verdictCard: { backgroundColor: C.panel, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.hairline, padding: SPACE.card, marginTop: 18 },
  verdictT: { fontSize: 16, lineHeight: 25, color: C.ink, fontWeight: '600' },

  goalCard: { backgroundColor: C.accentSoft, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.accentBorder, padding: SPACE.card, marginTop: 12 },
  goalT: { fontSize: 18, fontWeight: '800', color: C.ink, lineHeight: 27 },
  goalReason: { fontSize: 13, color: C.sub, lineHeight: 19, marginTop: 6 },
  goalBtn: { backgroundColor: C.teal, borderRadius: RADIUS.input, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  goalBtnT: { fontSize: 15, fontWeight: '800', color: '#fff' },  // アクセント塗り面の上の白文字（追従しない固定色）
  goalDone: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14, paddingVertical: 12, borderRadius: RADIUS.input, backgroundColor: C.successWeak },
  goalDoneT: { fontSize: 14, fontWeight: '800', color: C.successInk },

  runCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.panel, borderRadius: RADIUS.panel, borderWidth: 1, borderColor: C.hairline, paddingVertical: 11, paddingHorizontal: 14, marginTop: 10 },
  runT: { flex: 1, fontSize: 13, color: C.sub },
  runN: { fontSize: 14, fontWeight: '800', color: C.accentInk },

  sectionH: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 20, marginBottom: 8 },
  harvestWrap: { marginTop: 2 },
  harvestRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel, borderRadius: RADIUS.panel, borderWidth: 1, borderColor: C.hairline, padding: 12, marginBottom: 8 },
  harvestIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.tealWeak, alignItems: 'center', justifyContent: 'center' },
  harvestT: { fontSize: 14, fontWeight: '800', color: C.ink },
  harvestSub: { fontSize: 12, color: C.sub, marginTop: 2 },

  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.panel, borderRadius: RADIUS.panel, borderWidth: 1, borderColor: C.hairline, padding: 14, marginTop: 22 },
  moreT: { fontSize: 15, fontWeight: '800', color: C.ink },
  moreSub: { fontSize: 12, color: C.sub, marginTop: 2 },

  gateCard: { alignItems: 'center', gap: 6, backgroundColor: C.panel, borderWidth: 1, borderColor: rgba(C.amber, 0.35), borderRadius: RADIUS.card, padding: 22, marginTop: 18 },
  gateT: { fontSize: 16, fontWeight: '800', color: C.ink, marginTop: 4 },
  gateSub: { fontSize: 13, color: C.sub, lineHeight: 19, textAlign: 'center' },
  gateCta: { backgroundColor: C.teal, borderRadius: RADIUS.input, paddingVertical: 11, paddingHorizontal: 24, marginTop: 10 },
  gateCtaT: { fontSize: 14, fontWeight: '800', color: '#fff' },  // 同上（固定色）
}));
