// 自分の記録の集計と判定（lib/nutrientIntake.ts）
//  ①名寄せ: 「オートミール80g」と「オートミール1杯」は同じ食材／「鶏むね肉」と「鶏もも肉」は別
//  ②1日あたりの平均 = 合計 ÷ 記録のある日数（品目のある日だけ数える）
//  ③不明と 0 を混ぜない: 微量栄養素が全て 0／欠損の品目は「値なし」。1つでも正の値があれば 0 は本当の 0
//  ④判定: 推奨量型 90%/70%・上限型（食塩）は超えたら over・範囲型（脂質）は下限未満で少なめ、上限超えで over
//  ⑤並び: 少なめ → やや少なめ → 超えている → 足りている → 値なし → 基準なし
//  ⑥おすすめ食材: 食べたことのあるものが先・レバーは末尾・上限型と糖類は候補なし
//  ⑦数値の整形は toLocaleString を使わない
import {
  aggregateIntake, perDayAverage, coverageOf, rankFoods, judge, buildGapRows, suggestFoods, eatenFoodIds,
  hasMicroData, itemValue, fmtAmount, fmtRef, fmtPercent, INTAKE_KEYS, INTAKE_GROUPS, intakeMeta, VERDICT_ORDER,
} from '@/lib/nutrientIntake';
import { resolveAllReferences, REF_KEYS, type NutrientRef } from '@/content/dri2025';
import { NUTRIENT_KEYS } from '@/lib/items';

const ai = (name: string, qty: string, over: Record<string, number> = {}) =>
  ({ name, qty, kcal: 100, p: 10, f: 2, c: 5, salt: 0.5, fib: 1, sug: 0, k: 100, ca: 20, mg: 10, fe: 0.5, zn: 0.5, vd: 0, vc: 0, ...over });
const pfcOnly = (name: string) => ({ name, qty: '1個', kcal: 80, p: 6, f: 5, c: 1 });

describe('集計（aggregateIntake）', () => {
  const rows = [
    { date: '2026-09-01', items: [ai('オートミール80g', '80g', { fib: 7.5 }), ai('たまご', '2個', { fe: 1.8, vd: 3.6 })] },
    { date: '2026-09-02', items: [ai('オートミール1杯', '1杯（約40g）', { fib: 3.8 }), pfcOnly('ゆで卵（マイ食品）')] },
    { date: '2026-09-03', items: [] },                 // 品目なし＝記録のある日に数えない
    { date: '2026-09-04', items: null },               // items が無い行
    { date: '2026-09-05', items: [ai('鶏むね肉 120g', '120g', { p: 28 }), ai('鶏もも肉', '100g', { p: 17 })] },
  ];
  const agg = aggregateIntake(rows);

  it('記録のある日数は品目が1つでもある日だけ（3日）・品目数 6', () => {
    expect(agg.days).toBe(3);
    expect(agg.items).toBe(6);
    expect(agg.eatenNames).toContain('オートミール80g');
  });

  it('名寄せ: オートミールは1つに（2回・2日）、鶏むね肉と鶏もも肉は別', () => {
    const oat = agg.foods.find((f) => f.name === 'オートミール')!;
    expect(oat).toBeDefined();
    expect(oat.times).toBe(2);
    expect(oat.days).toBe(2);
    expect(oat.total.fib).toBeCloseTo(11.3);
    expect(agg.foods.filter((f) => /鶏/.test(f.name)).map((f) => f.name).sort()).toEqual(['鶏むね肉', '鶏もも肉']);
  });

  it('1日あたりの平均 = 合計 ÷ 記録のある日数（食物繊維 (7.5+3.8+1+1+1)/3）', () => {
    expect(perDayAverage(agg, 'fib')).toBeCloseTo((7.5 + 3.8 + 1 + 1 + 1) / 3);
    expect(perDayAverage(agg, 'kcal')).toBeCloseTo((100 * 5 + 80) / 3);
  });

  it('不明と 0 を混ぜない: PFC だけの品目は微量栄養素の分子に入らない（coverage 5/6）。全 0 でも1つ正があれば 0 は値', () => {
    expect(coverageOf(agg, 'fib')).toEqual({ known: 5, items: 6 });
    expect(coverageOf(agg, 'kcal')).toEqual({ known: 6, items: 6 });
    expect(hasMicroData(pfcOnly('x'))).toBe(false);
    expect(hasMicroData({ name: 'x', salt: 0, fib: 0, k: 0 })).toBe(false);
    expect(hasMicroData({ name: 'x', salt: 0, fib: 0, k: 1 })).toBe(true);
    expect(itemValue({ name: 'x', salt: 0, fib: 0, k: 1 }, 'vd')).toBeNull();   // キーが無い → 不明
    expect(itemValue({ name: 'x', salt: 0, fib: 0, k: 1 }, 'fib')).toBe(0);     // 値のある品目の 0 は 0
    expect(itemValue(pfcOnly('x'), 'p')).toBe(6);
    // 新キー（旧記録には無い）は不明
    expect(perDayAverage(agg, 'vb1')).toBeNull();
    expect(coverageOf(agg, 'se')).toEqual({ known: 0, items: 6 });
  });

  it('ランキングは合計の多い順・1日平均つき・0 の食材は載らない', () => {
    const r = rankFoods(agg, 'fib', 10);
    expect(r[0].food.name).toBe('オートミール');
    expect(r[0].perDay).toBeCloseTo(11.3 / 3);
    expect(r.every((x) => x.total > 0)).toBe(true);
    // ビタミンD はたまごだけ（他は 0）
    const vd = rankFoods(agg, 'vd', 10);
    expect(vd.map((x) => x.food.name)).toEqual(['たまご']);
    expect(rankFoods(aggregateIntake([]), 'p')).toEqual([]);
  });

  it('壊れた品目（名前なし・オブジェクトでない）は飛ばす', () => {
    const a = aggregateIntake([{ date: '2026-09-01', items: [{ qty: '1' }, 'x', null, ai('ごはん', '150g')] }]);
    expect(a.items).toBe(1);
    expect(a.days).toBe(1);
  });
});

