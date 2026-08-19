// 提案の判定: 同じ日の複数回で誤検知しない・既登録や辞退を除外する・1日1件
import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordItems, pickSuggestion, markDeclined, markShown, _internal } from '@/lib/foodSuggest';
import type { FoodItem } from '@/lib/items';

const item = (name: string, kcal = 300): FoodItem => ({
  name, qty: '×1', kcal, p: 10, f: 5, c: 40,
});

beforeEach(async () => { await AsyncStorage.clear(); });

describe('recordItems と pickSuggestion', () => {
  it('同じ日に3回食べても提案しない（1日は1カウント）', async () => {
    await recordItems([item('オートミール80g')], '2026-08-19');
    await recordItems([item('オートミール80g')], '2026-08-19');
    await recordItems([item('オートミール80g')], '2026-08-19');
    expect(await pickSuggestion([], '2026-08-19')).toBeNull();
  });

  it('別々の3日に出たら提案する', async () => {
    await recordItems([item('オートミール80g')], '2026-08-17');
    await recordItems([item('オートミール 1杯')], '2026-08-18');
    await recordItems([item('オートミール80g')], '2026-08-19');
    const s = await pickSuggestion([], '2026-08-19');
    expect(s?.name).toBe('オートミール');
    expect(s?.days).toBe(3);
  });

  it('分量が違っても同じ食品として数える', async () => {
    await recordItems([item('オートミール80g')], '2026-08-17');
    await recordItems([item('オートミール 1カップ（約80g）')], '2026-08-18');
    await recordItems([item('オートミール')], '2026-08-19');
    expect((await pickSuggestion([], '2026-08-19'))?.days).toBe(3);
  });

  it('2日だけでは提案しない', async () => {
    await recordItems([item('納豆')], '2026-08-18');
    await recordItems([item('納豆')], '2026-08-19');
    expect(await pickSuggestion([], '2026-08-19')).toBeNull();
  });

  it('すでにマイ食品にある名前は提案しない', async () => {
    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19']) {
      await recordItems([item('鶏むね肉 200g')], d);
    }
    expect(await pickSuggestion(['鶏むね肉'], '2026-08-19')).toBeNull();
    expect(await pickSuggestion(['鶏むね肉100g'], '2026-08-19')).toBeNull(); // 分量違いでも同一
  });

  it('一度断られたら二度と提案しない', async () => {
    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19']) {
      await recordItems([item('ヨーグルト')], d);
    }
    const first = await pickSuggestion([], '2026-08-19');
    expect(first).not.toBeNull();
    await markDeclined(first!.key);
    expect(await pickSuggestion([], '2026-08-19')).toBeNull();
  });

  it('1日1件まで（出したら同じ日は出さない）', async () => {
    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19']) {
      await recordItems([item('オートミール')], d);
      await recordItems([item('ゆで卵')], d);
    }
    expect(await pickSuggestion([], '2026-08-19')).not.toBeNull();
    await markShown('2026-08-19');
    expect(await pickSuggestion([], '2026-08-19')).toBeNull();
    // 翌日はまた出る
    expect(await pickSuggestion([], '2026-08-20')).not.toBeNull();
  });

  it('7日より前の出現は数えない', async () => {
    await recordItems([item('そば')], '2026-08-01');
    await recordItems([item('そば')], '2026-08-02');
    await recordItems([item('そば')], '2026-08-19');
    expect(await pickSuggestion([], '2026-08-19')).toBeNull();
  });

  it('栄養値が取れていないものは提案しない', async () => {
    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19']) {
      await recordItems([item('水', 0)], d);
    }
    expect(await pickSuggestion([], '2026-08-19')).toBeNull();
  });

  it('別の食品は混同しない（鶏むね肉と鶏もも肉）', async () => {
    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19']) {
      await recordItems([item('鶏むね肉 200g')], d);
    }
    await recordItems([item('鶏もも肉 200g')], '2026-08-19');
    const s = await pickSuggestion([], '2026-08-19');
    expect(s?.name).toBe('鶏むね肉');   // ももは1日だけなので選ばれない
  });

  it('最頻の分量が単位の初期値になる', async () => {
    await recordItems([item('オートミール80g')], '2026-08-17');
    await recordItems([item('オートミール80g')], '2026-08-18');
    await recordItems([item('オートミール 1杯')], '2026-08-19');
    expect((await pickSuggestion([], '2026-08-19'))?.portion).toBe('80g');
  });

  it('候補が複数なら出現日数が多い方を選ぶ', async () => {
    for (const d of ['2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19']) {
      await recordItems([item('プロテイン')], d);
    }
    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19']) {
      await recordItems([item('バナナ')], d);
    }
    expect((await pickSuggestion([], '2026-08-19'))?.name).toBe('プロテイン');
  });

  it('空の品目や分量だけの名前では何も記録しない', async () => {
    await recordItems([], '2026-08-19');
    await recordItems([item('80g')], '2026-08-19');
    expect(await pickSuggestion([], '2026-08-19')).toBeNull();
  });
});

describe('しきい値の定数', () => {
  it('日単位の判定になっている（設計どおり3日・7日窓）', () => {
    expect(_internal.NEED_DAYS).toBe(3);
    expect(_internal.WINDOW_DAYS).toBe(7);
  });
});
