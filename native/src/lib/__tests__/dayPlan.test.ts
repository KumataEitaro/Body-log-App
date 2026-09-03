// N1「今日の予定ヒアリング＋プラン動的再配分」（lib/dayPlan.ts）の再発防止。
// 固定するのは3つ:
//   ① 聞き方（1日1回・〜11時・今日だけ・答えたら出さない・「聞かないで」・チートデイの日は聞かない）
//   ② 再配分の式（イベントに枠を確保して残りを朝昼へ／トレーニングは上乗せ）
//   ③ **二重計上と嘘の緩和を作らない判定**（チートデイ登録済み・運動を実記録済み）
import {
  AT_PRESETS, EST_DEFAULT, EST_MAX, EST_MIN, EST_STEP, PLAN_KEEP_DAYS,
  clampEst, dateOfPlanKey, estKcalOf, needsTimeQuestion, planEffect, planKeyOf,
  redistribute, shouldAskPlan, slotForPlan, stalePlanKeys, validateDayPlan,
  type DayPlan,
} from '../dayPlan';

const ask = (over: Partial<Parameters<typeof shouldAskPlan>[0]> = {}) => shouldAskPlan({
  isToday: true, hour: 8, answered: false, askOff: false, hasCheatDay: false, ...over,
});

describe('shouldAskPlan（朝の1問の出し方＝質問攻めにしない）', () => {
  it('今日・朝8時・未回答・聞かないで解除・チートデイ無し → 出す', () => {
    expect(ask()).toBe(true);
  });

  it('11時を過ぎたら出さない（今から今日の予定を聞く意味が薄い）', () => {
    expect(ask({ hour: 10 })).toBe(true);
    expect(ask({ hour: 11 })).toBe(false);
    expect(ask({ hour: 19 })).toBe(false);
  });

  it('答えたら二度と出さない（1日1回）。「予定はない」と答えた場合も含む', () => {
    expect(ask({ answered: true })).toBe(false);
  });

  it('「聞かないで」を選んだら以後出さない', () => {
    expect(ask({ askOff: true })).toBe(false);
  });

  it('過去日を表示中は出さない（「今日の予定」を3日前の画面で聞かない）', () => {
    expect(ask({ isToday: false })).toBe(false);
  });

  it('チートデイ登録済みの日は聞かない（既存の吸収と重複した緩和は嘘になる）', () => {
    expect(ask({ hasCheatDay: true })).toBe(false);
  });

  it('2問目（時刻）は外食・飲み会だけ。ない／トレーニングは1問で終わる', () => {
    expect(needsTimeQuestion('eatout')).toBe(true);
    expect(needsTimeQuestion('drink')).toBe(true);
    expect(needsTimeQuestion('workout')).toBe(false);
    expect(needsTimeQuestion('none')).toBe(false);
  });

  it('2問目の候補は夕食〜飲み会の帯（18〜21時）', () => {
    expect([...AT_PRESETS]).toEqual(['18:00', '19:00', '20:00', '21:00']);
  });
});

describe('planEffect（二重計上・嘘の緩和を作らない止め金）', () => {
  const base = { hasCheatDay: false, recordedExerciseKcal: 0 };

  it('予定なし／未回答は効かない', () => {
    expect(planEffect({ ...base, plan: null }).reason).toBe('none');
    expect(planEffect({ ...base, plan: { kind: 'none' } }).active).toBe(false);
  });

  it('チートデイ登録済みの日は予定の再配分を出さない（requiredDailyWithEvents が既に緩めている）', () => {
    const r = planEffect({ ...base, hasCheatDay: true, plan: { kind: 'drink', estKcal: 1000 } });
    expect(r.active).toBe(false);
    expect(r.reason).toBe('cheatDay');
  });

  it('トレーニング予定は実記録が1kcalでも入ったら無効（activeKcalGoalBonus と二重計上しない）', () => {
    const plan: DayPlan = { kind: 'workout', estKcal: 300 };
    expect(planEffect({ ...base, plan }).active).toBe(true);
    const r = planEffect({ ...base, plan, recordedExerciseKcal: 1 });
    expect(r.active).toBe(false);
    expect(r.reason).toBe('alreadyLogged');
  });

  it('食べる側の予定（外食・飲み会）は運動の実記録に影響されない', () => {
    const r = planEffect({ ...base, plan: { kind: 'eatout' }, recordedExerciseKcal: 500 });
    expect(r.active).toBe(true);
    expect(r.reason).toBe('ok');
  });
});