describe('判定（judge）', () => {
  const rda = (target: number): NutrientRef => ({ key: 'ca', kind: 'rda', target, unit: 'mg', sexUsed: 'male', bandUsed: '30-49', approximate: false });
  it('推奨量型: 90% 以上で足りている・70% 以上でやや少なめ・それ未満は少なめ', () => {
    expect(judge(700, rda(750))).toMatchObject({ verdict: 'ok' });
    expect(judge(675, rda(750)).verdict).toBe('ok');          // ちょうど 90%
    expect(judge(600, rda(750)).verdict).toBe('slightlyLow'); // 80%
    expect(judge(525, rda(750)).verdict).toBe('slightlyLow'); // ちょうど 70%
    expect(judge(400, rda(750)).verdict).toBe('low');
    expect(judge(400, rda(750)).ratio).toBeCloseTo(400 / 750);
  });
  it('上限型（食塩）: 上限以下は ok・超えたら over。範囲型（脂質）: 下限未満は少なめ・上限超えは over', () => {
    const salt: NutrientRef = { key: 'salt', kind: 'dg_upper', target: 7.5, unit: 'g', sexUsed: 'male', bandUsed: '30-49', approximate: false };
    expect(judge(3, salt).verdict).toBe('ok');    // 0 に近くても達成扱い
    expect(judge(7.5, salt).verdict).toBe('ok');
    expect(judge(9, salt)).toMatchObject({ verdict: 'over', ratio: 1.2 });
    const fat: NutrientRef = { key: 'f', kind: 'dg_range', target: 49, upper: 73, unit: 'g', sexUsed: 'male', bandUsed: '30-49', approximate: false };
    expect(judge(60, fat).verdict).toBe('ok');
    expect(judge(30, fat).verdict).toBe('low');
    expect(judge(40, fat).verdict).toBe('slightlyLow');
    expect(judge(90, fat).verdict).toBe('over');
  });
  it('平均が無ければ noData・基準が無ければ noRef', () => {
    expect(judge(null, rda(750)).verdict).toBe('noData');
    expect(judge(10, null).verdict).toBe('noRef');
  });
});

