// 週次レビュー（docs/STRATEGY.md §7 N4）の固定テスト。
//
// ここで守るもの:
//  ①weeklyVerdict のパターン網羅（見出し11種＋観察8種）。分岐が消えたら落ちる
//  ②**非審判の文言**（「達成できませんでした」等の禁止語が一語も出ない）。人格は §5 の核なので
//    実装の善意ではなくテストで固定する
//  ③nextWeekGoal が候補から1つだけ選ぶこと・選んだ理由が付くこと・既存のソフト週目標と
//    同じ日数の段（3/4/5/7）に乗ること＝週の目標が2つに割れないこと
//  ④推定消費の出どころの優先順（実測 > 体重変化からの逆算 > モデル）
//  ⑤画面がマウントできること（白画面事故の検出）
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import WeeklyReviewScreen from '../app/weekly-review';
import { nextWeeklyReviewAt } from '@/lib/notify';
import {
  buildWeekReviewInput, estimateBurn, nextWeekGoal, pickReviewWeek, shiftDays,
  weekDaysOf, weekGoalProgress, weekGoalText, weekGoalUnit, weekStats, weeklyVerdict,
  weekStartOf, dowOf,
  type WeekDayInput, type WeekReviewInput, type WeekStats,
} from '@/lib/weeklyReview';
import { emptyDayFeature, type DayFeature } from '@/lib/features';

// ===== テスト用の週の組み立て =====
// 2026-08-31(月)〜2026-09-06(日) を対象週、today=日曜（週が終わった状態）で回す
const WEEK = '2026-08-31';
const SUNDAY = '2026-09-06';

type DayOpts = Partial<Omit<WeekDayInput, 'date' | 'dow'>>;

function day(i: number, o: DayOpts = {}): WeekDayInput {
  return {
    date: shiftDays(WEEK, i), dow: i,
    recorded: o.recorded ?? true,
    intake: o.intake ?? 2000,
    target: o.target ?? 2400,
    over: o.over ?? (o.intake ?? 2000) - (o.target ?? 2400),
    protein: o.protein ?? null,
    weight: o.weight ?? null,
    lateRatio: o.lateRatio ?? null,
    steps: o.steps ?? null,
    activeKcal: o.activeKcal ?? null,
    pr: o.pr ?? false,
  };
}

/** 7日ぶん。opts[i] で個別に上書きする */
function week(opts: Record<number, DayOpts> = {}, base: DayOpts = {}): WeekDayInput[] {
  return Array.from({ length: 7 }, (_, i) => day(i, { ...base, ...(opts[i] ?? {}) }));
}

function input(over: Partial<WeekReviewInput> = {}): WeekReviewInput {
  return {
    today: SUNDAY, weekStart: WEEK,
    days: week(), prevDays: [],
    bulk: false, bmr: null, proteinGoalG: null, stepsGoalPerDay: null, recordGoalDays: 7,
    ...over,
  };
}

/** 体重が weightStart → weightEnd に動いた週（月曜と日曜に体重あり） */
function weightWeek(from: number, to: number, opts: Record<number, DayOpts> = {}): WeekDayInput[] {
  return week({ 0: { weight: from }, 3: { weight: (from + to) / 2 }, 6: { weight: to }, ...opts });
}

const st = (over: Partial<WeekReviewInput> = {}): WeekStats => weekStats(input(over));

// ===== ① 見出しのパターン網羅 =====

