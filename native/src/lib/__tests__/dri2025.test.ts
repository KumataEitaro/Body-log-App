// 日本人の食事摂取基準（2025年版）の転記と解決規則を固定する（content/dri2025.ts）
//  ①全キー・全区分に値がある／推奨量型は推定平均必要量 ≤ 推奨量／非負
//  ②年齢→区分の境界（17/18・29/30・49/50・64/65・74/75）
//  ③照合済みアンカー（一次資料の表と一致させた代表値）
//  ④解決規則: たんぱく質は体重×g/kg 優先・%E 型は維持カロリーが要る・鉄は月経あり/なし・未設定は参考値・糖類は基準なし
import { NUTRIENT_KEYS } from '@/lib/items';
import { PROTEIN_PER_KG_DEFAULT } from '@/lib/goal';
import { DRI, AGE_BANDS, REF_KEYS, ageBandOf, resolveReference, resolveAllReferences, type RefKey } from '@/content/dri2025';

describe('転記の健全性', () => {
  it('%E 型と糖類を除く全キーが表にあり、5区分×男女で非負。推奨量型は EAR ≤ RDA', () => {
    const offenders: string[] = [];
    for (const key of REF_KEYS) {
      if (key === 'f' || key === 'c' || key === 'sug' || key === 'satfat') continue;
      const tbl = DRI[key];
      if (!tbl) { offenders.push(`${key}: 表なし`); continue; }
      for (let i = 0; i < AGE_BANDS.length; i++) {
        for (const sex of ['male', 'female'] as const) {
          const v = tbl[sex][i];
          if (!(v >= 0) || !Number.isFinite(v)) offenders.push(`${key}/${sex}/${AGE_BANDS[i]}: ${v}`);
          const ear = sex === 'male' ? tbl.earMale?.[i] : tbl.earFemale?.[i];
          if (ear != null && ear > v) offenders.push(`${key}/${sex}/${AGE_BANDS[i]}: EAR ${ear} > RDA ${v}`);
        }
      }
      if (tbl.kind === 'rda' && (!tbl.earMale || !tbl.earFemale)) offenders.push(`${key}: 推奨量型なのに EAR が無い`);
    }
    expect(offenders).toEqual([]);
    // NUTRIENT_KEYS のうち基準を持たないのは糖類（2025年版に目標量なし）と飽和脂肪酸（%E 型）だけ
    expect(NUTRIENT_KEYS.filter((k) => !(k in DRI))).toEqual(['sug', 'satfat']);
  });

  it('照合済みアンカー（一次資料の表と一致）', () => {
    expect(DRI.p.male).toEqual([65, 65, 65, 60, 60]);
    expect(DRI.fib.male).toEqual([20, 22, 22, 21, 20]);
    expect(DRI.salt.female).toEqual([6.5, 6.5, 6.5, 6.5, 6.5]);
    expect(DRI.ca.male[0]).toBe(800);
    expect(DRI.ca.female[4]).toBe(600);
    expect(DRI.fe.femaleMenses).toEqual([10.0, 10.5, 10.5]);
    expect(DRI.fe.male[1]).toBe(7.5);
    expect(DRI.zn.male).toEqual([9.0, 9.5, 9.5, 9.0, 9.0]);
    expect(DRI.vd.male[0]).toBe(9.0);
    expect(DRI.vb1.male).toEqual([1.1, 1.2, 1.1, 1.0, 1.0]);   // 2025年版で下がった値
    expect(DRI.vb12.female[0]).toBe(4.0);                       // 2025年版は目安量
    expect(DRI.iod.male[0]).toBe(140);
    expect(DRI.se.male[1]).toBe(35);
    expect(DRI.mo.male[4]).toBe(25);
    expect(DRI.n3.female).toEqual([1.7, 1.7, 1.9, 2.0, 2.0]);
  });
});

describe('ageBandOf', () => {
  it('境界: 17→18-29（参考）・18→18-29・29→18-29・30→30-49・49・50・64・65・74・75・不明→null', () => {
    expect(ageBandOf(17)).toBe('18-29');
    expect(ageBandOf(18)).toBe('18-29');
    expect(ageBandOf(29)).toBe('18-29');
    expect(ageBandOf(30)).toBe('30-49');
    expect(ageBandOf(49)).toBe('30-49');
    expect(ageBandOf(50)).toBe('50-64');
    expect(ageBandOf(64)).toBe('50-64');
    expect(ageBandOf(65)).toBe('65-74');
    expect(ageBandOf(74)).toBe('65-74');
    expect(ageBandOf(75)).toBe('75+');
    expect(ageBandOf(90)).toBe('75+');
    expect(ageBandOf(null)).toBeNull();
    expect(ageBandOf(NaN)).toBeNull();
    expect(ageBandOf(0)).toBeNull();
  });
});