describe('不足栄養素の並び（buildGapRows）', () => {
  const profile = { sex: 'male' as const, age: 35, weightKg: 70, targetKcal: 2200, proteinPerKg: 2.0 };
  const refs = resolveAllReferences(profile);
  // 1日: たんぱく質 140g（足りている）・脂質 60g／炭水化物 300g（範囲内）・カルシウム 300（少なめ）・鉄 6（やや少なめ 80%）・食塩 10（超えている）
  const day = (d: string) => ({ date: d, items: [ai('定食', '1人前', { p: 140, f: 60, c: 300, ca: 300, fe: 6.0, salt: 10, fib: 22, k: 3000, zn: 9.5, mg: 380, vd: 9, vc: 100 })] });
  const agg = aggregateIntake([day('2026-09-01'), day('2026-09-02')]);
  const rows = buildGapRows(agg, refs, REF_KEYS);

  it('少なめ → やや少なめ → 超えている → 足りている → 値なし → 基準なし の順', () => {
    const order = rows.map((r) => VERDICT_ORDER[r.verdict]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(rows.find((r) => r.key === 'ca')!.verdict).toBe('low');
    expect(rows.find((r) => r.key === 'fe')!.verdict).toBe('slightlyLow');
    expect(rows.find((r) => r.key === 'salt')!.verdict).toBe('over');
    expect(rows.find((r) => r.key === 'p')!.verdict).toBe('ok');
    expect(rows.find((r) => r.key === 'vb1')!.verdict).toBe('noData');   // 旧記録に無いキー
    expect(rows.find((r) => r.key === 'sug')!.verdict).toBe('noRef');
    expect(rows[0].key).toBe('ca');
    expect(rows[rows.length - 1].key).toBe('sug');
  });
  it('同じ判定の中は比の小さい順（少なめ側が先）', () => {
    const lows = rows.filter((r) => r.verdict === 'low').map((r) => r.ratio ?? 0);
    expect(lows).toEqual([...lows].sort((a, b) => a - b));
  });
  it('全キーぶんの行がある', () => {
    expect(rows.map((r) => r.key).sort()).toEqual([...REF_KEYS].sort());
  });
});

describe('おすすめ食材（suggestFoods）', () => {
  it('図鑑に軸がある栄養素は1食の目安量あたりの多い順。食べたことのある食材が先頭', () => {
    const eaten = eatenFoodIds(['木綿豆腐の冷奴', 'ごはん']);
    expect(eaten.has('tofu_firm')).toBe(true);
    const list = suggestFoods('ca', eaten);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].food.id).toBe('tofu_firm');
    expect(list[0].eaten).toBe(true);
    expect(list[0].perServing).toBeGreaterThan(0);
    // 食べたもの以外は多い順のまま
    const rest = list.filter((x) => !x.eaten).map((x) => x.perServing ?? 0);
    expect(rest).toEqual([...rest].sort((a, b) => b - a));
  });
  it('図鑑に軸が無い栄養素（ビタミンB12・マグネシウム）は用意した並び。レバーは末尾で注記フラグ', () => {
    const b12 = suggestFoods('vb12', new Set(), undefined, 20);
    expect(b12.length).toBeGreaterThan(3);
    expect(b12[0].food.id).toBe('clam');
    const liverIdx = b12.findIndex((x) => x.liver);
    expect(liverIdx).toBeGreaterThan(2);
    expect(b12.slice(liverIdx).every((x) => x.liver)).toBe(true);
    expect(suggestFoods('mg', new Set())[0].food.id).toBe('almond');
  });
  it('上限型（食塩・飽和脂肪酸）と糖類は候補を出さない', () => {
    expect(suggestFoods('salt', new Set())).toEqual([]);
    expect(suggestFoods('satfat', new Set())).toEqual([]);
    expect(suggestFoods('sug', new Set())).toEqual([]);
  });
  it('基準のある全キーで候補が出る（食塩・飽和脂肪酸・糖類を除く）', () => {
    const none = REF_KEYS.filter((k) => k !== 'salt' && k !== 'satfat' && k !== 'sug' && suggestFoods(k, new Set()).length === 0);
    expect(none).toEqual([]);
  });
});

describe('メタ・整形', () => {
  it('INTAKE_KEYS は kcal・P/F/C ＋ NUTRIENT_KEYS。グループ分けは NUTRIENT_KEYS と P/F/C を全て1回ずつ含む', () => {
    expect(INTAKE_KEYS).toEqual(['kcal', 'p', 'f', 'c', ...NUTRIENT_KEYS]);
    const grouped = [...INTAKE_GROUPS.main, ...INTAKE_GROUPS.vitamin, ...INTAKE_GROUPS.mineral];
    expect([...grouped].sort()).toEqual(['p', 'f', 'c', ...NUTRIENT_KEYS].sort());
    expect(intakeMeta('vb12')).toEqual({ label: 'ビタミンB12', unit: 'µg', decimals: 1 });
    expect(intakeMeta('p').unit).toBe('g');
  });
  it('fmtAmount は栄養素の桁で丸め、3桁区切り。fmtRef は不要な小数を落とす', () => {
    expect(fmtAmount('k', 2345.6)).toBe('2,346');
    expect(fmtAmount('fe', 7.25)).toBe('7.3');
    expect(fmtAmount('vb1', 0.847)).toBe('0.85');
    expect(fmtAmount('kcal', 1234)).toBe('1,234');
    expect(fmtRef(7.5)).toBe('7.5');
    expect(fmtRef(150)).toBe('150');
    expect(fmtRef(0.9)).toBe('0.9');
    expect(fmtRef(2600)).toBe('2,600');
    expect(fmtPercent(0.834)).toBe('83%');
    expect(fmtPercent(null)).toBe('—');
  });
});
