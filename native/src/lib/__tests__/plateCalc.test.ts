// プレート計算（貪欲法）。片側の構成と端数が正しく出ることが重要
// （床で暗算した値と食い違うと信用を失う機能なので、境界値を厚めに）。
import { platesFor, plateRemainder } from '../plateCalc';

describe('platesFor（片側のプレート構成）', () => {
  it('100kg・バー20kg → 片側40kg = 25+15', () => {
    expect(platesFor(100, 20)).toEqual([25, 15]);
    expect(plateRemainder(100, 20)).toBe(0);
  });

  it('60kg・バー20kg → 片側20kg = 20 1枚', () => {
    expect(platesFor(60, 20)).toEqual([20]);
  });

  it('小さいプレートの合成: 27.5kg・バー20kg → 片側3.75kg = 2.5+1.25', () => {
    expect(platesFor(27.5, 20)).toEqual([2.5, 1.25]);
    expect(plateRemainder(27.5, 20)).toBe(0);
  });

  it('同じプレートを繰り返し使う: 175kg・バー20kg → 片側77.5kg = 25×3+2.5', () => {
    expect(platesFor(175, 20)).toEqual([25, 25, 25, 2.5]);
  });

  it('バー重量15kgでも正しく割る: 100kg・バー15kg → 片側42.5kg = 25+15+2.5', () => {
    expect(platesFor(100, 15)).toEqual([25, 15, 2.5]);
  });

  it('端数（1.25kg未満）は切り捨てて remainder に出す: 101kg・バー20kg', () => {
    // 片側40.5kg → プレートは40kgぶん（25+15）、端数0.5kg
    expect(platesFor(101, 20)).toEqual([25, 15]);
    expect(plateRemainder(101, 20)).toBe(0.5);
  });

  it('目標がバー重量ちょうど → プレートなし（バーのみ）', () => {
    expect(platesFor(20, 20)).toEqual([]);
    expect(plateRemainder(20, 20)).toBe(0);
  });

  it('目標がバー重量未満 → 空配列・端数0（届かない）', () => {
    expect(platesFor(15, 20)).toEqual([]);
    expect(plateRemainder(15, 20)).toBe(0);
  });

  it('浮動小数の誤差に負けない: 0.1刻みの入力でも壊れない', () => {
    // 片側 (61.25-20)/2 = 20.625 → 20 + 0.625端数… 20.625は 20 = 20枚1 + 0.625
    expect(platesFor(61.25, 20)).toEqual([20]);
    expect(plateRemainder(61.25, 20)).toBeCloseTo(0.625, 5);
  });
});
