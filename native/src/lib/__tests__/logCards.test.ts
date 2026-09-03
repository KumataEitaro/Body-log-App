// 食事タブのヒーロー直下に積むカード・帯の調停（再発防止）。
// 「機能を足したら各カードが勝手に出て、今日の記録まで10ブロック」を二度と起こさないため、
// 上限・優先順位・過去日の扱いを数で固定する。
import { arbitrateAttention, attentionCount, MAX_BANDS, MAX_CARDS, TODAY_ONLY, CARD_PRIORITY, BAND_PRIORITY } from '../logCards';

const ALL_ON = {
  caution: 1, dayPlan: 1, backfill: 1, checklist: 1, mood: 1, positive: 2,
  badge: 1, firstLaw: 1, brief: 1,
};

describe('arbitrateAttention（ヒーロー直下の調停）', () => {
  it('全候補がそろっても カード最大2枚＋帯最大2本 を超えない', () => {
    const r = arbitrateAttention({ isToday: true, candidates: ALL_ON });
    const cards = r.caution + r.dayPlan + r.backfill + r.checklist + r.mood + r.positive;
    const bands = r.badge + r.firstLaw + r.brief;
    expect(cards).toBe(MAX_CARDS);
    expect(bands).toBe(MAX_BANDS);
    expect(attentionCount(r)).toBe(MAX_CARDS + MAX_BANDS);
  });

  it('カードは caution → dayPlan が先に枠を取り、backfill・checklist・mood・positive は譲る', () => {
    const r = arbitrateAttention({ isToday: true, candidates: ALL_ON });
    expect(r.caution).toBe(1);
    expect(r.dayPlan).toBe(1);
    expect(r.backfill).toBe(0);
    expect(r.checklist).toBe(0);
    expect(r.mood).toBe(0);
    expect(r.positive).toBe(0);
  });

  // N1（docs/STRATEGY.md §7）: 朝の1問は「答えると今日の配分そのものが変わる」＝この後に見る数字の前提。
  // だから backfill（昨日の穴埋め）より上。ただし caution（今日は崩れやすい）には譲る
  it('朝の1問は昨日の穴埋めより先に枠を取る', () => {
    const r = arbitrateAttention({ isToday: true, candidates: { dayPlan: 1, backfill: 1 } });
    expect(r.dayPlan).toBe(1);
    expect(r.backfill).toBe(1);   // 枠は2枚あるので両方出る
    const tight = arbitrateAttention({ isToday: true, candidates: { dayPlan: 1, backfill: 1 } }, 1);
    expect(tight.dayPlan).toBe(1);
    expect(tight.backfill).toBe(0);
  });

  it('朝の1問は「今日」を見ているときだけ（過去日の予定を聞かない）', () => {
    expect(arbitrateAttention({ isToday: false, candidates: { dayPlan: 1 } }).dayPlan).toBe(0);
  });

  it('帯は badge → firstLaw が先で、brief は3本目なので出ない', () => {
    const r = arbitrateAttention({ isToday: true, candidates: ALL_ON });
    expect(r.badge).toBe(1);
    expect(r.firstLaw).toBe(1);
    expect(r.brief).toBe(0);
  });

  it('新規ユーザーの典型（穴埋め無し）: チェックリストと気分が両方出る', () => {
    const r = arbitrateAttention({ isToday: true, candidates: { checklist: 1, mood: 1, brief: 1, badge: 1 } });
    expect(r.checklist).toBe(1);
    expect(r.mood).toBe(1);
    expect(r.brief).toBe(1);
    expect(r.badge).toBe(1);
  });

  it('ポジティブな気づきは残った枠のぶんだけ（2件あっても他のカードが1枚あれば1件）', () => {
    const r = arbitrateAttention({ isToday: true, candidates: { mood: 1, positive: 2 } });
    expect(r.mood).toBe(1);
    expect(r.positive).toBe(1);
    const r2 = arbitrateAttention({ isToday: true, candidates: { positive: 2 } });
    expect(r2.positive).toBe(2);
  });

  it('過去日を表示中は「今日」にしか意味のないものを出さない（バッジ・最初の法則・チェックリストは出る）', () => {
    const r = arbitrateAttention({ isToday: false, candidates: ALL_ON });
    for (const k of TODAY_ONLY) expect(r[k]).toBe(0);
    expect(r.badge).toBe(1);
    expect(r.firstLaw).toBe(1);
    expect(r.checklist).toBe(1);
  });

  it('候補が無いものは 0 のまま（省略・0・負数・小数も安全）', () => {
    const r = arbitrateAttention({ isToday: true, candidates: { mood: 0, positive: -1, badge: 0.4 } });
    expect(attentionCount(r)).toBe(0);
  });

  it('優先順位表に全キーが1回ずつ載っている（追加漏れ・重複の検出）', () => {
    const keys = [...CARD_PRIORITY, ...BAND_PRIORITY];
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of Object.keys(ALL_ON)) expect(keys).toContain(k);
  });
});
