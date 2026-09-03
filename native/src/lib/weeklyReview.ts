// 週次レビュー（docs/STRATEGY.md §6「週末」・§7 N4）。
//
// 【なぜ純関数なのか】
// 戦略の狙いは「情報量ではなく、自分が前進している感覚を作る」こと。そのための評価文は
// **AIに書かせない**。理由は3つ:
//   ①コストがゼロ（週1回×全ユーザーぶんの生成は課金の重い側に来る）
//   ②オフライン・通信断でも必ず出る（日曜の夜に開いて空っぽ、が最悪の体験）
//   ③文章が毎回ぶれない（「今週はかなり良いペースです」の意味が週によって変わらない）
// だから週の要約（weekStats）→評価文（weeklyVerdict）→来週の目標1つ（nextWeekGoal）は
// すべて端末内の四則演算に閉じ、jestで文言まで固定する。
//
// 【非審判（§5 AIの人格）】
// 「達成できませんでした」「守れませんでした」「失敗」は一語も出さない。
// 停滞は失敗ではなく観察であり、記録が少ない週は「また開いてくれた」ほうが大事。
// 禁止語は __tests__/weeklyReview.test.tsx が全パターンに対して機械的に確認する。
//
// 【数字は主役ではない】
// この画面が大きく出すのは体重変化ひとつだけ。平均摂取・推定消費は小さく1行。
// 数字の一覧は既存の「週のふりかえり詳細（週間ダイジェスト＋カレンダー）」の役割で、
// この画面からは「くわしく見る」で渡す。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from './i18n';
import { WEEK_GOAL_KEY } from './achievements';
import type { DayFeature } from './features';

// ===== 日付ユーティリティ（月曜起点。achievements.weekKey / changes.weekStartOf2 と同じ定義） =====

const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

/** その日を含む週の月曜 */
export function weekStartOf(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return fmt(dt);
}

export function shiftDays(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return fmt(dt);
}

/** 月曜起点の曜日番号（0=月 … 6=日） */
export function dowOf(d: string): number {
  return (new Date(d + 'T00:00:00').getDay() + 6) % 7;
}

// ===== 入力 =====

/** 1日ぶんの材料。null=その日の値が無い（未記録・未連携）。0 と null を混ぜない */
export type WeekDayInput = {
  date: string;
  dow: number;                 // 0=月 … 6=日
  recorded: boolean;
  intake: number | null;       // 摂取kcal
  target: number | null;       // 目安kcal（BMR×生活係数＋運動加算＝アプリのモデル推定消費）
  over: number | null;         // 摂取−目安（+超過 / −赤字）
  protein: number | null;      // たんぱく質g
  weight: number | null;
  lateRatio: number | null;    // 21時以降に食べたkcalの比（0..1）。時刻つきkcalが無い日はnull
  steps: number | null;
  activeKcal: number | null;   // ヘルスケアのアクティブエネルギー実測
  pr: boolean;                 // その日に自己ベスト更新があった
};

export type WeekReviewInput = {
  today: string;
  weekStart: string;              // レビュー対象の週の月曜
  days: WeekDayInput[];           // 対象週の月〜日（未記録の日も置く＝7件）
  prevDays: WeekDayInput[];       // その前の週の7件
  bulk: boolean;                  // 増量目的（体重が増えるのが「前進」）
  bmr: number | null;             // 実測消費の土台（安静時）。ヘルスケアのアクティブに足す
  proteinGoalG: number | null;    // たんぱく質の1日目標g（goals.protein_per_kg×体重）
  stepsGoalPerDay: number | null; // 歩数の1日目標（週目標÷7でもよい）
  recordGoalDays: number;         // ソフト週目標（記録日数・未設定=7）
};

// ===== 閾値（意味はコメントに残す。判断の根拠が読めないと後から動かせない） =====

const PACE_TOO_FAST = 1.2;   // 週1.2kg超の前進は速すぎ（週1kgがguard.tsの上限・その少し上）
const PACE_FAST = 0.9;       // 週0.9〜1.2kgは「順調だが少し速め」
const PACE_GOOD = 0.3;       // 週0.3〜0.9kgは良いペース
const PACE_SLOW = 0.1;       // 週0.1〜0.3kgはゆっくり前進
const FLAT = 0.1;            // ±0.1kg未満は横ばい（1日の水分変動の範囲）
const BACK_BIG = 0.4;        // 逆方向へ0.4kg以上は「少し戻った」
const WEEKEND_GAP = 400;     // 週末の平均超過が平日より+400kcal以上なら「週末に増えた」
const LATE_RATIO = 0.25;     // 21時以降の比25%以上を「夜遅い食事の日」（slotsCardの注記と同じ25%）
const PROTEIN_HIT = 0.9;     // 目標の9割以上を「そろった」（laws.lift_protein_prと同じ基準）

