// ★レビュー依頼の発火条件テスト。
//
// 守りたいのは3つ。
// ①「不具合を報告したばかりの人」に絶対に星を求めないこと（このアプリで最も痛い誤爆）
// ②成功体験の直後（バッジ・目標達成・ストリーク7日）以外では出さないこと
// ③一度依頼したら二度と聞かないこと
import {
  shouldAskReview, inBugCooldown, hasWinMoment,
  MIN_RECORDED_DAYS, MIN_STREAK, BUG_COOLDOWN_DAYS,
  REVIEW_ASKED_KEY, BUG_SENT_KEY, type ReviewSignals,
} from '../reviewPrompt';

const NOW = Date.parse('2026-09-02T12:00:00+09:00');
const DAY = 24 * 60 * 60 * 1000;

/** 「依頼してよい」状態の素材。各テストは1項目だけ崩して見る */
function ok(over: Partial<ReviewSignals> = {}): ReviewSignals {
  return {
    recordedDays: 30,
    streak: 10,
    justEarnedBadge: false,
    goalReached: false,
    alreadyAsked: false,
    bugSentAt: null,
    now: NOW,
    ...over,
  };
}

describe('shouldAskReview', () => {
  it('条件をすべて満たせば依頼する', () => {
    expect(shouldAskReview(ok())).toBe(true);
  });

  it('記録が14日に届かないうちは依頼しない（価値を知る前に星を聞かない）', () => {
    expect(MIN_RECORDED_DAYS).toBe(14);
    expect(shouldAskReview(ok({ recordedDays: 13 }))).toBe(false);
    expect(shouldAskReview(ok({ recordedDays: 14 }))).toBe(true);
  });

  it('成功体験が無ければ依頼しない（記録日数だけでは出さない）', () => {
    expect(shouldAskReview(ok({ streak: 3, justEarnedBadge: false, goalReached: false }))).toBe(false);
  });

  it('バッジ獲得・目標達成は、ストリークが短くても成功体験として数える', () => {
    expect(shouldAskReview(ok({ streak: 1, justEarnedBadge: true }))).toBe(true);
    expect(shouldAskReview(ok({ streak: 1, goalReached: true }))).toBe(true);
  });

  it('一度依頼していたら二度と依頼しない', () => {
    expect(shouldAskReview(ok({ alreadyAsked: true }))).toBe(false);
  });

  it('不具合を報告した直後30日は、他の条件を満たしていても依頼しない', () => {
    const justNow = new Date(NOW - 1 * DAY).toISOString();
    expect(shouldAskReview(ok({ bugSentAt: justNow }))).toBe(false);
    // 30日を過ぎれば通常どおり
    const longAgo = new Date(NOW - (BUG_COOLDOWN_DAYS + 1) * DAY).toISOString();
    expect(shouldAskReview(ok({ bugSentAt: longAgo }))).toBe(true);
  });
});

describe('inBugCooldown', () => {
  it('未送信なら冷却なし', () => {
    expect(inBugCooldown(null, NOW)).toBe(false);
  });

  it('境界: 30日ちょうどは冷却明け、29日は冷却中', () => {
    expect(BUG_COOLDOWN_DAYS).toBe(30);
    expect(inBugCooldown(new Date(NOW - 29 * DAY).toISOString(), NOW)).toBe(true);
    expect(inBugCooldown(new Date(NOW - 30 * DAY).toISOString(), NOW)).toBe(false);
  });

  it('壊れた値・未来の時刻は「冷却中」に倒す（迷ったら聞かない）', () => {
    expect(inBugCooldown('not-a-date', NOW)).toBe(true);
    expect(inBugCooldown(new Date(NOW + DAY).toISOString(), NOW)).toBe(true);
  });
});

describe('hasWinMoment', () => {
  it('ストリークの下限は7日（6日では成功体験にしない）', () => {
    expect(MIN_STREAK).toBe(7);
    expect(hasWinMoment({ streak: 6, justEarnedBadge: false, goalReached: false })).toBe(false);
    expect(hasWinMoment({ streak: 7, justEarnedBadge: false, goalReached: false })).toBe(true);
  });

  it('どれか1つ満たせばよい', () => {
    expect(hasWinMoment({ streak: 0, justEarnedBadge: true, goalReached: false })).toBe(true);
    expect(hasWinMoment({ streak: 0, justEarnedBadge: false, goalReached: true })).toBe(true);
    expect(hasWinMoment({ streak: 0, justEarnedBadge: false, goalReached: false })).toBe(false);
  });
});

describe('端末フラグのキー', () => {
  it('キー名は他機能と衝突しない（変えると依頼済みの人に再度出てしまう）', () => {
    expect(REVIEW_ASKED_KEY).toBe('bl-review-asked');
    expect(BUG_SENT_KEY).toBe('bl-feedback-bug-at');
  });
});