describe('resolveReference', () => {
  const man = { sex: 'male' as const, age: 35, weightKg: 70, targetKcal: 2200, proteinPerKg: null };
  const woman = { sex: 'female' as const, age: 28, weightKg: 52, targetKcal: 1800, proteinPerKg: 1.6 };

  it('たんぱく質は体重×g/kg（既定 2.0）。体重が無ければ推奨量', () => {
    expect(resolveReference('p', man)).toMatchObject({ kind: 'app', target: 70 * PROTEIN_PER_KG_DEFAULT, perKg: PROTEIN_PER_KG_DEFAULT });
    expect(resolveReference('p', woman)).toMatchObject({ kind: 'app', target: Math.round(52 * 1.6), perKg: 1.6 });
    expect(resolveReference('p', { ...man, weightKg: null })).toMatchObject({ kind: 'rda', target: 65, ear: 50, bandUsed: '30-49', sexUsed: 'male' });
  });

  it('脂質・炭水化物は %E の範囲を g に換算。飽和脂肪酸は 7%E の上限。維持カロリーが無ければ null', () => {
    expect(resolveReference('f', man)).toMatchObject({ kind: 'dg_range', target: Math.round(2200 * 0.2 / 9), upper: Math.round(2200 * 0.3 / 9), percentE: { lower: 20, upper: 30 } });
    expect(resolveReference('c', man)).toMatchObject({ kind: 'dg_range', target: Math.round(2200 * 0.5 / 4), upper: Math.round(2200 * 0.65 / 4) });
    expect(resolveReference('satfat', man)).toMatchObject({ kind: 'dg_upper', target: Math.round(2200 * 0.07 / 9) });
    expect(resolveReference('f', { ...man, targetKcal: null })).toBeNull();
    expect(resolveReference('satfat', { ...man, targetKcal: null })).toBeNull();
  });

  it('糖類は基準なし（null）', () => {
    expect(resolveReference('sug', man)).toBeNull();
  });

  it('鉄: 50歳未満の女性は月経あり（10.0）が既定・「なし」を選ぶと 6.0・65歳以上は月経の区別なし・男性は 7.5', () => {
    expect(resolveReference('fe', woman)).toMatchObject({ target: 10.0, ear: 7.0, menses: true });
    expect(resolveReference('fe', { ...woman, menstruating: false })).toMatchObject({ target: 6.0, ear: 5.0, menses: false });
    expect(resolveReference('fe', { ...woman, age: 55 })).toMatchObject({ target: 10.5, menses: true });
    const older = resolveReference('fe', { ...woman, age: 70 })!;
    expect(older.target).toBe(6.0);
    expect(older.menses).toBeUndefined();
    expect(resolveReference('fe', man)).toMatchObject({ target: 7.5, ear: 6.0 });
    expect(resolveReference('fe', man)!.menses).toBeUndefined();
  });

  it('性別・年齢が未設定なら女性・30〜49歳の値を参考値として使う（approximate）。18歳未満も参考値', () => {
    const r = resolveReference('ca', { sex: null, age: null, weightKg: null, targetKcal: null })!;
    expect(r).toMatchObject({ sexUsed: 'female', bandUsed: '30-49', target: 650, approximate: true });
    expect(resolveReference('ca', { ...man, age: null })).toMatchObject({ sexUsed: 'male', bandUsed: '30-49', approximate: true });
    expect(resolveReference('ca', { ...man, age: 16 })).toMatchObject({ bandUsed: '18-29', approximate: true });
    expect(resolveReference('ca', man)!.approximate).toBe(false);
  });

  it('区分ごとの値を引く（ビタミンE 65〜74歳男性 7.5・カルシウム 75歳以上女性 600・食塩は上限型）', () => {
    expect(resolveReference('ve', { ...man, age: 70 })).toMatchObject({ kind: 'ai', target: 7.5 });
    expect(resolveReference('ca', { ...woman, age: 80 })).toMatchObject({ kind: 'rda', target: 600, ear: 500 });
    expect(resolveReference('salt', woman)).toMatchObject({ kind: 'dg_upper', target: 6.5 });
    expect(resolveReference('k', man)).toMatchObject({ kind: 'dg_lower', target: 3000 });
    expect(resolveReference('vb12', man)).toMatchObject({ kind: 'ai', target: 4.0 });
    expect(resolveReference('vb12', man)!.ear).toBeUndefined();
  });

  it('resolveAllReferences は全キーを返す（糖類だけ null、維持カロリー不明なら f/c/satfat も null）', () => {
    const all = resolveAllReferences(man);
    expect(Object.keys(all).sort()).toEqual([...REF_KEYS].sort());
    const nulls = (Object.keys(all) as RefKey[]).filter((k) => all[k] == null);
    expect(nulls).toEqual(['sug']);
    const noKcal = resolveAllReferences({ ...man, targetKcal: null });
    expect((Object.keys(noKcal) as RefKey[]).filter((k) => noKcal[k] == null).sort()).toEqual(['c', 'f', 'satfat', 'sug']);
  });
});
