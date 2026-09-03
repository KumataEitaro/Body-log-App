// N3「ホーム＝今日の司令塔」（lib/commandLine.ts）の再発防止。
// 固定するのは:
//   ① 11パターンすべてが「残量の内訳＋時間帯＋N1の予定」から選ばれること（全パターンを1度は通す）
//   ② CTAの時間帯別の出し分け（朝＝今日のプラン／昼＝昼／夕＝夕食）
//   ③ 数字を増やしていないこと＝文が必ず1行で、禁止語を含まないこと
import { BANNED_PHRASES } from '../whatIf';
import { TIME_SLOTS_8, type TimeSlot8 } from '../timeSlots';
import { commandLine, ctaFor, type CommandTone } from '../commandLine';
import type { DayPlan } from '../dayPlan';

const NOPFC = { p: null, f: null, c: null };

describe('commandLine（解釈1行のパターン）', () => {
  it('超過中: 数字は言うが責めない（夜を軽めにという行動まで）', () => {
    const r = commandLine(-400, NOPFC, 'evening', null);
    expect(r.tone).toBe('over');
    expect(r.text).toContain('400');
    expect(r.text).toContain('軽め');
  });

  it('外食の予定（イベント前）: 「夜に約800kcal残す → いまは約900kcalまで」', () => {
    const r = commandLine(1700, NOPFC, 'morning', { kind: 'eatout' });
    expect(r.tone).toBe('planEvent');
    expect(r.text).toBe('夜に約800kcal残す → いまは約900kcalまでです。');
  });

  it('飲み会の予定でも同じ言い方（想定kcalだけ変わる）', () => {
    const r = commandLine(1800, NOPFC, 'noon', { kind: 'drink' });
    expect(r.tone).toBe('planEvent');
    expect(r.text).toContain('1,000');
  });

  it('イベントの時刻を過ぎたら予定の話をやめる（20時に「夜に残す」は言わない）', () => {
    const r = commandLine(1700, NOPFC, 'night', { kind: 'eatout', at: '19:00' });
    expect(r.tone).not.toBe('planEvent');
  });

  it('トレーニングの予定: 消費の見込みぶん食べられる量が増える', () => {
    const r = commandLine(1200, NOPFC, 'morning', { kind: 'workout', estKcal: 400 });
    expect(r.tone).toBe('planWorkout');
    expect(r.text).toContain('1,600');
  });

  it('予定を無効化した日（=呼び出し側が null を渡す）は時間帯の文に戻る＝二重の緩和が画面に出ない', () => {
    const r = commandLine(1200, NOPFC, 'morning', null);
    expect(r.tone).not.toBe('planWorkout');
    expect(r.tone).not.toBe('planEvent');
  });

  it('使い切った: 「ほぼ使い切りました」（0kcalを要求しない）', () => {
    const r = commandLine(40, { p: 0, f: 20, c: 30 }, 'night', null);
    expect(r.tone).toBe('done');
  });

  it('たんぱく質があと少し: 「あと{p}gで今日はほぼ完成です。」（§7 N3の例文）', () => {
    const r = commandLine(300, { p: 38, f: 20, c: 40 }, 'evening', null);
    expect(r.tone).toBe('almostDone');
    expect(r.text).toBe('あと38gで今日はほぼ完成です。');
  });

  it('たんぱく質が大きく足りない: 主菜をもう一品の話にする', () => {
    const r = commandLine(900, { p: 70, f: 40, c: 120 }, 'evening', null);
    expect(r.tone).toBe('proteinShort');
    expect(r.text).toContain('70');
  });

  it('脂質の枠が細い: 「あと{n}kcal。夜は脂質を抑えめにすると収まります。」', () => {
    const r = commandLine(600, { p: 10, f: 5, c: 90 }, 'evening', null);
    expect(r.tone).toBe('fatTight');
    expect(r.text).toBe('あと600kcal。夜は脂質を抑えめにすると収まります。');
  });

  it('残り100kcalで脂質の配分を語らない（意味がない話をしない）', () => {
    const r = commandLine(120, { p: 5, f: 3, c: 10 }, 'evening', null);
    expect(r.tone).not.toBe('fatTight');
  });

  it('朝で残量たっぷり: 「朝にたんぱく質を入れておくと、夜が楽になります。」', () => {
    const r = commandLine(1800, NOPFC, 'morning', null);
    expect(r.tone).toBe('morningPlenty');
    expect(r.text).toContain('1,800');
  });

  it('昼どき: 次の1食をここで決める話', () => {
    expect(commandLine(800, NOPFC, 'noon', null).tone).toBe('noonDecide');
    expect(commandLine(800, NOPFC, 'afternoon', null).tone).toBe('noonDecide');
  });

  it('夕方: 夕食で使い切ってよいと言い切る', () => {
    expect(commandLine(700, NOPFC, 'evening', null).tone).toBe('eveningUse');
  });

  it('夜・深夜: 無理に埋めさせない（ノルマにしない）', () => {
    expect(commandLine(700, NOPFC, 'night', null).tone).toBe('nightWrap');
    expect(commandLine(700, NOPFC, 'lateNight', null).text).toContain('無理に埋めなくて');
  });

  it('PFCが未計算でも壊れない（P/Fの文は選ばれず時間帯の文になる）', () => {
    for (const slot of TIME_SLOTS_8) {
      const r = commandLine(700, NOPFC, slot, null);
      expect(r.text.length).toBeGreaterThan(0);
    }
  });

  it('パターンは8種以上あり、この網羅ケースで11種すべてが出る', () => {
    const seen = new Set<CommandTone>();
    const cases: { left: number; pfc: typeof NOPFC | { p: number; f: number; c: number }; slot: TimeSlot8; plan: DayPlan | null }[] = [
      { left: -400, pfc: NOPFC, slot: 'evening', plan: null },
      { left: 1700, pfc: NOPFC, slot: 'morning', plan: { kind: 'eatout' } },
      { left: 1200, pfc: NOPFC, slot: 'morning', plan: { kind: 'workout' } },
      { left: 40, pfc: { p: 0, f: 20, c: 30 }, slot: 'night', plan: null },
      { left: 300, pfc: { p: 38, f: 20, c: 40 }, slot: 'evening', plan: null },
      { left: 900, pfc: { p: 70, f: 40, c: 120 }, slot: 'evening', plan: null },
      { left: 600, pfc: { p: 10, f: 5, c: 90 }, slot: 'evening', plan: null },
      { left: 1800, pfc: NOPFC, slot: 'morning', plan: null },
      { left: 800, pfc: NOPFC, slot: 'noon', plan: null },
      { left: 700, pfc: NOPFC, slot: 'evening', plan: null },
      { left: 700, pfc: NOPFC, slot: 'night', plan: null },
    ];
    for (const c of cases) seen.add(commandLine(c.left, c.pfc, c.slot, c.plan).tone);
    expect(seen.size).toBe(11);
  });
});

