// N2「未来シミュレーション」（lib/whatIf.ts）の再発防止。
// いちばん重要なのは **禁止語の固定**: 「やめましょう」「太ります」「我慢」を1度でも出したら、
// このアプリの人格（§5 Non-Judging Companion）が壊れる。全パターンの文を総当たりで検査する。
import type { BalanceDay } from '../deficit';
import {
  BANNED_PHRASES, simulateToday, simulateWeek, simulateWeight, simulateWhatIf, whatIfMessage,
  type WhatIfTarget,
} from '../whatIf';

const target = (kcal: number, over: Partial<WhatIfTarget> = {}): WhatIfTarget =>
  ({ name: 'ラーメン', kcal, p: 20, f: 15, c: 70, source: 'ai', ...over });

/** 7日分の日（maintenance 2,000 / allowance 1,500）。intake を配列で渡す（null=未記録） */
function days(intakes: (number | null)[]): BalanceDay[] {
  return intakes.map((intake, i) => ({
    date: `2026-08-${String(28 + i).padStart(2, '0')}`,
    intake, maintenance: 2000, allowance: 1500,
  }));
}

describe('simulateToday（今日の残り）', () => {
  it('食べた後の残りkcalと残りPFCを引き算する', () => {
    const r = simulateToday(900, { p: 60, f: 30, c: 120 }, target(600));
    expect(r.before).toBe(900);
    expect(r.after).toBe(300);
    expect(r.over).toBe(0);
    expect(r.pfc).toEqual({ p: 40, f: 15, c: 50 });
  });

  it('超過は既存の3段階（lib/deficit.ts overLevel）と同じ物差しで色分けする', () => {
    expect(simulateToday(100, { p: null, f: null, c: null }, target(300)).level).toBe('mild');   // +200
    expect(simulateToday(100, { p: null, f: null, c: null }, target(600)).level).toBe('mid');    // +500
    expect(simulateToday(100, { p: null, f: null, c: null }, target(1200)).level).toBe('high');  // +1,100
    expect(simulateToday(1000, { p: null, f: null, c: null }, target(600)).level).toBe('none');
  });

  it('PFCが未計算（null）の項目は null のまま（0gという嘘の数字を作らない）', () => {
    const r = simulateToday(900, { p: null, f: null, c: null }, target(600));
    expect(r.pfc).toEqual({ p: null, f: null, c: null });
  });
});

describe('simulateWeek（今週の収支・既存 balanceOf と同じ関数で作る）', () => {
  it('今日の摂取に対象のkcalを足した収支を返す', () => {
    // 6日×1,400 + 今日1,200 → actual = Σ(intake − 2,000) = 6×(−600) + (−800) = −4,400
    const d = days([1400, 1400, 1400, 1400, 1400, 1400, 1200]);
    const r = simulateWeek(d, 500, 600);
    expect(r.before).toBe(-4400);
    expect(r.after).toBe(-3800);      // 今日 1,200 → 1,800（−200）
    expect(r.goal).toBe(-3500);       // −500/日 × 7日
  });

  it('目標の赤字に届いていれば「範囲内」・届かなければ shortfall が出る', () => {
    const d = days([1400, 1400, 1400, 1400, 1400, 1400, 1200]);
    expect(simulateWeek(d, 500, 600).withinGoal).toBe(true);         // −3,800 ≦ −3,500
    const tight = simulateWeek(d, 500, 1200);                        // −3,200
    expect(tight.withinGoal).toBe(false);
    expect(tight.shortfall).toBe(300);
  });

  it('未記録日（null）は合計に入れない', () => {
    const d = days([null, null, null, null, null, null, 1500]);
    const r = simulateWeek(d, 500, 0);
    expect(r.after).toBe(-500);
  });

  it('増量（目標が黒字）では範囲の向きが反転する', () => {
    const d = days([2500, 2500, 2500, 2500, 2500, 2500, 2500]);
    const r = simulateWeek(d, -300, 0);   // 目標 +2,100 / actual +3,500
    expect(r.goal).toBe(2100);
    expect(r.withinGoal).toBe(true);
  });
});

describe('simulateWeight（予測体重・断定しない）', () => {
  it('Δkg = 週の収支 / 7,200（負=減る・小数1桁）', () => {
    expect(simulateWeight(-2160).deltaKg).toBe(-0.3);
    expect(simulateWeight(-7200).deltaKg).toBe(-1);
    expect(simulateWeight(3600).deltaKg).toBe(0.5);
  });

  it('ほぼ0の帯は「−0.0kg」のような無意味な数字を出さない', () => {
    const r = simulateWeight(-100);
    expect(r.deltaKg).toBe(0);
    expect(r.text).toContain('ほとんど変わらない');
  });

  it('必ず「ペース」「おおよそ」を添えて断定しない', () => {
    expect(simulateWeight(-2160).text).toMatch(/ペース/);
    expect(simulateWeight(-2160).text).toMatch(/おおよそ/);
  });
});

