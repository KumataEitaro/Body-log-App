// 食品名の正規化: 分量を落として同一視できること。ただし別の食品を混同しないこと。
import { foodBaseName, foodKey, foodPortion } from '@/lib/foodName';

describe('foodBaseName', () => {
  it('分量を落とす', () => {
    expect(foodBaseName('オートミール80g')).toBe('オートミール');
    expect(foodBaseName('オートミール 1杯')).toBe('オートミール');
    expect(foodBaseName('鶏むね肉 200g')).toBe('鶏むね肉');
    expect(foodBaseName('ゆで卵 2個')).toBe('ゆで卵');
  });

  it('括弧の補足を落とす', () => {
    expect(foodBaseName('ミックスナッツ（カシューナッツ、アーモンド、クルミ）ひとつかみ（約25g）'))
      .toBe('ミックスナッツ');
    expect(foodBaseName('バナナ 1本(可食部 90g)')).toBe('バナナ');
  });

  it('数量の副詞を落とす', () => {
    expect(foodBaseName('コチュジャン 大さじ1')).toBe('コチュジャン');
    expect(foodBaseName('塩 少々')).toBe('塩');
  });

  it('倍率表記を落とす', () => {
    expect(foodBaseName('プロテイン ×2')).toBe('プロテイン');
  });
});

describe('foodKey（同一判定）', () => {
  it('分量が違っても同じキーになる', () => {
    expect(foodKey('オートミール80g')).toBe(foodKey('オートミール 1杯'));
    expect(foodKey('オートミール 1カップ（約80g）')).toBe(foodKey('オートミール'));
  });

  it('別の食品は一致しない（栄養が大きく違うものを混同しない）', () => {
    expect(foodKey('鶏むね肉 200g')).not.toBe(foodKey('鶏もも肉 200g'));
    expect(foodKey('白米 150g')).not.toBe(foodKey('玄米 150g'));
    expect(foodKey('無脂肪ヨーグルト')).not.toBe(foodKey('ヨーグルト'));
  });

  it('英字の大小と全角半角を吸収する', () => {
    expect(foodKey('Protein 1杯')).toBe(foodKey('protein'));
    expect(foodKey('ＰＲＯＴＥＩＮ')).toBe(foodKey('protein'));
  });

  it('空文字や記号だけでも壊れない', () => {
    expect(foodKey('')).toBe('');
    expect(foodKey('   ')).toBe('');
    expect(foodKey('80g')).toBe('');
  });
});

describe('foodPortion（単位の初期値）', () => {
  it('分量部分だけを取り出す', () => {
    expect(foodPortion('オートミール 1カップ（約80g）')).toBe('1カップ（約80g）');
    expect(foodPortion('鶏むね肉 200g')).toBe('200g');
  });

  it('分量が無ければnull', () => {
    expect(foodPortion('オートミール')).toBeNull();
  });

  it('名前が空ならnull', () => {
    expect(foodPortion('')).toBeNull();
    expect(foodPortion('80g')).toBeNull();
  });
});

describe('foodBaseName（分数・漢数字・半分）', () => {
  const { foodBaseName: b } = require('@/lib/foodName');
  it('分数を落とす', () => {
    expect(b('食パン1/2枚')).toBe('食パン');
    expect(b('食パン 1枚')).toBe('食パン');
  });
  it('漢数字+単位を落とす', () => {
    expect(b('ゆで卵 一個')).toBe('ゆで卵');
    expect(b('豆腐 半丁')).toBe('豆腐');
  });
  it('食品名の中の漢数字は壊さない（単位が続く時だけ数量扱い）', () => {
    expect(b('八宝菜')).toBe('八宝菜');
    expect(b('十六穀米 150g')).toBe('十六穀米');
    expect(b('一口カツ 2個')).toBe('一口カツ');
  });
  it('半分・約を落とす', () => {
    expect(b('おにぎり 半分')).toBe('おにぎり');
    expect(b('ごはん 約150g')).toBe('ごはん');
  });
});