describe('ctaFor（CTAの時間帯別の出し分け）', () => {
  it('朝〜午前は「今日のプランを見る」→ 献立の文脈で開く', () => {
    for (const slot of ['earlyMorning', 'morning', 'forenoon'] as TimeSlot8[]) {
      expect(ctaFor(slot)).toEqual({ label: '今日のプランを見る', eatContext: 'cook' });
    }
  });

  it('昼〜午後は「昼を考える」→ コンビニの文脈（いちばん多い現実）', () => {
    expect(ctaFor('noon')).toEqual({ label: '昼を考える', eatContext: 'convenience' });
    expect(ctaFor('afternoon').eatContext).toBe('convenience');
  });

  it('夕は「夕食を考える」→ 献立の文脈', () => {
    expect(ctaFor('evening')).toEqual({ label: '夕食を考える', eatContext: 'cook' });
  });

  it('夜・深夜は軽いものへ寄せる（「もう一品」を勧めない）', () => {
    expect(ctaFor('night').eatContext).toBe('snack');
    expect(ctaFor('lateNight').eatContext).toBe('snack');
  });

  it('どの時間帯でもCTAは必ず1つ返る（司令塔が行き先を失わない）', () => {
    for (const slot of TIME_SLOTS_8) {
      const cta = ctaFor(slot);
      expect(cta.label.length).toBeGreaterThan(0);
      expect(cta.eatContext.length).toBeGreaterThan(0);
    }
  });
});

describe('司令塔の文の規約（数字を増やさない・責めない）', () => {
  it('必ず1行（改行を含まない）', () => {
    for (const slot of TIME_SLOTS_8) {
      for (const left of [-900, -100, 30, 300, 900, 2200]) {
        expect(commandLine(left, { p: 30, f: 8, c: 60 }, slot, null).text).not.toContain('\n');
      }
    }
  });

  it('禁止語（やめましょう・太ります・我慢）を出さない', () => {
    const plans: (DayPlan | null)[] = [null, { kind: 'eatout' }, { kind: 'drink' }, { kind: 'workout' }, { kind: 'none' }];
    for (const slot of TIME_SLOTS_8) {
      for (const left of [-1200, -300, -50, 0, 60, 200, 500, 1000, 1600, 2400]) {
        for (const pfc of [NOPFC, { p: 0, f: 0, c: 0 }, { p: 38, f: 5, c: 40 }, { p: 80, f: 40, c: 200 }]) {
          for (const plan of plans) {
            const r = commandLine(left, pfc, slot, plan);
            for (const bad of BANNED_PHRASES) expect(r.text).not.toContain(bad);
          }
        }
      }
    }
  });
});
