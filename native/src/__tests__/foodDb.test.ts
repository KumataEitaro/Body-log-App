// Open Food Factsレスポンスのパース（純関数）のテスト
// fixtureは実際のOFF v2レスポンス形状に合わせている（nutrimentsは文字列で来ることもある）
import { parseOffProduct, parseQuantityG, packageNutrition } from '@/lib/foodDb';

// 完全な日本商品のfixture（100gあたり＋1食分＋内容量）
const FULL = {
  status: 1,
  product: {
    product_name: 'Morning Protein Bar',
    product_name_ja: 'モーニングプロテインバー',
    brands: 'テストブランド, Global Foods',
    serving_size: '45g',
    quantity: '450g',
    nutriments: {
      'energy-kcal_100g': 380,
      proteins_100g: 30.5,
      fat_100g: 12,
      carbohydrates_100g: 40.2,
      'energy-kcal_serving': 171,
      proteins_serving: 13.7,
      fat_serving: 5.4,
      carbohydrates_serving: 18.1,
    },
  },
};

describe('parseOffProduct', () => {
  test('完全な商品: 100gあたりのenergy/PFC・日本語名優先・ブランド先頭・serving・内容量が取れる', () => {
    const fd = parseOffProduct(FULL)!;
    expect(fd).not.toBeNull();
    expect(fd.name).toBe('モーニングプロテインバー');   // product_name_jaを優先
    expect(fd.brand).toBe('テストブランド');             // カンマ区切りの先頭
    expect(fd.per100g).toEqual({ kcal: 380, p: 30.5, f: 12, c: 40.2 });
    expect(fd.serving).toEqual({ size: '45g', kcal: 171, p: 13.7, f: 5.4, c: 18.1 });
    expect(fd.quantityG).toBe(450);
  });

  test('nutrimentsが文字列でも数値として読める（OFFは文字列で返すことがある）', () => {
    const fd = parseOffProduct({
      status: 1,
      product: {
        product_name: 'String Nutrients',
        nutriments: { 'energy-kcal_100g': '52', proteins_100g: '0.3', fat_100g: '0.2', carbohydrates_100g: '13.8' },
      },
    })!;
    expect(fd.per100g).toEqual({ kcal: 52, p: 0.3, f: 0.2, c: 13.8 });
    expect(fd.name).toBe('String Nutrients');   // 日本語名が無ければproduct_name
    expect(fd.brand).toBeNull();
    expect(fd.serving).toBeNull();              // serving系が無ければnull
    expect(fd.quantityG).toBeNull();
  });

  test('エネルギー欠損はnull（公式値として使えない→AI推定へフォールバック）', () => {
    expect(parseOffProduct({
      status: 1,
      product: { product_name: 'No Energy', nutriments: { proteins_100g: 10, fat_100g: 5, carbohydrates_100g: 20 } },
    })).toBeNull();
  });

  test('PFCのいずれか欠損もnull（proteins_100gなし）', () => {
    expect(parseOffProduct({
      status: 1,
      product: { product_name: 'No Protein', nutriments: { 'energy-kcal_100g': 200, fat_100g: 5, carbohydrates_100g: 20 } },
    })).toBeNull();
  });

  test('未ヒット（status 0 / productなし）・不正な入力はnull', () => {
    expect(parseOffProduct({ status: 0 })).toBeNull();
    expect(parseOffProduct(null)).toBeNull();
    expect(parseOffProduct('garbage')).toBeNull();
    expect(parseOffProduct({})).toBeNull();
  });

  test('名前が空の商品はnull（記録に使えない）', () => {
    expect(parseOffProduct({
      status: 1,
      product: { product_name: '  ', nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 } },
    })).toBeNull();
  });

  test('servingはkcalがあるときだけ採用（PFCのserving欠けはnullのまま保持）', () => {
    const fd = parseOffProduct({
      status: 1,
      product: {
        product_name: 'Serving Kcal Only',
        serving_size: '30 g',
        nutriments: {
          'energy-kcal_100g': 400, proteins_100g: 20, fat_100g: 10, carbohydrates_100g: 50,
          'energy-kcal_serving': 120,
        },
      },
    })!;
    expect(fd.serving).toEqual({ size: '30 g', kcal: 120, p: null, f: null, c: null });
  });
});

describe('parseQuantityG', () => {
  test('g/kg/ml/Lをgへ換算（mlは1g/ml近似）・読めない表記はnull', () => {
    expect(parseQuantityG('450g')).toBe(450);
    expect(parseQuantityG('1kg')).toBe(1000);
    expect(parseQuantityG('500 ml')).toBe(500);
    expect(parseQuantityG('1.5L')).toBe(1500);
    expect(parseQuantityG('6本入り')).toBeNull();
    expect(parseQuantityG(undefined)).toBeNull();
  });
});

describe('packageNutrition', () => {
  test('内容量から1個ぶんのkcal/PFCを換算（450g × 380kcal/100g → 1710kcal）', () => {
    const fd = parseOffProduct(FULL)!;
    expect(packageNutrition(fd)).toEqual({ g: 450, kcal: 1710, p: 137.3, f: 54, c: 180.9 });
  });

  test('内容量が読めない商品はnull', () => {
    const fd = parseOffProduct({
      status: 1,
      product: { product_name: 'No Qty', nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 } },
    })!;
    expect(packageNutrition(fd)).toBeNull();
  });
});