describe('weeklyVerdict の見出しパターン', () => {
  const cases: [string, string, Partial<WeekReviewInput>][] = [
    ['no_record', '記録ゼロの週', { days: week({}, { recorded: false, intake: null, over: null }) }],
    ['early_week', '週の頭（火曜まで）', { today: '2026-09-01', days: week({ 0: { weight: 80 } }) }],
    ['few_records', '記録2日', { days: week({ 2: { recorded: false, intake: null, over: null }, 3: { recorded: false, intake: null, over: null }, 4: { recorded: false, intake: null, over: null }, 5: { recorded: false, intake: null, over: null }, 6: { recorded: false, intake: null, over: null } }) }],
    ['no_weight', '体重の記録なし', { days: week() }],
    ['too_fast', '週1.4kg減', { days: weightWeek(80, 78.6) }],
    ['fast', '週1.0kg減', { days: weightWeek(80, 79.0) }],
    ['good_pace', '週0.5kg減', { days: weightWeek(80, 79.5) }],
    ['slow_progress', '週0.2kg減', { days: weightWeek(80, 79.8) }],
    ['plateau', '横ばい', { days: weightWeek(80, 80) }],
    ['slight_back', '0.2kg増', { days: weightWeek(80, 80.2) }],
    ['reversed', '0.6kg増', { days: weightWeek(80, 80.6) }],
  ];
  for (const [id, label, over] of cases) {
    it(`${label} → ${id}`, () => {
      const v = weeklyVerdict(st(over));
      expect(v.headId).toBe(id);
      expect(v.headline.length).toBeGreaterThan(4);
      expect(v.text.startsWith(v.headline)).toBe(true);
    });
  }

  it('見出しは11パターンすべて別の文章（同じ文が2つの分岐に付いていない）', () => {
    const texts = cases.map(([, , over]) => weeklyVerdict(st(over)).headline);
    expect(new Set(texts).size).toBe(cases.length);
  });

  it('増量目的では符号の意味が反転する（増えたぶんが前進）', () => {
    const gain = { days: weightWeek(80, 80.5) };
    expect(weeklyVerdict(st({ ...gain, bulk: true })).headId).toBe('good_pace');
    expect(weeklyVerdict(st(gain)).headId).toBe('reversed');
  });
});

// ===== ② 観察（2文目）のパターン網羅 =====

describe('weeklyVerdict の観察パターン', () => {
  it('weekday_stable: 平日が目安内で安定', () => {
    const v = weeklyVerdict(st({ days: weightWeek(80, 79.5) }));
    expect(v.detailId).toBe('weekday_stable');
    expect(v.text).toContain('平日');
  });

  it('weekend_break: 週末だけ大きく増えた', () => {
    const days = weightWeek(80, 79.5, { 5: { intake: 3600 }, 6: { intake: 3600, weight: 79.5 } });
    expect(weeklyVerdict(st({ days })).detailId).toBe('weekend_break');
  });

  it('improved: 先週より前進が大きい', () => {
    const days = weightWeek(80, 79.5, { 1: { intake: 2600 }, 2: { intake: 2600 } });
    const prev = week({ 0: { weight: 81 }, 6: { weight: 81 } });
    expect(weeklyVerdict(st({ days, prevDays: prev })).detailId).toBe('improved');
  });

  it('slipped: 先週より前進が小さい', () => {
    const days = weightWeek(80, 80, { 1: { intake: 2600 }, 2: { intake: 2600 } });
    const prev = week({ 0: { weight: 81 }, 6: { weight: 80.2 } });
    const v = weeklyVerdict(st({ days, prevDays: prev }));
    expect(v.detailId).toBe('slipped');
    expect(v.text).not.toContain('失敗');
  });

  it('late_night: 夜21時以降が3日以上', () => {
    const days = weightWeek(80, 79.5, {
      1: { intake: 2600, lateRatio: 0.4 }, 2: { intake: 2600, lateRatio: 0.4 },
      3: { intake: 2600, lateRatio: 0.4, weight: 79.8 }, 4: { lateRatio: 0.0 },
      5: { lateRatio: 0.0 }, 6: { lateRatio: 0.0, weight: 79.5 },
    });
    const v = weeklyVerdict(st({ days }));
    expect(v.detailId).toBe('late_night');
    expect(v.text).toContain('3');
  });

  it('pr: 自己ベスト更新があった', () => {
    const days = weightWeek(80, 79.5, { 1: { intake: 2600 }, 2: { intake: 2600, pr: true } });
    expect(weeklyVerdict(st({ days })).detailId).toBe('pr');
  });

  it('protein_good: たんぱく質が5日そろった', () => {
    const days = weightWeek(80, 79.5, { 1: { intake: 2600 }, 2: { intake: 2600 } }).map((d) => ({ ...d, protein: 170 }));
    expect(weeklyVerdict(st({ days, proteinGoalG: 160 })).detailId).toBe('protein_good');
  });

  it('record_full: 7日すべて記録（ほかに言うことが無い週）', () => {
    const days = weightWeek(80, 79.5, { 1: { intake: 2600 }, 2: { intake: 2600 }, 4: { intake: 2600 } });
    expect(weeklyVerdict(st({ days })).detailId).toBe('record_full');
  });

  it('記録が薄い週・週の頭には観察を足さない', () => {
    expect(weeklyVerdict(st({ days: week({}, { recorded: false, intake: null, over: null }) })).detailId).toBeNull();
    expect(weeklyVerdict(st({ today: '2026-09-01' })).detailId).toBeNull();
  });
});

