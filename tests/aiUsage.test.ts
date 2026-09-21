// ai_usage の加算（lib/aiUsage.ts の純関数部分・QA P1-7 後半／TODO B14）
import { describe, expect, it } from 'vitest';
import { nextUsage } from '@/lib/aiUsage';

describe('nextUsage', () => {
  it('行が無ければ 1 から始まる（種別の列だけ 1）', () => {
    expect(nextUsage(null, 'text')).toEqual({ count: 1, text_count: 1, photo_count: 0, coach_count: 0 });
    expect(nextUsage(undefined, 'photo')).toEqual({ count: 1, text_count: 0, photo_count: 1, coach_count: 0 });
    expect(nextUsage(null, 'coach')).toEqual({ count: 1, text_count: 0, photo_count: 0, coach_count: 1 });
  });
  it('既存の行に 1 を足す。他の種別の列は動かさない', () => {
    const cur = { count: 5, text_count: 3, photo_count: 2, coach_count: 0 };
    expect(nextUsage(cur, 'photo')).toEqual({ count: 6, text_count: 3, photo_count: 3, coach_count: 0 });
  });
  it('null / 数字でない値は 0 として扱う（旧行に列が無くても壊れない）', () => {
    expect(nextUsage({ count: null, text_count: undefined } as never, 'text')).toEqual({ count: 1, text_count: 1, photo_count: 0, coach_count: 0 });
    expect(nextUsage({ count: 'x' as never }, 'text').count).toBe(1);
  });
});
