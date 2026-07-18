import { describe, it, expect } from 'vitest';
import { summarizeDay, dayExerciseKcal, maxExLevel, type LogRow } from '../lib/day';
import { EX_ADD } from '../lib/calc';

const meal = (kcal: number, p = 0, f = 0, c = 0): LogRow => ({ kcal, p, f, c });

describe('dayExerciseKcal（運動追加kcalの加算式）', () => {
  it('筋トレ(通常150) + ラン(高400) = 550', () => {
    expect(dayExerciseKcal([{ ex: '通常' }, { ex: '高' }])).toBe(550);
  });
  it('補正kcalも合算される', () => {
    expect(dayExerciseKcal([{ ex: '通常', adj: 100 }, { ex: 'オフ', adj: -50 }])).toBe(200);
  });
  it('運動なしの日は0', () => {
    expect(dayExerciseKcal([meal(500)])).toBe(0);
  });
  it('exがnullはオフ扱い', () => {
    expect(dayExerciseKcal([{ ex: null }])).toBe(0);
  });
});

describe('maxExLevel（表示用の最高強度）', () => {
  it('通常と高なら高', () => {
    expect(maxExLevel([{ ex: '通常' }, { ex: '高' }])).toBe('高');
  });
  it('記録なしはオフ', () => {
    expect(maxExLevel([])).toBe('オフ');
  });
});

describe('summarizeDay（日次集計）', () => {
  it('食事kcal/PFCは合計', () => {
    const s = summarizeDay([meal(500, 40, 10, 50), meal(700, 30, 20, 80)]);
    expect(s.intake).toBe(1200);
    expect(s.p).toBe(70);
    expect(s.f).toBe(30);
    expect(s.c).toBe(130);
  });
  it('食事記録がない日はnull（0ではない）', () => {
    const s = summarizeDay([{ ex: '通常' }]);
    expect(s.intake).toBeNull();
  });
  it('体重は最後に記録された値', () => {
    const s = summarizeDay([{ weight: 85.6 }, meal(300), { weight: 85.2 }]);
    expect(s.weight).toBe(85.2);
  });
  it('気分は最後の非空値', () => {
    const s = summarizeDay([{ mood: '普通' }, { mood: '' }, { mood: '好調' }, meal(100)]);
    expect(s.mood).toBe('好調');
  });
  it('adj折り込み: 目安計算(EX_ADD[ex]+adj)が加算式の合計と一致する', () => {
    // 筋トレ150 + ラン400 = 550。表示ex=高(400) → adj=150
    const s = summarizeDay([{ ex: '通常' }, { ex: '高' }]);
    expect(s.ex).toBe('高');
    expect(EX_ADD[s.ex] + s.adj).toBe(550);
    expect(s.exKcalTotal).toBe(550);
  });
  it('運動1回だけならadj=元の補正のみ', () => {
    const s = summarizeDay([{ ex: '通常', adj: 50 }]);
    expect(EX_ADD[s.ex] + s.adj).toBe(200);
  });
  it('テキストは「 ／ 」で連結、写真は連結', () => {
    const s = summarizeDay([
      { text: '朝ごはん', photo_urls: ['a.jpg'] },
      { text: '', photo_urls: [] },
      { text: '夜ごはん', photo_urls: ['b.jpg', 'c.jpg'] },
    ]);
    expect(s.food_text).toBe('朝ごはん ／ 夜ごはん');
    expect(s.photo_urls).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });
  it('空配列でも壊れない', () => {
    const s = summarizeDay([]);
    expect(s.intake).toBeNull();
    expect(s.ex).toBe('オフ');
    expect(s.adj).toBe(0);
  });
});