// ===== 集計 =====

export type BurnSource = 'health' | 'weight' | 'model';

export type WeekStats = {
  weekStart: string;
  weekEnd: string;                 // 日曜
  today: string;
  isCurrentWeek: boolean;          // 対象週が今週か（見出しの「今週／先週」に効く）
  elapsed: number;                 // 対象週の経過日数（1..7）
  recordedDays: number;
  prevRecordedDays: number;
  avgIntake: number | null;
  prevAvgIntake: number | null;
  burnKcal: number | null;
  burnSource: BurnSource | null;
  weightDelta: number | null;      // 週初めの体重→週の最新の体重（kg・小数1桁）
  prevWeightDelta: number | null;
  goodDelta: number | null;        // 目的に照らした前進量（増量は+delta / それ以外は−delta）
  prevGoodDelta: number | null;
  bulk: boolean;
  overDays: number;
  weekdayRecorded: number;
  weekendRecorded: number;
  weekdayAvgOver: number | null;
  weekendAvgOver: number | null;
  weekdayStable: boolean;
  weekendBreak: boolean;
  proteinOkDays: number;
  proteinGoalG: number | null;
  hasProteinData: boolean;
  lateNightDays: number;
  hasLateData: boolean;
  stepsOkDays: number;
  stepsGoalPerDay: number | null;
  hasStepsData: boolean;
  weightDays: number;
  prDays: number;
  recordGoalDays: number;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
function avg(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** 週の体重変化: 週内の最初の記録→最後の記録。1つしか無い週はnull（変化を語れない） */
function deltaOf(days: WeekDayInput[]): number | null {
  const w = days.filter((d) => d.weight != null);
  if (w.length < 2) return null;
  return r1(Number(w[w.length - 1].weight) - Number(w[0].weight));
}

/**
 * 推定消費（1日あたり）。3つの出どころを優先順に選ぶ。
 *  ①health: 安静時(BMR)＋ヘルスケアのアクティブ実測。実測が3日以上ある週だけ
 *  ②weight: 体重変化から逆算（摂取 − 変化kg×7,200/日数）。エネルギー保存則そのもの
 *  ③model : 目安kcal（BMR×生活係数）の平均。材料が無い週の最後の砦
 * 「実測（ヘルスケア）と体重変化からの推定の両方があるなら実測優先」（N4の指定）。
 */
export function estimateBurn(days: WeekDayInput[], bmr: number | null, weightDelta: number | null): { kcal: number; source: BurnSource } | null {
  const actives = days.map((d) => d.activeKcal).filter((x): x is number => x != null);
  if (bmr != null && bmr > 0 && actives.length >= 3) {
    return { kcal: Math.round(bmr + actives.reduce((a, b) => a + b, 0) / actives.length), source: 'health' };
  }
  // 体重変化からの逆算は「最初の体重の日〜最後の体重の日」の区間で行う。
  // 分母を記録日数にすると、測った間隔と食べた日数がずれた週で1日あたりが歪む
  const wIdx = days.map((d, i) => (d.weight != null ? i : -1)).filter((i) => i >= 0);
  if (weightDelta != null && wIdx.length >= 2) {
    const span = wIdx[wIdx.length - 1] - wIdx[0];   // 経過日数（体重2点のあいだ）
    const intakes = days.slice(wIdx[0], wIdx[wIdx.length - 1] + 1)
      .map((d) => d.intake).filter((x): x is number => x != null);
    if (span >= 3 && intakes.length >= 3) {
      const meanIntake = intakes.reduce((a, b) => a + b, 0) / intakes.length;
      // 摂取 − 消費 = 変化kg × 7,200kcal / 経過日数 ⇒ 消費 = 摂取 − 変化kg × 7,200 / 経過日数
      const kcal = Math.round(meanIntake - (weightDelta * 7200) / span);
      // 生理的にありえない値（水分の急変で体重が跳ねた週）は採らずモデルへ落とす
      if (kcal > 800 && kcal < 6000) return { kcal, source: 'weight' };
    }
  }
  const modeled = avg(days.map((d) => d.target));
  return modeled == null ? null : { kcal: Math.round(modeled), source: 'model' };
}

/** 週の材料を1つの要約に畳む（この関数がこの機能の"事実"の正本） */
export function weekStats(input: WeekReviewInput): WeekStats {
  const { days, prevDays } = input;
  const weekEnd = shiftDays(input.weekStart, 6);
  const isCurrentWeek = weekStartOf(input.today) === input.weekStart;
  const elapsed = isCurrentWeek
    ? Math.min(7, Math.max(1, dowOf(input.today) + 1))
    : 7;
  // 経過ぶんだけを見る（未来の日を「記録が無い日」として数えない＝まだ失敗ではない）
  const seen = days.slice(0, elapsed);

  const recordedDays = seen.filter((d) => d.recorded).length;
  const weightDelta = deltaOf(seen);
  const prevWeightDelta = deltaOf(prevDays);
  const sign = input.bulk ? 1 : -1;   // 増量目的は「増えた」が前進（既存のbulk方針）
  const goodDelta = weightDelta == null ? null : r1(weightDelta * sign);
  const prevGoodDelta = prevWeightDelta == null ? null : r1(prevWeightDelta * sign);

  const weekday = seen.filter((d) => d.dow <= 4);
  const weekend = seen.filter((d) => d.dow >= 5);
  const weekdayAvgOver = avg(weekday.map((d) => d.over));
  const weekendAvgOver = avg(weekend.map((d) => d.over));
  const weekdayRecorded = weekday.filter((d) => d.recorded).length;
  const weekendRecorded = weekend.filter((d) => d.recorded).length;

  const proteinDays = seen.filter((d) => d.protein != null);
  const proteinOkDays = input.proteinGoalG == null ? 0
    : proteinDays.filter((d) => Number(d.protein) >= input.proteinGoalG! * PROTEIN_HIT).length;
  const lateDays = seen.filter((d) => d.lateRatio != null);
  const stepsDays = seen.filter((d) => d.steps != null);

  const burn = estimateBurn(seen, input.bmr, weightDelta);

  return {
    weekStart: input.weekStart,
    weekEnd,
    today: input.today,
    isCurrentWeek,
    elapsed,
    recordedDays,
    prevRecordedDays: prevDays.filter((d) => d.recorded).length,
    avgIntake: (() => { const a = avg(seen.map((d) => d.intake)); return a == null ? null : Math.round(a); })(),
    prevAvgIntake: (() => { const a = avg(prevDays.map((d) => d.intake)); return a == null ? null : Math.round(a); })(),
    burnKcal: burn?.kcal ?? null,
    burnSource: burn?.source ?? null,
    weightDelta, prevWeightDelta, goodDelta, prevGoodDelta,
    bulk: input.bulk,
    overDays: seen.filter((d) => d.over != null && d.over > 0).length,
    weekdayRecorded, weekendRecorded,
    weekdayAvgOver: weekdayAvgOver == null ? null : Math.round(weekdayAvgOver),
    weekendAvgOver: weekendAvgOver == null ? null : Math.round(weekendAvgOver),
    // 平日が安定＝平日4日以上の記録で、目安を超えた平日が1日以下
    weekdayStable: weekdayRecorded >= 4 && weekday.filter((d) => d.over != null && d.over > 0).length <= 1,
    // 週末に増えた＝週末の平均超過が平日より+400kcal以上（どちらの平均も取れる週だけ）
    weekendBreak: weekdayAvgOver != null && weekendAvgOver != null && weekendRecorded >= 1
      && weekendAvgOver - weekdayAvgOver >= WEEKEND_GAP,
    proteinOkDays,
    proteinGoalG: input.proteinGoalG,
    hasProteinData: proteinDays.length >= 3 && input.proteinGoalG != null,
    lateNightDays: lateDays.filter((d) => Number(d.lateRatio) >= LATE_RATIO).length,
    hasLateData: lateDays.length >= 3,
    stepsOkDays: input.stepsGoalPerDay == null ? 0
      : stepsDays.filter((d) => Number(d.steps) >= input.stepsGoalPerDay!).length,
    stepsGoalPerDay: input.stepsGoalPerDay,
    hasStepsData: stepsDays.length >= 3,
    weightDays: seen.filter((d) => d.weight != null).length,
    prDays: seen.filter((d) => d.pr).length,
    recordGoalDays: input.recordGoalDays,
  };
}

// ===== 評価文 =====

/** 評価文の見出し（1文目）のパターン。テストがこの一覧を網羅する */
export type VerdictHeadId =
  | 'no_record' | 'early_week' | 'few_records' | 'no_weight'
  | 'too_fast' | 'fast' | 'good_pace' | 'slow_progress' | 'plateau' | 'slight_back' | 'reversed';

/** 添える2文目（観察を1つだけ）。null=添えない */
export type VerdictDetailId =
  | 'weekday_stable' | 'weekend_break' | 'improved' | 'slipped'
  | 'late_night' | 'protein_good' | 'record_full' | 'pr' | null;

export type WeekVerdict = {
  headId: VerdictHeadId;
  detailId: VerdictDetailId;
  headline: string;
  detail: string | null;
  /** 表示用の全文（見出し＋観察） */
  text: string;
};

function headlineOf(w: WeekStats): { id: VerdictHeadId; text: string } {
  // ①記録そのものが少ない週は、体重の話をしない（数字で語れないし、語るべきでもない）
  if (w.recordedDays === 0) {
    return { id: 'no_record', text: t('今週はまだ記録がありません。今日の1行から、また始められます。') };
  }
  if (w.isCurrentWeek && w.elapsed <= 2) {
    return { id: 'early_week', text: t('今週はまだ始まったばかりです。ここから積み上げていけます。') };
  }
  if (w.recordedDays < 3) {
    return { id: 'few_records', text: t('今週は記録が少なめでした。数字よりも、また開いてくれたことのほうが大切です。') };
  }
  if (w.goodDelta == null) {
    return { id: 'no_weight', text: t('体重の記録がないので変化は出せませんが、食事はちゃんと残せています。') };
  }
  // ②体重の動きを、目的に照らした「前進量」で語る（増量目的なら増えたぶんが前進）
  const g = w.goodDelta;
  if (g >= PACE_TOO_FAST) {
    return { id: 'too_fast', text: t('今週は少しペースが速すぎました。急ぎすぎると筋肉も一緒に動くので、来週はゆるめて大丈夫です。') };
  }
  if (g >= PACE_FAST) {
    return { id: 'fast', text: t('今週は順調です。ただ少し速めなので、来週は同じか少しゆるめでちょうどよいペースです。') };
  }
  if (g >= PACE_GOOD) {
    return { id: 'good_pace', text: t('今週はかなり良いペースです。') };
  }
  if (g >= PACE_SLOW) {
    return { id: 'slow_progress', text: t('ゆっくりですが、ちゃんと前に進んでいます。') };
  }
  if (Math.abs(g) < FLAT) {
    return { id: 'plateau', text: t('体重は横ばいでした。停滞は悪いことではなく、体が今の量に慣れてきた合図です。') };
  }
  if (g <= -BACK_BIG) {
    return { id: 'reversed', text: t('今週は逆の方向に動きました。1週間単位ではまだ問題ありません。来週で十分に戻せます。') };
  }
  return { id: 'slight_back', text: t('今週は少しだけ戻りました。この幅は水分でも起きるので、来週の流れで見れば十分です。') };
}

function detailOf(w: WeekStats, headId: VerdictHeadId): { id: VerdictDetailId; text: string | null } {
  // 記録が薄い週・週の頭には観察を足さない（材料が無いのに言葉を増やさない）
  if (headId === 'no_record' || headId === 'early_week' || headId === 'few_records') return { id: null, text: null };
  // 順に見て、最初に当てはまった観察ひとつだけを添える（並べない）
  if (w.weekendBreak) {
    return { id: 'weekend_break', text: t('平日は安定していて、週末に増えたぶんが週の数字に出ています。') };
  }
  if (w.weekdayStable) {
    return { id: 'weekday_stable', text: t('特に平日の食事が安定しました。') };
  }
  if (w.goodDelta != null && w.prevGoodDelta != null && w.goodDelta - w.prevGoodDelta >= 0.3) {
    return { id: 'improved', text: t('先週よりも良い方向に動いています。') };
  }
  if (w.goodDelta != null && w.prevGoodDelta != null && w.goodDelta - w.prevGoodDelta <= -0.3) {
    return { id: 'slipped', text: t('先週よりは少しゆるみましたが、まだ十分に戻せる幅です。') };
  }
  if (w.hasLateData && w.lateNightDays >= 3) {
    return { id: 'late_night', text: t('夜21時以降の食事が{n}日ありました。時間を少し早めるだけで、翌朝の食欲が変わります。', { n: w.lateNightDays }) };
  }
  if (w.prDays > 0) {
    return { id: 'pr', text: t('トレーニングでは自己ベストが出ました。') };
  }
  if (w.hasProteinData && w.proteinOkDays >= 5) {
    return { id: 'protein_good', text: t('たんぱく質は{n}日そろいました。') };
  }
  if (w.recordedDays >= 7) {
    return { id: 'record_full', text: t('7日すべて記録できました。') };
  }
  return { id: null, text: null };
}

/**
 * 週の評価文（見出し1文＋観察1文）。
 * 「今週はかなり良いペースです。特に平日の食事が安定しました。」の型。
 * 採点も断定もしない。禁止語（達成できませんでした／失敗 等）はテストで固定する。
 */
export function weeklyVerdict(week: WeekStats): WeekVerdict {
  const head = headlineOf(week);
  const det = detailOf(week, head.id);
  const detail = det.id == null ? null : det.text;
  return {
    headId: head.id,
    detailId: det.id,
    headline: head.text,
    detail,
    text: detail ? `${head.text}${detail}` : head.text,
  };
}

// ===== 来週の目標を1つだけ =====

export type WeekGoalKind = 'record' | 'late' | 'protein' | 'steps' | 'weekend' | 'weight' | 'keep';

/** 保存する最小の形（文章は表示のたびに現在の言語で組み立て直す＝laws.tsと同じ流儀） */
export type SavedWeekGoal = {
  kind: WeekGoalKind;
  need: number;             // 目標の回数（週◯日 / 週◯回まで）
  param?: number;           // たんぱく質g・歩数などの水準
};

export type WeekGoal = SavedWeekGoal & {
  text: string;             // 「◯◯する。」
  reason: string;           // なぜこれを選んだか（1行）
};

// ソフト週目標（lib/achievements WEEK_GOAL_KEY）が受け付ける段。記録の目標はこの中から選ぶ＝
// 「来週の目標」と実績ページの「今週n/m日」が同じ数字になり、週の目標が2つに割れない
const RECORD_STEPS = [3, 4, 5, 7];

function nextRecordGoal(recordedDays: number): number {
  return RECORD_STEPS.find((n) => n > recordedDays) ?? 7;
}

/** 保存済みの目標から文章を作り直す（言語切替・翌週の進捗表示で使う） */
export function weekGoalText(g: SavedWeekGoal): string {
  switch (g.kind) {
    case 'protein': return t('たんぱく質{g}g以上の日を週{n}日にする。', { g: g.param ?? 0, n: g.need });
    case 'record': return t('記録を週{n}日つける。', { n: g.need });
    case 'late': return t('夜21時以降の食事を週{n}回までにする。', { n: g.need });
    case 'steps': return t('歩数{g}歩の日を週{n}日にする。', { g: (g.param ?? 0).toLocaleString(), n: g.need });
    case 'weekend': return t('土日の食事を平日と同じペースにする。');
    case 'weight': return t('体重を週{n}日はかる。', { n: g.need });
    case 'keep': return t('今週と同じペースを、来週も続ける。');
  }
}

/** 進捗の単位ラベル（「3/5日」の"日"／「1/2回」の"回"） */
export function weekGoalUnit(g: SavedWeekGoal): string {
  return g.kind === 'late' ? t('回') : t('日');
}

/**
 * 来週の目標を候補から1つだけ選ぶ。
 *
 * 【1つだけにする理由】3つ渡すと「どれもやらない」に落ちる。いちばん効くもの、かつ
 * いちばん手が届くものを1つに絞り、選んだ理由を添えて納得を作る（§6週末）。
 *
 * 【優先順位】土台（記録）→ 週の形を崩している要因（夜の食事・週末）→ 中身（たんぱく質・歩数）
 * → 材料が足りない（体重をはかる）→ 何も欠けていない週は「今のペースを続ける」。
 *
 * features は材料の有無を補うための任意入力（歩数・たんぱく質の列がそもそも無い端末で
 * 空振りの目標を出さないため）。week だけでも決められる。
 */
export function nextWeekGoal(week: WeekStats, features?: DayFeature[] | null): WeekGoal {
  const mk = (g: SavedWeekGoal, reason: string): WeekGoal => ({ ...g, text: weekGoalText(g), reason });
  // features が渡されたときは「その列を1日でも持っているか」を材料の有無に足す
  const hasSteps = week.hasStepsData || (features?.some((f) => f.steps != null) ?? false);
  const hasProtein = week.hasProteinData || (week.proteinGoalG != null && (features?.some((f) => f.protein_g != null) ?? false));

  // ①土台。記録が5日に届いていない週は、まずここ（ほかの数字は記録の上に乗っている）
  if (week.recordedDays < 5) {
    const need = nextRecordGoal(week.recordedDays);
    return mk({ kind: 'record', need },
      t('今週の記録は{n}日でした。まず土台が増えると、ほかの数字は自然に見えてきます。', { n: week.recordedDays }));
  }
  // ②週の形を崩している要因。夜遅い食事は翌朝の食欲まで連れてくるので先に置く
  if (week.hasLateData && week.lateNightDays >= 3) {
    const need = Math.max(1, week.lateNightDays - 1);
    return mk({ kind: 'late', need },
      t('夜21時以降の食事が今週{n}日ありました。1日ぶん早めるだけで、翌朝が軽くなります。', { n: week.lateNightDays }));
  }
  if (week.weekendBreak) {
    return mk({ kind: 'weekend', need: 2 },
      t('平日は安定していました。週末の2日だけ平日に寄せると、週の合計が変わります。'));
  }
  // ③中身。たんぱく質は「増やす」より「そろう日を増やす」ほうが続く
  if (hasProtein && week.proteinGoalG != null && week.proteinOkDays < 5) {
    const need = Math.min(7, week.proteinOkDays + 2);
    return mk({ kind: 'protein', need, param: Math.round(week.proteinGoalG) },
      t('たんぱく質がそろった日は今週{n}日でした。あと2日増えると、体重の落ち方に筋肉が残りやすくなります。', { n: week.proteinOkDays }));
  }
  if (hasSteps && week.stepsGoalPerDay != null && week.stepsOkDays < 4) {
    return mk({ kind: 'steps', need: Math.min(7, week.stepsOkDays + 2), param: week.stepsGoalPerDay },
      t('歩数が目標に届いた日は今週{n}日でした。食事を変えずに消費を足せるのが歩数です。', { n: week.stepsOkDays }));
  }
  // ④材料。体重が2日以下だと、来週も「変化」を出せない
  if (week.weightDays <= 2) {
    return mk({ kind: 'weight', need: 3 },
      t('体重の記録が{n}日でした。週3日あれば、来週の変化をちゃんと言葉にできます。', { n: week.weightDays }));
  }
  // ⑤何も欠けていない週。新しい宿題を足さないのがいちばん良い提案になる
  return mk({ kind: 'keep', need: week.recordedDays },
    t('今週は崩れたところがありませんでした。増やすより、同じことを続けるのが最短です。'));
}

// ===== 保存と進捗 =====

/** 週の目標の保存キー。`bl-week-goal:<その目標を実行する週の月曜>`
 *  （ソフト週目標の 'bl-week-goal' とは別キー。コロンで名前空間を分けている） */
export function weekGoalKey(weekStart: string): string {
  return `bl-week-goal:${weekStart}`;
}

/**
 * 目標を保存する。**kind==='record' のときは既存のソフト週目標（bl-week-goal）にも
 * 同じ日数を書く**。ここが「週の目標を二重に持たない」ための合流点で、実績ページの
 * 「今週 n/m日」・週の約束バッジ・この画面の進捗がすべて同じ数字を見る。
 */
export async function saveWeekGoal(weekStart: string, g: SavedWeekGoal): Promise<void> {
  const payload: SavedWeekGoal = { kind: g.kind, need: g.need, ...(g.param != null ? { param: g.param } : {}) };
  const writes: [string, string][] = [[weekGoalKey(weekStart), JSON.stringify(payload)]];
  if (g.kind === 'record' && RECORD_STEPS.includes(g.need)) writes.push([WEEK_GOAL_KEY, String(g.need)]);
  await AsyncStorage.multiSet(writes).catch(() => {});
}

export async function readWeekGoal(weekStart: string): Promise<SavedWeekGoal | null> {
  try {
    const raw = await AsyncStorage.getItem(weekGoalKey(weekStart));
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedWeekGoal;
    return v && typeof v.kind === 'string' && typeof v.need === 'number' ? v : null;
  } catch { return null; }
}

/**
 * 保存した目標の、その週の進捗（n/m）。kindごとに数える列を変える。
 * late は「週◯回まで」なので n=実績の回数（少ないほど良い）＝ over=true で色を変える。
 */
export function weekGoalProgress(g: SavedWeekGoal, days: WeekDayInput[]): { n: number; m: number; over: boolean } {
  const m = g.need;
  switch (g.kind) {
    case 'record': return { n: days.filter((d) => d.recorded).length, m, over: false };
    case 'weight': return { n: days.filter((d) => d.weight != null).length, m, over: false };
    case 'protein': {
      const goal = (g.param ?? 0) * PROTEIN_HIT;
      return { n: days.filter((d) => d.protein != null && Number(d.protein) >= goal).length, m, over: false };
    }
    case 'steps': {
      const goal = g.param ?? 0;
      return { n: days.filter((d) => d.steps != null && Number(d.steps) >= goal).length, m, over: false };
    }
    case 'late': {
      const n = days.filter((d) => d.lateRatio != null && Number(d.lateRatio) >= LATE_RATIO).length;
      return { n, m, over: n > m };
    }
    case 'weekend': {
      // 土日のうち、目安を超えなかった日を数える（2日そろえば達成）
      const we = days.filter((d) => d.dow >= 5 && d.recorded);
      return { n: we.filter((d) => d.over == null || d.over <= 0).length, m, over: false };
    }
    case 'keep': return { n: days.filter((d) => d.recorded).length, m, over: false };
  }
}

// ===== 材料の組み立て（日次特徴量 → 週の入力） =====

/**
 * レビュー対象の週を選ぶ。
 * 原則は「今週」。ただし週の頭（月・火）に開いたときは、終わったばかりの先週に
 * 3日以上の記録があるならそちらを振り返る（月曜の朝に空の今週を見せても前進を感じられない）。
 */
export function pickReviewWeek(features: DayFeature[], today: string): string {
  const thisWeek = weekStartOf(today);
  if (dowOf(today) > 1) return thisWeek;
  const lastWeek = shiftDays(thisWeek, -7);
  const n = features.filter((f) => f.date >= lastWeek && f.date < thisWeek && f.recorded).length;
  return n >= 3 ? lastWeek : thisWeek;
}

function dayFrom(f: DayFeature | undefined, date: string): WeekDayInput {
  return {
    date, dow: dowOf(date),
    recorded: f?.recorded ?? false,
    intake: f?.intake ?? null,
    target: f?.target ?? null,
    over: f?.over ?? null,
    protein: f?.protein_g ?? null,
    weight: f?.weight ?? null,
    lateRatio: f?.late_eating ?? null,
    steps: f?.steps ?? null,
    activeKcal: f?.active_kcal ?? null,
    pr: f?.pr ?? false,
  };
}

/** 週の7日ぶんを密に並べる（記録が無い日も置く。添字＝曜日で引けるほうが間違えにくい） */
export function weekDaysOf(features: DayFeature[], weekStart: string): WeekDayInput[] {
  const byDate = new Map(features.map((f) => [f.date, f]));
  return Array.from({ length: 7 }, (_, i) => {
    const d = shiftDays(weekStart, i);
    return dayFrom(byDate.get(d), d);
  });
}

/** 日次特徴量（lib/features）から週次レビューの入力を組む */
export function buildWeekReviewInput(features: DayFeature[], opts: {
  today: string;
  weekStart: string;
  bulk: boolean;
  bmr: number | null;
  proteinGoalG: number | null;
  stepsGoalPerDay: number | null;
  recordGoalDays: number;
}): WeekReviewInput {
  return {
    today: opts.today,
    weekStart: opts.weekStart,
    days: weekDaysOf(features, opts.weekStart),
    prevDays: weekDaysOf(features, shiftDays(opts.weekStart, -7)),
    bulk: opts.bulk,
    bmr: opts.bmr,
    proteinGoalG: opts.proteinGoalG,
    stepsGoalPerDay: opts.stepsGoalPerDay,
    recordGoalDays: opts.recordGoalDays,
  };
}
