import { describe, it, expect } from 'vitest';
import { averageActive, resolveActiveKcal, tdeeFromHealth, HK_NOISE_FLOOR } from '@/lib/energy';

describe('averageActive (直近の活動kcal平均)', () => {
  it('有効な日の平均を返す', () => {
    expect(averageActive([400, 600, 500])).toBe(500);
  });
  it('ノイズ床未満・nullは除外して平均する', () => {
    expect(averageActive([400, 0, null, 600, 20, 500])).toBe(500);
  });
  it('信頼できる日が3日未満なら null（平均として使わない）', () => {
    expect(averageActive([400, 600])).toBeNull();
    expect(averageActive([0, 0, null, 30])).toBeNull();
    expect(averageActive([])).toBeNull();
  });
});

describe('resolveActiveKcal (その日に使う活動kcal)', () => {
  it('今日: 実測と平均の大きい方（朝の過小評価を防ぐ）', () => {
    expect(resolveActiveKcal(120, 500, true)).toBe(500); // 朝: まだ120しか動いてない→平均を採用
    expect(resolveActiveKcal(700, 500, true)).toBe(700); // よく動いた日: 実測を採用
  });
  it('今日: 実測が無くても平均があれば平均', () => {
    expect(resolveActiveKcal(null, 480, true)).toBe(480);
    expect(resolveActiveKcal(10, 480, true)).toBe(480); // ノイズ床未満は無いのと同じ
  });
  it('今日: どちらも無ければ null（従来式へフォールバック）', () => {
    expect(resolveActiveKcal(null, null, true)).toBeNull();
    expect(resolveActiveKcal(30, null, true)).toBeNull();
  });
  it('過去日: 実測のみ・平均で補完しない', () => {
    expect(resolveActiveKcal(650, 500, false)).toBe(650);
    expect(resolveActiveKcal(null, 500, false)).toBeNull();
    expect(resolveActiveKcal(HK_NOISE_FLOOR - 1, 500, false)).toBeNull();
  });
});

describe('tdeeFromHealth (消費推計)', () => {
  it('基礎代謝＋活動kcal', () => {
    expect(tdeeFromHealth(1540.4, 512)).toBe(2052);
  });
});
