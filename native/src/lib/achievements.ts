// 実績（バッジ）とストリークの判定。
//
// 方針:
//  ・判定に使うデータは本人のDB行（entries/logs/my_foods/ai_usage）＋端末カウンタ。
//  ・「獲得済み」はAsyncStorageに永続化（一度取ったバッジは条件から外れても消えない）。
//  ・ストリークには週1回の「お守り」（1日の抜けを週1回まで自動でつなぐ）。
//    失う恐怖だけのストリークは折れた瞬間に退会を招くため、毒抜きとして必須。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { todayJST } from './calc';
import { parseLiftText, effectiveKg, weightLookup } from './liftLog';
import { t } from './i18n';

const EARNED_KEY = 'bl-badges-earned';   // { [id]: 'YYYY-MM-DD' }
const REST_COUNT_KEY = 'bl-rest-count';  // レストタイマー起動回数（端末ローカル）

export type Badge = {
  id: string;
  emoji: string;
  name: string;
  desc: string;                 // 未獲得時に出す条件文
  cat: 'streak' | 'action' | 'result';
};

export type BadgeState = Badge & { earnedOn: string | null };

// ===== 日付ヘルパー =====
function shiftDate(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function weekKey(d: string): string {
  // 月曜はじまりの週キー
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * 記録ストリーク（お守り＝1日の抜けを週1回まで自動でつなぐ）。
 * recordedは記録がある日付の集合。todayが未記録でもストリークは切らない（今日はまだ終わっていない）。
 * 戻り値: { days, usedFreeze } usedFreeze=直近でお守りが効いた日（表示用・なければnull）
 */
export function calcStreak(recorded: Set<string>, today: string): { days: number; usedFreeze: string | null } {
  let days = 0;
  let usedFreeze: string | null = null;
  const freezeUsedWeeks = new Set<string>();
  let d = recorded.has(today) ? today : shiftDate(today, -1);
  // 今日も昨日も無いなら0（お守りは「連続の途中の1日」だけを救う）
  if (!recorded.has(d)) return { days: 0, usedFreeze: null };
  for (let i = 0; i < 1000; i++) {
    if (recorded.has(d)) {
      days++;
      d = shiftDate(d, -1);
      continue;
    }
    // 抜けた日: その週でまだお守り未使用＆さらに前日は記録がある（連続の途中）なら救済
    const wk = weekKey(d);
    if (!freezeUsedWeeks.has(wk) && recorded.has(shiftDate(d, -1))) {
      freezeUsedWeeks.add(wk);
      if (!usedFreeze) usedFreeze = d;
      d = shiftDate(d, -1);
      continue;
    }
    break;
  }
  return { days, usedFreeze };
}

/** 過去に一度でも折れて、その後30日以上つないだか（不死鳥） */
export function hadComeback(recordedSorted: string[], today: string): boolean {
  // 記録日を古い順に走査し、「2日以上の穴」の後に30日連続があればtrue
  let run = 1;
  for (let i = 1; i < recordedSorted.length; i++) {
    const gap = (Date.parse(recordedSorted[i]) - Date.parse(recordedSorted[i - 1])) / 86400000;
    if (gap <= 1) run++;
    else if (gap >= 3 && i > 5) run = 1;   // 折れた（お守りでも救えない穴）
    else run = 1;
    if (run >= 30 && i > 30) {
      // 折れた実績が手前にあるか
      for (let j = 1; j <= i - run + 1; j++) {
        const g = (Date.parse(recordedSorted[j]) - Date.parse(recordedSorted[j - 1])) / 86400000;
        if (g >= 3) return true;
      }
    }
  }
  return false;
}

// ===== バッジ定義 =====
export function badgeDefs(): Badge[] {
  return [
    // 継続
    { id: 'streak3', emoji: '🔥', name: t('種火'), desc: t('3日連続で記録する'), cat: 'streak' },
    { id: 'streak7', emoji: '🔥', name: t('焚き火'), desc: t('7日連続で記録する'), cat: 'streak' },
    { id: 'streak14', emoji: '🔥', name: t('かがり火'), desc: t('14日連続で記録する'), cat: 'streak' },
    { id: 'streak30', emoji: '🕯️', name: t('松明'), desc: t('30日連続で記録する'), cat: 'streak' },
    { id: 'streak60', emoji: '🏮', name: t('篝火の主'), desc: t('60日連続で記録する'), cat: 'streak' },
    { id: 'streak100', emoji: '🌋', name: t('百日行'), desc: t('100日連続で記録する'), cat: 'streak' },
    { id: 'phoenix', emoji: '🐦‍🔥', name: t('不死鳥'), desc: t('途切れたあと、もう一度30日つなぐ'), cat: 'streak' },
    { id: 'weekend4', emoji: '📅', name: t('週末も欠かさず'), desc: t('土日を含む週を4週連続で記録する'), cat: 'streak' },
    { id: 'morning14', emoji: '🌅', name: t('朝型'), desc: t('朝（10時まで）の記録を累計14日'), cat: 'streak' },
    // 行動
    { id: 'photo1', emoji: '📸', name: t('はじめての写真解析'), desc: t('写真から食事を解析する'), cat: 'action' },
    { id: 'photo30', emoji: '🎞️', name: t('カメラの達人'), desc: t('写真解析を累計30枚'), cat: 'action' },
    { id: 'coach10', emoji: '💬', name: t('相談上手'), desc: t('AI相談を累計10往復'), cat: 'action' },
    { id: 'coach100', emoji: '🧠', name: t('AIの相棒'), desc: t('AI相談を累計100往復'), cat: 'action' },
    { id: 'myfood5', emoji: '🥣', name: t('マイ食品コレクター'), desc: t('マイ食品を5個登録する'), cat: 'action' },
    { id: 'myfood20', emoji: '📚', name: t('自分だけの食品辞典'), desc: t('マイ食品を20個登録する'), cat: 'action' },
    { id: 'fullday', emoji: '💯', name: t('全部入りの一日'), desc: t('食事・運動・体重を同じ日に記録する'), cat: 'action' },
    { id: 'rest50', emoji: '⏱️', name: t('ジムの相棒'), desc: t('レストタイマーを累計50回使う'), cat: 'action' },
    { id: 'nolate7', emoji: '🌙', name: t('深夜ゼロ週間'), desc: t('21時以降の食事なしで7日間記録する'), cat: 'action' },
    // 成果
    { id: 'lost1', emoji: '⚖️', name: t('最初の1kg'), desc: t('開始時から体重-1kg'), cat: 'result' },
    { id: 'lost3', emoji: '🏅', name: t('-3kg'), desc: t('開始時から体重-3kg'), cat: 'result' },
    { id: 'lost5', emoji: '🏆', name: t('-5kg'), desc: t('開始時から体重-5kg'), cat: 'result' },
    { id: 'goal50', emoji: '⛰️', name: t('五合目'), desc: t('目標体重までの道のりの半分を越える'), cat: 'result' },
    { id: 'goal100', emoji: '🚩', name: t('登頂'), desc: t('目標体重に到達する'), cat: 'result' },
    { id: 'vol10t', emoji: '🐘', name: t('月間10トン'), desc: t('挙上ボリューム（重量×回数）が月間10t'), cat: 'result' },
    { id: 'vol20t', emoji: '🦏', name: t('月間20トン'), desc: t('挙上ボリュームが月間20t'), cat: 'result' },
    { id: 'km50', emoji: '🏃', name: t('月間50km'), desc: t('有酸素の距離が月間50km'), cat: 'result' },
    { id: 'km100', emoji: '🛣️', name: t('月間100km'), desc: t('有酸素の距離が月間100km'), cat: 'result' },
    { id: 'burn5000', emoji: '🔋', name: t('週5,000kcal'), desc: t('運動の消費が週に5,000kcal'), cat: 'result' },
    { id: 'pr5', emoji: '📈', name: t('記録更新×5'), desc: t('自己ベストを5回更新する'), cat: 'result' },
  ];
}

export async function bumpRestCount(): Promise<void> {
  try {
    const n = Number(await AsyncStorage.getItem(REST_COUNT_KEY)) || 0;
    await AsyncStorage.setItem(REST_COUNT_KEY, String(n + 1));
  } catch { /* 実績が遅れるだけ */ }
}

export type AchievementReport = {
  streak: number;
  usedFreeze: string | null;
  badges: BadgeState[];
  newIds: string[];   // 今回の評価で新たに獲得したもの
  // 「いつでも共有」用の素材（実績ページの共有ハブが使う）
  share: {
    today: { kcal: number; p: number; f: number; c: number } | null;
    workout: { label: string; kcal: number; minutes: number; km: number | null } | null;
    pr: { name: string; kg: number; date: string } | null;
  };
};

/** 全バッジを評価し、新規獲得を永続化して返す */
export async function evaluateAchievements(): Promise<AchievementReport> {
  const today = todayJST();
  const from400 = shiftDate(today, -400);

  const [entriesRes, logsRes, foodsRes, usageRes, goalRes, restRaw, earnedRaw] = await Promise.all([
    supabase.from('entries').select('date,intake,weight,p,f,c').gte('date', from400).order('date', { ascending: true }).limit(1000),
    supabase.from('logs').select('date,at,text,adj,ex_km,ex_minutes').gte('date', from400).order('date', { ascending: true }).limit(2000),
    supabase.from('my_foods').select('id').limit(50),
    supabase.from('ai_usage').select('photo_count,coach_count').limit(1000),
    supabase.from('goals').select('target_weight,start_weight').maybeSingle(),
    AsyncStorage.getItem(REST_COUNT_KEY),
    AsyncStorage.getItem(EARNED_KEY),
  ]);
  const entries = (entriesRes.data ?? []) as { date: string; intake: number | null; weight: number | null; p?: number | null; f?: number | null; c?: number | null }[];
  const logs = (logsRes.data ?? []) as { date: string; at: string | null; text: string; adj: number | null; ex_km: number | null; ex_minutes: number | null }[];
  const foodsN = (foodsRes.data ?? []).length;
  const photoN = (usageRes.data ?? []).reduce((a, r) => a + (Number((r as { photo_count?: number }).photo_count) || 0), 0);
  const coachN = (usageRes.data ?? []).reduce((a, r) => a + (Number((r as { coach_count?: number }).coach_count) || 0), 0);
  const restN = Number(restRaw) || 0;

  // 記録がある日（食事 or 体重 or 運動、どれかを書いた日）
  const recorded = new Set<string>();
  for (const e of entries) if (e.intake != null || e.weight != null) recorded.add(e.date);
  for (const r of logs) recorded.add(r.date);
  const recordedSorted = [...recorded].sort();

  const { days: streak, usedFreeze } = calcStreak(recorded, today);

  // 週末も欠かさず（直近4週）
  let weekend4 = true;
  for (let w = 0; w < 4; w++) {
    const base = shiftDate(weekKey(today), -7 * (w + 1)); // 先週から遡る（今週は進行中）
    const sat = shiftDate(base, 5), sun = shiftDate(base, 6);
    if (!recorded.has(sat) || !recorded.has(sun)) { weekend4 = false; break; }
  }
  // 朝型（10時までの記録がある日 累計14日）
  const morningDays = new Set(logs.filter((r) => r.at && new Date(r.at).getHours() < 10).map((r) => r.date)).size;
  // 全部入りの一日
  const exDays = new Set(logs.filter((r) => r.text.startsWith('🏋️') || r.text.startsWith('🏃')).map((r) => r.date));
  const fullday = entries.some((e) => e.intake != null && e.weight != null && exDays.has(e.date));
  // 深夜ゼロ週間: 直近7日すべて記録があり、21時以降の食事記録がない
  const last7 = Array.from({ length: 7 }, (_, i) => shiftDate(today, -i - 1));
  const lateDays = new Set(logs.filter((r) => r.at && new Date(r.at).getHours() >= 21 && !r.text.startsWith('🏋️') && !r.text.startsWith('🏃')).map((r) => r.date));
  const nolate7 = last7.every((d) => recorded.has(d) && !lateDays.has(d));

  // 体重系
  const weights = entries.filter((e) => e.weight != null).map((e) => ({ date: e.date, w: Number(e.weight) }));
  const startW = weights[0]?.w ?? null;
  const minW = weights.length ? Math.min(...weights.map((x) => x.w)) : null;
  const lost = startW != null && minW != null ? startW - minW : 0;
  const target = goalRes.data?.target_weight != null ? Number(goalRes.data.target_weight) : null;
  const gStart = goalRes.data?.start_weight != null ? Number(goalRes.data.start_weight) : startW;
  const goalHalf = target != null && gStart != null && minW != null && gStart > target
    ? minW <= gStart - (gStart - target) / 2 : false;
  const goalDone = target != null && minW != null ? minW <= target : false;

  // 筋トレボリューム（月別）と自己ベスト更新回数
  const wLookup = weightLookup(weights.map((x) => ({ date: x.date, weight: x.w })));
  const volByMonth = new Map<string, number>();
  const bestSoFar = new Map<string, { kg: number; date: string }>();
  let prCount = 0;
  for (const r of logs) {
    if (!r.text.startsWith('🏋️')) continue;
    for (const e2 of parseLiftText(r.text)) {
      const kg = effectiveKg(e2, wLookup(r.date));
      volByMonth.set(r.date.slice(0, 7), (volByMonth.get(r.date.slice(0, 7)) ?? 0) + kg * e2.reps * e2.sets);
      const prev = bestSoFar.get(e2.name)?.kg ?? 0;
      if (kg > prev) { bestSoFar.set(e2.name, { kg, date: r.date }); if (prev > 0) prCount++; }
    }
  }
  const maxVol = Math.max(0, ...volByMonth.values());
  // 有酸素の月間km・週間消費kcal
  const kmByMonth = new Map<string, number>();
  const kcalByWeek = new Map<string, number>();
  for (const r of logs) {
    if (r.ex_km != null) kmByMonth.set(r.date.slice(0, 7), (kmByMonth.get(r.date.slice(0, 7)) ?? 0) + Number(r.ex_km));
    if ((r.text.startsWith('🏃') || r.text.startsWith('🏋️')) && r.adj != null && Number(r.adj) > 0) {
      const wk = weekKey(r.date);
      kcalByWeek.set(wk, (kcalByWeek.get(wk) ?? 0) + Number(r.adj));
    }
  }
  const maxKm = Math.max(0, ...kmByMonth.values());
  const maxWeekKcal = Math.max(0, ...kcalByWeek.values());

  // ===== 判定 =====
  const ok: Record<string, boolean> = {
    streak3: streak >= 3, streak7: streak >= 7, streak14: streak >= 14,
    streak30: streak >= 30, streak60: streak >= 60, streak100: streak >= 100,
    phoenix: hadComeback(recordedSorted, today),
    weekend4, morning14: morningDays >= 14,
    photo1: photoN >= 1, photo30: photoN >= 30,
    coach10: coachN >= 10, coach100: coachN >= 100,
    myfood5: foodsN >= 5, myfood20: foodsN >= 20,
    fullday, rest50: restN >= 50, nolate7,
    lost1: lost >= 1, lost3: lost >= 3, lost5: lost >= 5,
    goal50: goalHalf, goal100: goalDone,
    vol10t: maxVol >= 10000, vol20t: maxVol >= 20000,
    km50: maxKm >= 50, km100: maxKm >= 100,
    burn5000: maxWeekKcal >= 5000, pr5: prCount >= 5,
  };

  // 永続化（獲得日は初回のみ記録）
  let earned: Record<string, string> = {};
  try { earned = JSON.parse(earnedRaw || '{}'); } catch { /* 壊れていたら作り直す */ }
  const newIds: string[] = [];
  for (const b of badgeDefs()) {
    if (ok[b.id] && !earned[b.id]) { earned[b.id] = today; newIds.push(b.id); }
  }
  if (newIds.length > 0) {
    try { await AsyncStorage.setItem(EARNED_KEY, JSON.stringify(earned)); } catch { /* 次回また拾う */ }
  }

  const badges: BadgeState[] = badgeDefs().map((b) => ({ ...b, earnedOn: earned[b.id] ?? null }));

  // ===== 「いつでも共有」用の素材 =====
  const todayEntry = entries.find((e) => e.date === today && e.intake != null);
  const lastWorkout = [...logs].reverse().find((r) => r.text.startsWith('🏃') || r.text.startsWith('🏋️')) ?? null;
  const wkKcal = lastWorkout
    ? (lastWorkout.adj != null && Number(lastWorkout.adj) > 0
      ? Math.round(Number(lastWorkout.adj))
      : Number(lastWorkout.text.match(/約([\d,]+)kcal/)?.[1]?.replace(/,/g, '') ?? 0))
    : 0;
  const wkMin = lastWorkout
    ? (lastWorkout.ex_minutes != null ? Number(lastWorkout.ex_minutes) : Number(lastWorkout.text.match(/(\d+)分/)?.[1] ?? 0))
    : 0;
  const prTop = [...bestSoFar.entries()].sort((a, b) => b[1].kg - a[1].kg)[0] ?? null;
  const share: AchievementReport['share'] = {
    today: todayEntry ? {
      kcal: Math.round(Number(todayEntry.intake)),
      p: Number(todayEntry.p) || 0, f: Number(todayEntry.f) || 0, c: Number(todayEntry.c) || 0,
    } : null,
    workout: lastWorkout ? {
      label: lastWorkout.text.replace(/^(🏋️|🏃)️?\s*/u, '').split(/[（(【]/)[0].trim().slice(0, 22) || t('ワークアウト'),
      kcal: wkKcal, minutes: wkMin,
      km: lastWorkout.ex_km != null ? Number(lastWorkout.ex_km) : null,
    } : null,
    pr: prTop ? { name: prTop[0], kg: Math.round(prTop[1].kg), date: prTop[1].date } : null,
  };

  return { streak, usedFreeze, badges, newIds, share };
}

// ===== 軽量ストリーク（食事タブの🔥チップ用。日付列だけの2クエリ＋5分キャッシュ） =====
let streakCache: { at: number; days: number } | null = null;
export async function quickStreak(): Promise<number> {
  if (streakCache && Date.now() - streakCache.at < 5 * 60_000) return streakCache.days;
  const today = todayJST();
  const from = shiftDate(today, -400);
  const [e, l] = await Promise.all([
    supabase.from('entries').select('date').gte('date', from).limit(1000),
    supabase.from('logs').select('date').gte('date', from).limit(2000),
  ]);
  const recorded = new Set<string>([
    ...((e.data ?? []) as { date: string }[]).map((r) => r.date),
    ...((l.data ?? []) as { date: string }[]).map((r) => r.date),
  ]);
  const { days } = calcStreak(recorded, today);
  streakCache = { at: Date.now(), days };
  return days;
}
/** 保存直後などにキャッシュを無効化して最新の🔥を出す */
export function invalidateStreak(): void { streakCache = null; }
