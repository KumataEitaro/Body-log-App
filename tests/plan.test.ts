// 新ティア設計（migration-23）とクーポン機構が依存するプラン判定の要点を固定するテスト。
// ・coach_day=0 は「1回も使えない」（nullの無制限と混同しない）
// ・plan_until=null の有料プランは無期限有効（クーポン付与の前提。rc-webhookのガードとも対）
import { describe, it, expect } from 'vitest';
import { checkKindLimit, resolvePlan, type PlanLimits } from '../lib/plan';

const limitsOf = (over: Partial<PlanLimits>): PlanLimits => ({
  plan: 'free', text_day: 3, photo_day: 1, coach_day: 0, photo_trial_total: 0, ads: true, ...over,
});

describe('checkKindLimit（新ティア）', () => {
  it('coach_day=0 は未使用でも常にブロック（上限0=ロック）', () => {
    const r = checkKindLimit(limitsOf({}), 'coach', null, 0);
    expect(r).toEqual({ ok: false, reason: 'day', limit: 0 });
  });

  it('coach_day=null は無制限（0と混同しない）', () => {
    const r = checkKindLimit(limitsOf({ coach_day: null }), 'coach', { coach_count: 999 }, 0);
    expect(r.ok).toBe(true);
  });

  it('free: テキスト3回/日（3回目まで通り、4回目で止まる）', () => {
    expect(checkKindLimit(limitsOf({}), 'text', { text_count: 2 }, 0).ok).toBe(true);
    expect(checkKindLimit(limitsOf({}), 'text', { text_count: 3 }, 0)).toEqual({ ok: false, reason: 'day', limit: 3 });
  });

  it('free: 写真1枚/日（1枚目は通り、2枚目で止まる。お試し累計枠は廃止=0）', () => {
    expect(checkKindLimit(limitsOf({}), 'photo', null, 0).ok).toBe(true);
    expect(checkKindLimit(limitsOf({}), 'photo', { photo_count: 1 }, 0)).toEqual({ ok: false, reason: 'day', limit: 1 });
  });
});

describe('resolvePlan（クーポンの無期限付与）', () => {
  it('plan_until=null の有料プランは期限切れ扱いにならない（クーポン無期限）', () => {
    expect(resolvePlan({ plan: 'premium', plan_until: null })).toBe('premium');
    expect(resolvePlan({ plan: 'standard', plan_until: null })).toBe('standard');
  });

  it('plan_until が過去の有料プランは free に落ちる（RC購読の期限切れ）', () => {
    expect(resolvePlan({ plan: 'standard', plan_until: '2000-01-01T00:00:00Z' })).toBe('free');
  });
});
