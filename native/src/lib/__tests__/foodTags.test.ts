// 食材タグ辞書（content/foodTags）: 品名の部分一致と分量推定を固定する
import { tagsOf, gramsFromQty, itemTagGrams, sumTagGrams, FOOD_TAG_STD_G } from '@/content/foodTags';

describe('foodTags: tagsOf', () => {
  it('小麦・米・鶏・鮭・魚・乳・甘い飲み物を品名から拾う', () => {
    expect(tagsOf('食パン 6枚切り')).toEqual(['wheat']);
    expect(tagsOf('ご飯')).toEqual(['rice']);
    expect(tagsOf('サラダチキン')).toEqual(['chicken']);
    expect(tagsOf('牛乳')).toEqual(['dairy']);
    expect(tagsOf('コカ・コーラ')).toEqual(['sugar_drink']);
    expect(tagsOf('さばの味噌煮')).toEqual(['fish']);
  });

  it('サーモンは salmon と fish の両方、鮭おにぎりは rice も付く', () => {
    expect(tagsOf('スモークサーモン').sort()).toEqual(['fish', 'salmon']);
    expect(tagsOf('鮭おにぎり').sort()).toEqual(['fish', 'rice', 'salmon']);
  });

  it('除外語: 無糖・鶏卵・米粉・すいか・どんぶり は誤爆しない', () => {
    expect(tagsOf('無糖 コーラ')).toEqual([]);
    expect(tagsOf('鶏卵 2個')).toEqual([]);
    expect(tagsOf('米粉パン')).toEqual(['wheat']);   // 米ではなくパン（米粉は除外・パンは小麦）
    expect(tagsOf('すいか')).toEqual([]);
    expect(tagsOf('牛丼')).toEqual(['rice']);        // 「ぶり」に誤爆しない
    expect(tagsOf('豆乳')).toEqual([]);
    expect(tagsOf('')).toEqual([]);
  });
});

describe('foodTags: gramsFromQty / itemTagGrams', () => {
  it('g/kg/ml を読む。上限2000で頭打ち', () => {
    expect(gramsFromQty('150g')).toBe(150);
    expect(gramsFromQty('0.5kg')).toBe(500);
    expect(gramsFromQty('200ml')).toBe(200);
    expect(gramsFromQty('１５０ｇ')).toBe(150);   // 全角
    expect(gramsFromQty('15000g')).toBe(2000);
  });

  it('個数単位は単位ごとの目安×個数。読めなければ null → 標準量', () => {
    expect(gramsFromQty('2枚')).toBe(120);       // 枚=60g
    expect(gramsFromQty('1杯')).toBe(150);
    expect(gramsFromQty('1/2個')).toBe(50);
    expect(gramsFromQty('大盛り')).toBeNull();
    expect(gramsFromQty('')).toBeNull();
    expect(itemTagGrams('うどん', '大盛り')).toEqual({ wheat: FOOD_TAG_STD_G.wheat });
    expect(itemTagGrams('サーモン', '80g')).toEqual({ salmon: 80, fish: 80 });
    expect(itemTagGrams('ブロッコリー', '100g')).toEqual({});
  });

  it('sumTagGrams は全タグを0埋めして合算する', () => {
    const g = sumTagGrams([{ name: 'ご飯', qty: '200g' }, { name: '鮭', qty: '1切れ' }, { name: '牛乳', qty: '200ml' }]);
    expect(g).toEqual({ wheat: 0, rice: 200, chicken: 0, salmon: 80, fish: 80, dairy: 200, sugar_drink: 0 });
  });
});