describe('redistribute（今日の配分の組み替え）', () => {
  it('外食: 想定800を夜に確保し、残りを朝昼へ配る', () => {
    const r = redistribute(1700, { kind: 'eatout' }, 'before');
    expect(r.forEvent).toBe(800);      // EST_DEFAULT.eatout
    expect(r.beforeEvent).toBe(900);
    expect(r.nowLimit).toBe(900);      // 「いまは約900kcalまで」
    expect(r.afterEvent).toBe(0);
  });

  it('飲み会: 既定1,000。±チップの調整値（estKcal）が優先される', () => {
    expect(redistribute(1800, { kind: 'drink' }).forEvent).toBe(1000);
    expect(redistribute(1800, { kind: 'drink', estKcal: 1300 }).forEvent).toBe(1300);
  });

  it('残量よりイベント想定が大きい日は、残量を全部イベントに寄せる（朝昼は0・マイナスの枠は作らない）', () => {
    const r = redistribute(600, { kind: 'drink' });
    expect(r.forEvent).toBe(600);
    expect(r.beforeEvent).toBe(0);
  });

  it('イベントを過ぎたら残り全部が使える（枠の確保は前だけの話）', () => {
    const r = redistribute(1700, { kind: 'eatout' }, 'after');
    expect(r.nowLimit).toBe(1700);
  });

  it('トレーニング: 枠は作らず、消費の見込みぶん食べられる量が増える', () => {
    const r = redistribute(1200, { kind: 'workout', estKcal: 400 });
    expect(r.forEvent).toBe(0);
    expect(r.afterEvent).toBe(400);
    expect(r.nowLimit).toBe(1600);
  });

  it('予定なしは残量をそのまま返す（何も組み替えない）', () => {
    const r = redistribute(1200, null);
    expect(r).toMatchObject({ kind: 'none', forEvent: 0, afterEvent: 0, nowLimit: 1200 });
  });

  it('すでに超過している日でも壊れない（マイナスの枠を作らない）', () => {
    const r = redistribute(-300, { kind: 'eatout' });
    expect(r.forEvent).toBe(0);
    expect(r.beforeEvent).toBe(0);
    // トレーニングの見込みは超過中でも足す（それが運動の意味）
    expect(redistribute(-300, { kind: 'workout', estKcal: 400 }).nowLimit).toBe(100);
  });
});

describe('slotForPlan（イベント前か後か）', () => {
  it('19時の予定なら18時は前・20時は後', () => {
    expect(slotForPlan({ kind: 'drink', at: '19:00' }, 18)).toBe('before');
    expect(slotForPlan({ kind: 'drink', at: '19:00' }, 20)).toBe('after');
  });

  it('時刻未回答は19時とみなす（2問目を強制しない）', () => {
    expect(slotForPlan({ kind: 'eatout' }, 12)).toBe('before');
    expect(slotForPlan({ kind: 'eatout' }, 21)).toBe('after');
  });

  it('トレーニング・予定なしは常に before（時刻の概念がない）', () => {
    expect(slotForPlan({ kind: 'workout' }, 23)).toBe('before');
    expect(slotForPlan(null, 23)).toBe('before');
  });
});

describe('想定kcalの丸め（打ち間違いで非現実的な数字を作らせない）', () => {
  it('EST_STEP刻み・EST_MIN〜EST_MAXに収める', () => {
    expect(clampEst(834)).toBe(800);
    expect(clampEst(0)).toBe(EST_MIN);
    expect(clampEst(99999)).toBe(EST_MAX);
    expect(clampEst(Number.NaN)).toBe(0);
    expect(EST_STEP).toBe(100);
  });

  it('既定値は外食800・飲み会1,000（トレーニングは消費側の控えめな見込み）', () => {
    expect(EST_DEFAULT.eatout).toBe(800);
    expect(EST_DEFAULT.drink).toBe(1000);
    expect(EST_DEFAULT.none).toBe(0);
    expect(estKcalOf({ kind: 'none' })).toBe(0);
    expect(estKcalOf(null)).toBe(0);
    expect(estKcalOf({ kind: 'eatout' })).toBe(800);
  });
});

describe('保存値の検証と7日の掃除', () => {
  it('未知の種類・壊れた値は未回答扱い（朝の1問がもう一度出るだけ）', () => {
    expect(validateDayPlan(null)).toBeNull();
    expect(validateDayPlan({ kind: 'party' })).toBeNull();
    expect(validateDayPlan({ kind: 'eatout', at: '99:99' })).toEqual({ kind: 'eatout' });
    expect(validateDayPlan({ kind: 'drink', at: '19:30', estKcal: 1234 })).toEqual({ kind: 'drink', at: '19:30', estKcal: 1200 });
  });

  it('キー名は bl-day-plan:<date>・日付を取り出せる', () => {
    expect(planKeyOf('2026-09-03')).toBe('bl-day-plan:2026-09-03');
    expect(dateOfPlanKey('bl-day-plan:2026-09-03')).toBe('2026-09-03');
    expect(dateOfPlanKey('bl-day-plan:junk')).toBeNull();
    expect(dateOfPlanKey('bl-locale')).toBeNull();
  });

  it('7日より古い予定キーだけ掃除する（未来日・他のキーは触らない）', () => {
    const keys = [
      'bl-day-plan:2026-08-20',  // 14日前 → 消す
      'bl-day-plan:2026-08-27',  // ちょうど7日前 → 消さない
      'bl-day-plan:2026-09-03',  // 今日 → 消さない
      'bl-day-plan:2026-09-10',  // 未来 → 消さない
      'bl-locale',               // 無関係 → 消さない
    ];
    expect(stalePlanKeys(keys, '2026-09-03')).toEqual(['bl-day-plan:2026-08-20']);
    expect(PLAN_KEEP_DAYS).toBe(7);
  });
});