describe('whatIfMessage（伴走者トーン・パターンの固定）', () => {
  const today = (before: number, kcal: number) => simulateToday(before, { p: null, f: null, c: null }, target(kcal));
  const week = (after: number, withinGoal: boolean, shortfall = 0) =>
    ({ before: after, after, goal: -3500, withinGoal, shortfall });

  it('収まる＆週も範囲内 → 「食べても大丈夫です」', () => {
    const m = whatIfMessage(today(900, 600), week(-3800, true));
    expect(m.tone).toBe('fine');
    expect(m.text).toContain('食べても大丈夫です');
    expect(m.text).toContain('300');
  });

  it('今日は収まるが週が目標に届かない → 今日はOKと言い、週で寄せる話にする', () => {
    const m = whatIfMessage(today(900, 600), week(-3200, false, 300));
    expect(m.tone).toBe('weekTight');
    expect(m.text).toContain('収まります');
    expect(m.text).toContain('300');
  });

  it('少し多め（〜+300）→ 「少し多めになります」＋週の赤字を根拠にする（§7 N2の例文）', () => {
    const m = whatIfMessage(today(100, 300), week(-2000, true));
    expect(m.tone).toBe('slightlyOver');
    expect(m.text).toBe('今日は少し多めになります。今週は2,000kcalの赤字なので、明日から少し戻せば十分です。');
  });

  it('多め（+300超）→ 明日からの戻し方まで言う', () => {
    const m = whatIfMessage(today(100, 900), week(-2000, true));
    expect(m.tone).toBe('over');
    expect(m.text).toContain('明日から数日かけて');
  });

  it('食べる前からすでに超過 → 事実だけ言い、週の物差しに戻す（責めない）', () => {
    const m = whatIfMessage(today(-200, 600), week(-1000, true));
    expect(m.tone).toBe('alreadyOver');
    expect(m.text).toContain('週');
  });

  it('週が黒字（赤字0）でも文が壊れない（「0kcalの赤字」と言わない）', () => {
    const m = whatIfMessage(today(100, 300), week(500, false, 4000));
    expect(m.tone).toBe('slightlyOver');
    expect(m.text).not.toContain('0kcalの赤字');
  });

  it('【最重要】どのパターンでも禁止語を出さない（§5 Non-Judging Companion）', () => {
    const combos: { before: number; kcal: number; weekAfter: number; within: boolean }[] = [];
    for (const before of [-500, -100, 0, 120, 400, 900, 2000]) {
      for (const kcal of [100, 250, 500, 900, 1800]) {
        for (const weekAfter of [-5000, -2000, 0, 800]) {
          for (const within of [true, false]) combos.push({ before, kcal, weekAfter, within });
        }
      }
    }
    expect(combos.length).toBeGreaterThan(200);
    for (const c of combos) {
      const m = whatIfMessage(today(c.before, c.kcal), week(c.weekAfter, c.within, 500));
      for (const bad of BANNED_PHRASES) expect(m.text).not.toContain(bad);
      expect(m.text.length).toBeGreaterThan(0);
    }
  });
});

describe('simulateWhatIf（3段＋1文のまとめ）', () => {
  it('今日・今週・体重・文をひとまとめに返す', () => {
    const d = days([1400, 1400, 1400, 1400, 1400, 1400, 1200]);
    const r = simulateWhatIf({
      target: target(600), remainingKcal: 300, pfc: { p: 50, f: 20, c: 100 },
      days: d, perDayDeficit: 500,
    });
    expect(r.today.after).toBe(-300);
    expect(r.week.after).toBe(-3800);
    expect(r.weight.deltaKg).toBe(-0.5);
    expect(r.message.tone).toBe('slightlyOver');
    for (const bad of BANNED_PHRASES) expect(r.message.text).not.toContain(bad);
  });

  it('直近7日より多い配列を渡しても末尾7日だけを見る（収支カードと同じ窓）', () => {
    const long = days([9000, 9000, 1400, 1400, 1400, 1400, 1400, 1400, 1200]);
    const r = simulateWhatIf({
      target: target(0), remainingKcal: 300, pfc: { p: null, f: null, c: null },
      days: long, perDayDeficit: 500,
    });
    expect(r.week.after).toBe(-4400);
  });
});
