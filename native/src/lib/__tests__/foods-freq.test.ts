// よく使う順の並びに使う実績。
//
// 元は localStorage に読み書きしていて、React Native には存在しないため
// try/catch で握りつぶされ「常に0件」として動いていた（落ちないので気づけない）。
// メモリ＋AsyncStorage に移したので、記録が実際に残ることを確かめる。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bumpFoodFreq, readFoodFreq, foodScores, loadFoodFreq } from '../foods';

describe('使用実績の記録', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await loadFoodFreq();   // キャッシュを空に戻す
  });

  it('記録すると読み出せる（以前は常に空だった）', () => {
    bumpFoodFreq('act:walk');
    expect(readFoodFreq()['act:walk']).toBeTruthy();
  });

  it('同じものを重ねると点数が上がる', () => {
    bumpFoodFreq('act:walk');
    const first = readFoodFreq()['act:walk'].s;
    bumpFoodFreq('act:walk');
    expect(readFoodFreq()['act:walk'].s).toBeGreaterThan(first);
  });

  it('端末に保存され、読み直しても残る', async () => {
    bumpFoodFreq('lift:ベンチプレス');
    await new Promise((r) => setTimeout(r, 0));   // 非同期の書き込みを待つ
    await loadFoodFreq();
    expect(readFoodFreq()['lift:ベンチプレス']).toBeTruthy();
  });

  it('よく使うものほど点数が高い', () => {
    bumpFoodFreq('act:run');
    bumpFoodFreq('act:walk');
    bumpFoodFreq('act:walk');
    bumpFoodFreq('act:walk');
    const sc = foodScores(readFoodFreq());
    expect(sc['act:walk']).toBeGreaterThan(sc['act:run']);
  });

  it('記録していないものは点数を持たない', () => {
    bumpFoodFreq('act:walk');
    expect(foodScores(readFoodFreq())['act:bike']).toBeUndefined();
  });

  it('時間が経つと点数が減る（14日で半分）', () => {
    bumpFoodFreq('act:walk');
    const now = Date.now();
    const fresh = foodScores(readFoodFreq(), now)['act:walk'];
    const later = foodScores(readFoodFreq(), now + 14 * 86400000)['act:walk'];
    expect(later).toBeCloseTo(fresh / 2, 3);
  });

  it('壊れた保存内容でも落ちず、空として扱う', async () => {
    await AsyncStorage.setItem('bl-food-freq-v2', '{壊れたJSON');
    await loadFoodFreq();
    expect(readFoodFreq()).toEqual({});
  });

  it('配列が入っていても空として扱う（形の違いで落ちない）', async () => {
    await AsyncStorage.setItem('bl-food-freq-v2', '[1,2,3]');
    await loadFoodFreq();
    expect(readFoodFreq()).toEqual({});
  });
});