// ===== ③ 非審判（禁止語） =====

describe('非審判トーン（§5 AIの人格）', () => {
  // 「採点しない・責めない」。1語でも混ざったら落とす
  const BANNED = [
    '達成できませんでした', '達成できず', '守れませんでした', '守れず', '失敗',
    'サボ', 'ダメ', '怠', '努力不足', '意志', '言い訳', '罰', '最悪', 'できていません',
  ];
  const ALL_CASES: Partial<WeekReviewInput>[] = [
    { days: week({}, { recorded: false, intake: null, over: null }) },
    { today: '2026-09-01' },
    { days: week({ 2: { recorded: false, intake: null, over: null }, 3: { recorded: false, intake: null, over: null }, 4: { recorded: false, intake: null, over: null }, 5: { recorded: false, intake: null, over: null }, 6: { recorded: false, intake: null, over: null } }) },
    { days: week() },
    { days: weightWeek(80, 78.4) },
    { days: weightWeek(80, 79.0) },
    { days: weightWeek(80, 79.5) },
    { days: weightWeek(80, 79.8) },
    { days: weightWeek(80, 80) },
    { days: weightWeek(80, 80.2) },
    { days: weightWeek(80, 80.8) },
    { days: weightWeek(80, 79.5, { 5: { intake: 3600 }, 6: { intake: 3600, weight: 79.5 } }) },
    { days: weightWeek(80, 80), prevDays: week({ 0: { weight: 81 }, 6: { weight: 80.2 } }) },
    { days: weightWeek(80, 79.5, { 1: { intake: 2600, lateRatio: 0.5 }, 2: { intake: 2600, lateRatio: 0.5 }, 3: { lateRatio: 0.5, weight: 79.8 }, 4: { lateRatio: 0 }, 5: { lateRatio: 0 }, 6: { lateRatio: 0, weight: 79.5 } }) },
  ];

  it('評価文に禁止語が一語も出ない', () => {
    const offenders: string[] = [];
    for (const over of ALL_CASES) {
      const v = weeklyVerdict(st(over));
      for (const w of BANNED) if (v.text.includes(w)) offenders.push(`${v.headId}: ${w}`);
    }
    expect(offenders).toEqual([]);
  });

  it('来週の目標と理由にも禁止語が出ない', () => {
    const offenders: string[] = [];
    for (const over of ALL_CASES) {
      const g = nextWeekGoal(st(over));
      for (const w of BANNED) {
        if (g.text.includes(w)) offenders.push(`${g.kind}/text: ${w}`);
        if (g.reason.includes(w)) offenders.push(`${g.kind}/reason: ${w}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ===== ④ 来週の目標を1つだけ =====

describe('nextWeekGoal（来週の目標は1つだけ）', () => {
  it('記録が5日未満なら記録の目標（土台が先）', () => {
    const days = week({ 4: { recorded: false, intake: null, over: null }, 5: { recorded: false, intake: null, over: null }, 6: { recorded: false, intake: null, over: null } });
    const g = nextWeekGoal(st({ days }));
    expect(g.kind).toBe('record');
    expect(g.need).toBe(5);        // 記録4日 → 次の段は5日
    expect(g.reason).toContain('4');
  });

  it('記録の目標はソフト週目標と同じ段（3/4/5/7）に乗る', () => {
    const mk = (n: number) => week(Object.fromEntries(
      Array.from({ length: 7 - n }, (_, i) => [6 - i, { recorded: false, intake: null, over: null } as DayOpts]),
    ));
    const needs = [0, 1, 2, 3, 4].map((n) => nextWeekGoal(st({ days: mk(n) })).need);
    expect(needs).toEqual([3, 3, 3, 4, 5]);
  });

  it('夜21時以降が3日以上なら「週n回まで」の目標', () => {
    const days = weightWeek(80, 79.5, {
      0: { weight: 80, lateRatio: 0.5 }, 1: { lateRatio: 0.5 }, 2: { lateRatio: 0.5 },
      3: { lateRatio: 0, weight: 79.8 }, 4: { lateRatio: 0 }, 5: { lateRatio: 0 }, 6: { lateRatio: 0, weight: 79.5 },
    });
    const g = nextWeekGoal(st({ days }));
    expect(g.kind).toBe('late');
    expect(g.need).toBe(2);        // 3回 → 2回まで（1回ぶんだけ縮める）
    expect(weekGoalUnit(g)).toBe('回');
  });

  it('週末に増えた週は週末の目標', () => {
    const days = weightWeek(80, 79.5, { 5: { intake: 3600 }, 6: { intake: 3600, weight: 79.5 } });
    expect(nextWeekGoal(st({ days })).kind).toBe('weekend');
  });

  it('たんぱく質がそろわない週はたんぱく質の目標（水準は目標g）', () => {
    const days = weightWeek(80, 79.5).map((d) => ({ ...d, protein: 90 }));
    const g = nextWeekGoal(st({ days, proteinGoalG: 160 }));
    expect(g.kind).toBe('protein');
    expect(g.param).toBe(160);
    expect(g.text).toContain('160');
  });

  it('歩数の目標を設定している人は歩数の目標', () => {
    const days = weightWeek(80, 79.5).map((d) => ({ ...d, protein: 170, steps: 3000 }));
    const g = nextWeekGoal(st({ days, proteinGoalG: 160, stepsGoalPerDay: 7000 }));
    expect(g.kind).toBe('steps');
    expect(g.text).toContain('7,000');
  });

  it('体重の記録が2日以下なら「体重を週3日はかる」', () => {
    const days = week({ 0: { weight: 80 }, 6: { weight: 79.5 } }).map((d) => ({ ...d, protein: 170 }));
    const g = nextWeekGoal(st({ days, proteinGoalG: 160 }));
    expect(g.kind).toBe('weight');
    expect(g.need).toBe(3);
  });

  it('何も欠けていない週は「同じことを続ける」（宿題を増やさない）', () => {
    const days = week({ 0: { weight: 80 }, 2: { weight: 79.8 }, 4: { weight: 79.6 }, 6: { weight: 79.5 } })
      .map((d) => ({ ...d, protein: 170, lateRatio: 0 }));
    expect(nextWeekGoal(st({ days, proteinGoalG: 160 })).kind).toBe('keep');
  });

  it('候補は必ず1件だけ返り、理由が付いている', () => {
    for (const over of [{}, { days: weightWeek(80, 79.5) }, { days: week({}, { recorded: false, intake: null, over: null }) }]) {
      const g = nextWeekGoal(st(over));
      expect(typeof g.kind).toBe('string');
      expect(g.text.endsWith('。')).toBe(true);
      expect(g.reason.length).toBeGreaterThan(4);
    }
  });

  it('features を渡すと材料の有無を補える（歩数列が無い端末で空振りしない）', () => {
    const days = weightWeek(80, 79.5).map((d) => ({ ...d, protein: 170 }));
    // 週内の歩数は無いが、過去の特徴量に歩数がある → 歩数の目標を出せる
    const feats: DayFeature[] = [{ ...emptyDayFeature('2026-08-01'), steps: 9000 }];
    expect(nextWeekGoal(st({ days, proteinGoalG: 160, stepsGoalPerDay: 7000 }), feats).kind).toBe('steps');
  });
});

// ===== ⑤ 進捗の数え方 =====

describe('weekGoalProgress', () => {
  it('record: 記録した日数を数える', () => {
    const days = week({ 5: { recorded: false }, 6: { recorded: false } });
    expect(weekGoalProgress({ kind: 'record', need: 5 }, days)).toEqual({ n: 5, m: 5, over: false });
  });
  it('late: 「週n回まで」は超えたときだけ over', () => {
    const days = week({}, { lateRatio: 0.4 });
    expect(weekGoalProgress({ kind: 'late', need: 2 }, days).over).toBe(true);
    expect(weekGoalProgress({ kind: 'late', need: 8 }, days).over).toBe(false);
  });
  it('protein: 目標の9割以上の日を数える', () => {
    const days = week({}, { protein: 145 });   // 160の9割=144 → 全日カウント
    expect(weekGoalProgress({ kind: 'protein', need: 5, param: 160 }, days).n).toBe(7);
  });
  it('steps / weight / weekend / keep も数えられる', () => {
    const days = week({ 0: { weight: 80, steps: 9000 }, 5: { intake: 3000 }, 6: { intake: 3000 } });
    expect(weekGoalProgress({ kind: 'steps', need: 4, param: 7000 }, days).n).toBe(1);
    expect(weekGoalProgress({ kind: 'weight', need: 3 }, days).n).toBe(1);
    expect(weekGoalProgress({ kind: 'weekend', need: 2 }, days).n).toBe(0);
    expect(weekGoalProgress({ kind: 'keep', need: 7 }, days).n).toBe(7);
  });
  it('weekGoalText は全kindで文章になる（保存値から作り直せる）', () => {
    const kinds = ['record', 'late', 'protein', 'steps', 'weekend', 'weight', 'keep'] as const;
    for (const kind of kinds) {
      const s = weekGoalText({ kind, need: 5, param: 160 });
      expect(s.length).toBeGreaterThan(4);
      expect(s).not.toContain('{');
    }
  });
});

// ===== ⑥ 推定消費の出どころ =====

describe('estimateBurn（実測 > 体重変化からの逆算 > モデル）', () => {
  it('ヘルスケアの実測が3日以上あれば実測を使う', () => {
    const days = week({}, { activeKcal: 500 });
    expect(estimateBurn(days, 1700, -0.4)).toEqual({ kcal: 2200, source: 'health' });
  });
  it('実測が足りなければ体重変化から逆算する', () => {
    const days = weightWeek(80, 79.4);
    const r = estimateBurn(days, null, -0.6);
    expect(r?.source).toBe('weight');
    // 摂取2,000 − (−0.6kg × 7,200 / 6日) = 2,720
    expect(r?.kcal).toBe(2720);
  });
  it('体重が1日しか無ければモデル（目安kcal）に落ちる', () => {
    expect(estimateBurn(week({ 0: { weight: 80 } }), null, null)).toEqual({ kcal: 2400, source: 'model' });
  });
  it('ありえない逆算値はモデルへ逃がす（水分で体重が跳ねた週）', () => {
    const days = weightWeek(80, 76);   // 週−4kgは水分。逆算すると消費が跳ね上がる
    expect(estimateBurn(days, null, -4)?.source).toBe('model');
  });
  it('weekStats は実測がある週で burnSource=health を返す', () => {
    const w = st({ days: week({}, { activeKcal: 400 }), bmr: 1700 });
    expect(w.burnSource).toBe('health');
    expect(w.burnKcal).toBe(2100);
  });
});

// ===== ⑦ 週の選び方・集計の土台 =====

describe('週の選び方と集計', () => {
  it('weekStartOf は月曜起点（日曜はその週の月曜に寄る）', () => {
    expect(weekStartOf('2026-09-06')).toBe('2026-08-31'); // 日曜
    expect(weekStartOf('2026-08-31')).toBe('2026-08-31'); // 月曜
    expect(dowOf('2026-08-31')).toBe(0);
    expect(dowOf('2026-09-06')).toBe(6);
  });

  it('pickReviewWeek: 週の頭（月・火）は、先週に3日以上の記録があれば先週を振り返る', () => {
    const feats = Array.from({ length: 7 }, (_, i) => ({ ...emptyDayFeature(shiftDays('2026-08-31', i)), recorded: true }));
    // 2026-09-07(月)に開く → 先週(08-31)を振り返る
    expect(pickReviewWeek(feats, '2026-09-07')).toBe('2026-08-31');
    // 記録が薄い先週なら今週のまま
    expect(pickReviewWeek([], '2026-09-07')).toBe('2026-09-07');
    // 水曜以降は常に今週
    expect(pickReviewWeek(feats, '2026-09-09')).toBe('2026-09-07');
  });

  it('経過していない日を「記録が無い日」として数えない（まだ失敗ではない）', () => {
    const w = st({ today: '2026-09-02', days: week() });   // 水曜 → 経過3日
    expect(w.elapsed).toBe(3);
    expect(w.recordedDays).toBe(3);
  });

  it('buildWeekReviewInput は日次特徴量から7日ぶんを密に並べる', () => {
    const feats: DayFeature[] = [{ ...emptyDayFeature('2026-09-02'), recorded: true, intake: 1800, weight: 79.9 }];
    const i = buildWeekReviewInput(feats, {
      today: SUNDAY, weekStart: WEEK, bulk: false, bmr: null,
      proteinGoalG: null, stepsGoalPerDay: null, recordGoalDays: 7,
    });
    expect(i.days).toHaveLength(7);
    expect(i.prevDays).toHaveLength(7);
    expect(i.days[2].intake).toBe(1800);      // 2026-09-02 は週の3日目（水曜）
    expect(i.days[0].recorded).toBe(false);
    expect(weekDaysOf(feats, WEEK)[2].weight).toBe(79.9);
  });
});

// ===== ⑧ 通知の着地時刻 =====

describe('週次レビュー通知（日曜21:00・月曜の朝には出さない）', () => {
  it('平日に起動 → 直近の日曜21:00', () => {
    const at = nextWeeklyReviewAt(new Date('2026-09-02T10:00:00'));
    expect(at.getDay()).toBe(0);           // 日曜
    expect(at.getHours()).toBe(21);
    expect(at.getDate()).toBe(6);          // 2026-09-06
  });
  it('日曜21:00を過ぎて起動 → 翌週の日曜（月曜の朝には積まない）', () => {
    const at = nextWeeklyReviewAt(new Date('2026-09-06T22:30:00'));
    expect(at.getDay()).toBe(0);
    expect(at.getDate()).toBe(13);
  });
  it('日曜の朝に起動 → その日の21:00', () => {
    const at = nextWeeklyReviewAt(new Date('2026-09-06T08:00:00'));
    expect(at.getDate()).toBe(6);
    expect(at.getHours()).toBe(21);
  });
});

// ===== ⑨ 画面のマウント（白画面事故の検出） =====

describe('週次レビュー画面', () => {
  it('マウントできる', async () => {
    jest.useFakeTimers();
    let tree!: ReactTestRenderer;
    await act(async () => { tree = renderer.create(<WeeklyReviewScreen />); });
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(tree.toJSON()).toBeTruthy();
    await act(async () => { tree.unmount(); });
    jest.useRealTimers();
  });
});
