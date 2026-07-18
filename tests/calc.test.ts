import { describe, it, expect } from 'vitest';
import {
  mifflinBMR, targetKcal, judge, verdictClass, todayJST,
  EX_ADD, EX_LEVELS, AI_DAILY_LIMIT, LIFE_FACTOR_DEFAULT,
} from '../lib/calc';

describe('mifflinBMR（基礎代謝: Mifflin-St Jeor）', () => {
  it('男性: 10*W + 6.25*H - 5*A + 5', () => {
    // 熊田さん実データ相当: 85.6kg / 178cm / 28歳 → 1833.5
    expect(mifflinBMR('male', 85.6, 178, 28)).toBe(1833.5);
  });
  it('女性: 10*W + 6.25*H - 5*A - 161', () => {
    expect(mifflinBMR('female', 60, 160, 30)).toBe(10 * 60 + 6.25 * 160 - 150 - 161);
  });
  it('体重が変わればBMRも変わる（+1kgで+10）', () => {
    const a = mifflinBMR('male', 70, 170, 30);
    const b = mifflinBMR('male', 71, 170, 30);
    expect(b - a).toBeCloseTo(10);
  });
  it('小数1桁に丸められる', () => {
    const v = mifflinBMR('male', 75.23, 173.3, 41);
    expect(v).toBe(Math.round(v * 10) / 10);
  });
});

describe('targetKcal（目安kcal = BMR×係数 + 運動追加 + 補正）', () => {
  const BMR = 1833.5;
  it('オフ: BMR×1.3 + 0', () => {
    expect(targetKcal(BMR, 1.3, 'オフ', 0)).toBeCloseTo(2383.6, 1);
  });
  it('運動レベルごとの加算が正しい（控えめ単価: オフ0/軽い30/通常150/高400/特大800）', () => {
    const base = targetKcal(BMR, 1.3, 'オフ', 0);
    expect(targetKcal(BMR, 1.3, '軽い', 0) - base).toBeCloseTo(30);
    expect(targetKcal(BMR, 1.3, '通常', 0) - base).toBeCloseTo(150);
    expect(targetKcal(BMR, 1.3, '高', 0) - base).toBeCloseTo(400);
    expect(targetKcal(BMR, 1.3, '特大', 0) - base).toBeCloseTo(800);
  });
  it('補正kcalが加算される', () => {
    const base = targetKcal(BMR, 1.3, 'オフ', 0);
    expect(targetKcal(BMR, 1.3, '通常', 100) - base).toBeCloseTo(250);
  });
  it('長時間登山ケース: 特大800+補正800=+1600', () => {
    const base = targetKcal(BMR, 1.3, 'オフ', 0);
    expect(targetKcal(BMR, 1.3, '特大', 800) - base).toBeCloseTo(1600);
  });
});

describe('judge（5段階判定の境界値）', () => {
  it('NG: +101以上', () => {
    expect(judge(101)).toBe('NG');
    expect(judge(3000)).toBe('NG');
  });
  it('×: -100〜+100', () => {
    expect(judge(100)).toBe('×');
    expect(judge(0)).toBe('×');
    expect(judge(-100)).toBe('×');
  });
  it('▲: -299〜-101', () => {
    expect(judge(-101)).toBe('▲');
    expect(judge(-299)).toBe('▲');
  });
  it('OK: -500〜-300', () => {
    expect(judge(-300)).toBe('OK');
    expect(judge(-500)).toBe('OK');
  });
  it('不足注意: -501以下', () => {
    expect(judge(-501)).toBe('不足注意');
    expect(judge(-2000)).toBe('不足注意');
  });
});

describe('judge（小数の境界）', () => {
  it('101未満の小数はNGにならない', () => {
    expect(judge(100.9)).toBe('×');
    expect(judge(-100.1)).toBe('▲');
    expect(judge(-500.1)).toBe('不足注意');
  });
});

describe('verdictClass（判定→CSSクラス）', () => {
  it('5種の判定が正しいクラスにマップされる', () => {
    expect(verdictClass('OK')).toBe('OK');
    expect(verdictClass('▲')).toBe('tri');
    expect(verdictClass('×')).toBe('x');
    expect(verdictClass('NG')).toBe('NG');
    expect(verdictClass('不足注意')).toBe('low');
  });
  it('null/undefinedは空文字', () => {
    expect(verdictClass(null)).toBe('');
    expect(verdictClass(undefined)).toBe('');
  });
});

describe('定数の整合性', () => {
  it('運動レベルとEX_ADDのキーが一致', () => {
    expect(Object.keys(EX_ADD).sort()).toEqual([...EX_LEVELS].sort());
  });
  it('AI日次上限は正の整数', () => {
    expect(AI_DAILY_LIMIT).toBeGreaterThan(0);
    expect(Number.isInteger(AI_DAILY_LIMIT)).toBe(true);
  });
  it('生活係数デフォルトは1.3', () => {
    expect(LIFE_FACTOR_DEFAULT).toBe(1.3);
  });
});

describe('todayJST（日本時間の今日）', () => {
  it('YYYY-MM-DD形式', () => {
    expect(todayJST()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('JSTの日付と一致（UTCとずれる時間帯でも正しい）', () => {
    const jst = new Date(Date.now() + 9 * 3600 * 1000);
    const expected = jst.toISOString().slice(0, 10);
    expect(todayJST()).toBe(expected);
  });
});
