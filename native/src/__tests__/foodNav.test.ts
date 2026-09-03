// 食材ナビ（content/nutrientDb・lib/smartSwap・content/proteinTiers・laws の protein_tier・remote 'nutrients'）を固定する。
// 守りたいこと:
//  ①栄養DBの品目数・idの一意・各栄養素が100gあたりの妥当範囲に収まる（桁違いの打ち間違いを止める）
//  ②主要品目の値が成分表と一致する（照合済みのアンカー）
//  ③品目名の最長一致で食材が引ける
//  ④置き換えの式（同じ栄養素量で、減量は少ないkcal・増量は多いkcal・最大3件・非現実な個数は出さない）
//  ⑤言い方の規約（禁止語ゼロ）を全出力に対して
//  ⑥ティアの判定（減量/増量で基準が切り替わる）と理由文
//  ⑦個人化（tierShareOf・detectProteinTierLaw）の閾値と文言
//  ⑧リモート kind 'nutrients' の検証とマージ
// テストはロケール未設定（=日本語キーがそのまま返る）前提
import {
  NUTRIENT_DB, NUTRIENT_META, NAV_NUTRIENTS, getNutrientDb, findFood, rankByNutrient, signatureNutrient, nutrientOf,
} from '@/content/nutrientDb';
import { swapsFor, swapsForFood, swapLine, swapKcalDelta, hasForbiddenWord, FORBIDDEN_WORDS, roundUnits, MAX_SWAPS } from '@/lib/smartSwap';
import { tierOf, tierRank, tierTable, tierReason, tierShareOf, proteinFoods, tierPromptSummary, TIERS } from '@/content/proteinTiers';
import { detectProteinTierLaw, lawVariant, lawText, LAW_KINDS } from '@/lib/laws';
import { getLawArticle } from '@/content/evidence';
import { mergeRemoteRows, resetRemoteContentForTest, validateNutrientFood, NUTRIENT_RANGE_MAX, EMPTY_REMOTE, type RemoteRow } from '@/lib/remoteContent';

const byId = (id: string) => NUTRIENT_DB.find((f) => f.id === id)!;

afterEach(() => resetRemoteContentForTest(EMPTY_REMOTE));

describe('栄養DB（content/nutrientDb）', () => {
  it('約80品あり、idは一意', () => {
    expect(NUTRIENT_DB.length).toBeGreaterThanOrEqual(80);
    expect(new Set(NUTRIENT_DB.map((f) => f.id)).size).toBe(NUTRIENT_DB.length);
  });

  it('全品目の値が100gあたりの妥当範囲に収まる（kcal≤900・P/F/C≤100・微量栄養素は NUTRIENT_RANGE_MAX）', () => {
    const offenders: string[] = [];
    for (const f of NUTRIENT_DB) {
      const p = f.per100;
      if (p.kcal < 0 || p.kcal > 900) offenders.push(`${f.id}: kcal ${p.kcal}`);
      for (const k of ['p', 'f', 'c'] as const) if (p[k] < 0 || p[k] > 100) offenders.push(`${f.id}: ${k} ${p[k]}`);
      for (const k of NAV_NUTRIENTS) {
        const [lo, hi] = NUTRIENT_META[k].range;
        if (p[k] < lo || p[k] > hi) offenders.push(`${f.id}: ${k} ${p[k]}`);
      }
      // P/F/C のkcal換算が表示kcalから極端に外れていない（打ち間違い検出）。
      // 海藻は八訂で食物繊維・糖アルコールに低いエネルギー換算係数を使うため、炭水化物×4 から大きく下がる＝対象外
      const est = p.p * 4 + p.f * 9 + p.c * 4;
      if (f.cat !== 'seaweed' && p.kcal > 30 && Math.abs(est - p.kcal) > Math.max(60, p.kcal * 0.35)) offenders.push(`${f.id}: kcal ${p.kcal} vs PFC換算 ${est}`);
      if (f.unit.g <= 0 || f.serving <= 0) offenders.push(`${f.id}: unit/serving`);
      if (typeof f.name !== 'string' && (!f.name.ja || !f.name.en)) offenders.push(`${f.id}: name`);
    }
    expect(offenders).toEqual([]);
  });

  it('妥当範囲のメタは remoteContent の NUTRIENT_RANGE_MAX と一致（同梱テストとリモート検証が同じ物差し）', () => {
    for (const k of NAV_NUTRIENTS) expect(NUTRIENT_META[k].range[1]).toBe(NUTRIENT_RANGE_MAX[k]);
  });

  it('照合済みアンカー: 赤パプリカVC170・納豆P16.5・かきZn14・アーモンドVE30・ひまわり油VE39・鶏レバーVA14000・豚レバーFe13・乾燥わかめCa780/繊維32.7', () => {
    expect(byId('red_pepper').per100.vc).toBe(170);
    expect(byId('natto').per100.p).toBe(16.5);
    expect(byId('oyster').per100.zn).toBe(14.0);
    expect(byId('almond').per100.ve).toBe(30.0);
    expect(byId('sunflower_oil').per100.ve).toBe(39.0);
    expect(byId('chicken_liver').per100.va).toBe(14000);
    expect(byId('pork_liver').per100.fe).toBe(13.0);
    expect(byId('wakame_dry').per100.ca).toBe(780);
    expect(byId('wakame_dry').per100.fib).toBe(32.7);
    expect(byId('chicken_breast').per100.p).toBe(23.3);
  });

  it('findFood: 最長一致（赤パプリカ→赤パプリカ、鶏むね肉のソテー→鶏むね、サラダチキン→サラダチキン、鶏もも肉（皮なし）→皮なし）。無ければ null', () => {
    expect(findFood('赤パプリカのマリネ')?.id).toBe('red_pepper');
    expect(findFood('鶏むね肉のソテー 120g')?.id).toBe('chicken_breast');
    expect(findFood('サラダチキン（プレーン）')?.id).toBe('salad_chicken');
    expect(findFood('鶏もも肉（皮なし）の照り焼き')?.id).toBe('chicken_thigh_skinless');
    expect(findFood('牛もも肉のステーキ')?.id).toBe('beef_round');      // 「もも肉」で鶏に誤爆しない
    expect(findFood('豚もも肉の生姜焼き')?.id).toBe('pork_leg');
    expect(findFood('Greek yogurt')?.id).toBe('greek_yogurt');
    expect(findFood('プロテインバー')?.id).toBe('whey_protein');
    expect(findFood('カレーうどん')?.id).toBe('udon');
    expect(findFood('謎の物体X')).toBeNull();
    expect(findFood('')).toBeNull();
  });

  it('ランキング: 100gあたりのVC1位は赤パプリカ、亜鉛1位はかき、ビタミンA1位は鶏レバー。1食あたりでは量の差が効く', () => {
    expect(rankByNutrient('vc', '100g')[0].food.id).toBe('red_pepper');
    expect(rankByNutrient('zn', '100g')[0].food.id).toBe('oyster');
    expect(rankByNutrient('va', '100g')[0].food.id).toBe('chicken_liver');
    const fe = rankByNutrient('fe', 'serving', 10).map((r) => r.food.id);
    expect(fe).toContain('pork_liver');
    expect(rankByNutrient('p', '100g', 10)).toHaveLength(10);
    // 0 の食材は載らない（油にたんぱく質は無い）
    expect(rankByNutrient('p', '100g', 200).some((r) => r.food.id === 'olive_oil')).toBe(false);
  });

  it('得意な栄養素: オレンジ→ビタミンC、かき→亜鉛、ごはん（主食）→なし', () => {
    expect(signatureNutrient(byId('orange'))).toBe('vc');
    expect(signatureNutrient(byId('oyster'))).toBe('zn');
    expect(signatureNutrient(byId('rice'))).toBeNull();
    expect(nutrientOf(byId('orange'), 'vc', 130)).toBeCloseTo(78, 0);
  });
});

describe('かしこい置き換え（lib/smartSwap）', () => {
  it('オレンジ（ビタミンC）→ 赤パプリカ1個でオレンジ4個ぶん。kcal は減る（比が最小なので先頭）', () => {
    const list = swapsFor('オレンジ');
    const sw = list[0];
    expect(sw?.to.food.id).toBe('red_pepper');
    expect(sw!.nutrient).toBe('vc');
    expect(sw!.to.units).toBe(1);
    expect(sw!.from.units).toBe(4);
    expect(sw!.to.kcal).toBeLessThan(sw!.from.kcal);
    expect(swapLine(sw!)).toBe('ビタミンCなら、赤パプリカ1個でオレンジ4個ぶん');
    expect(swapKcalDelta(sw!)).toMatch(/^約−\d+kcal$/);
  });

  it('納豆（たんぱく質）→ サラダチキン1個で納豆4パックぶん（上位3件の外でも式は同じ）', () => {
    const top3 = swapsFor('納豆', { nutrient: 'p' });
    expect(top3.length).toBe(3);
    // 減量の並びは「元に対するkcal比」の小さい順（倍率 m が候補ごとに違うため絶対kcalでは比べない）
    const ratios = top3.map((x) => x.to.kcal / x.from.kcal);
    expect(ratios).toEqual([...ratios].sort((a, b) => a - b));
    const sw = swapsFor('納豆', { nutrient: 'p', top: 50 }).find((x) => x.to.food.id === 'salad_chicken');
    expect(sw).toBeDefined();
    expect(sw!.to.units).toBe(1);
    expect(sw!.from.units).toBe(4);
    expect(swapLine(sw!)).toBe('たんぱく質なら、サラダチキン1個で納豆4パックぶん');
  });

  it('牛もも（亜鉛）→ かき: 同じ亜鉛を少ない量で', () => {
    const sw = swapsFor('牛もも肉', { nutrient: 'zn' }).find((x) => x.to.food.id === 'oyster');
    expect(sw).toBeDefined();
    expect(sw!.to.grams).toBeLessThan(sw!.from.grams);
  });

  it('減量は kcal が 70% 以下の候補だけ・増量は 130% 以上の候補だけ・最大3件・個数は 0.5 刻みで 0.25〜6', () => {
    for (const f of NUTRIENT_DB) {
      for (const mode of ['cut', 'bulk'] as const) {
        const list = swapsForFood(f, { mode });
        expect(list.length).toBeLessThanOrEqual(MAX_SWAPS);
        for (const sw of list) {
          if (mode === 'cut') expect(sw.to.kcal).toBeLessThanOrEqual(sw.from.kcal * 0.7 + 1);
          else expect(sw.to.kcal).toBeGreaterThanOrEqual(sw.from.kcal * 1.3 - 1);
          expect(sw.to.units).toBeGreaterThanOrEqual(0.25);
          expect(sw.to.units).toBeLessThanOrEqual(6);
          expect(sw.from.units).toBeGreaterThanOrEqual(0.25);
          expect(sw.from.units).toBeLessThanOrEqual(30);   // アーモンド25粒は許す
          expect(sw.to.grams).toBeLessThanOrEqual(300);
          expect(sw.to.units * 2).toBe(Math.round(sw.to.units * 2));
          expect(sw.to.food.id).not.toBe(f.id);
          // 油はビタミンE以外の置き換え先にならない
          if (sw.to.food.cat === 'oil') expect(sw.nutrient).toBe('ve');
        }
      }
    }
    expect(roundUnits(2.74)).toBe(2.5);
    expect(roundUnits(0.3)).toBe(0.5);
  });

  it('辞書に無い品目・得意な栄養素の無い品目（ごはん）は空配列', () => {
    expect(swapsFor('謎の物体X')).toEqual([]);
    expect(swapsFor('ごはん')).toEqual([]);
  });

  it('禁止語（優れ・劣・ダメ・避け・太る…）が全食材×全栄養素×両モードの文に一度も出ない', () => {
    expect(FORBIDDEN_WORDS).toContain('優れ');
    const offenders: string[] = [];
    for (const f of NUTRIENT_DB) {
      for (const mode of ['cut', 'bulk'] as const) {
        for (const nutrient of NAV_NUTRIENTS) {
          for (const sw of swapsForFood(f, { nutrient, mode })) {
            for (const s of [swapLine(sw), swapKcalDelta(sw)]) if (hasForbiddenWord(s)) offenders.push(s);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('たんぱく源ティア（content/proteinTiers）', () => {
  it('減量の基準: 鶏むね・サラダチキン・鶏レバー・砂肝・ツナ缶水煮は S、手羽先は D以下、豚バラ・ウインナーは E', () => {
    for (const id of ['chicken_breast', 'salad_chicken', 'chicken_liver', 'chicken_gizzard', 'tuna_can']) expect([id, tierOf(byId(id), 'cut')]).toEqual([id, 'S']);
    expect(tierRank(tierOf(byId('chicken_wing'), 'cut'))).toBeGreaterThanOrEqual(tierRank('D'));
    expect(tierOf(byId('pork_belly'), 'cut')).toBe('E');
    expect(tierOf(byId('sausage'), 'cut')).toBe('E');
    expect(tierOf(byId('egg'), 'cut')).toBe('C');
    expect(tierOf(byId('natto'), 'cut')).toBe('B');
  });

  it('増量の基準に切り替えると kcal密度と食べやすさが評価され、豚バラ・卵の格が上がり、プロテインとさばは S', () => {
    expect(tierRank(tierOf(byId('pork_belly'), 'bulk'))).toBeLessThan(tierRank(tierOf(byId('pork_belly'), 'cut')));
    expect(tierRank(tierOf(byId('egg'), 'bulk'))).toBeLessThan(tierRank(tierOf(byId('egg'), 'cut')));
    expect(tierOf(byId('whey_protein'), 'bulk')).toBe('S');
    expect(tierOf(byId('mackerel'), 'bulk')).toBe('S');
    expect(tierOf(byId('milk'), 'bulk')).toBe('C');
  });

  it('ティア表は全たんぱく源をちょうど1回ずつ載せ、各ティア内は点数順', () => {
    for (const mode of ['cut', 'bulk'] as const) {
      const table = tierTable(mode);
      const all = TIERS.flatMap((tier) => table[tier].map((f) => f.id));
      expect(all.sort()).toEqual(proteinFoods().map((f) => f.id).sort());
      expect(proteinFoods().length).toBeGreaterThanOrEqual(40);
    }
  });

  it('理由文は事実の列挙で、禁止語を含まない（全食材×両モード）', () => {
    const offenders: string[] = [];
    for (const f of proteinFoods()) {
      for (const mode of ['cut', 'bulk'] as const) {
        const r = tierReason(f, mode);
        expect(r.length).toBeGreaterThan(5);
        if (hasForbiddenWord(r)) offenders.push(`${f.id}/${mode}: ${r}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(tierReason(byId('chicken_breast'), 'cut')).toBe('P1gあたり4.5kcal・脂質16%・量が決まりやすい・安い');
    expect(tierReason(byId('pork_belly'), 'cut')).toContain('つい量が増えやすい');
  });

  it('プロンプト用の要約は400字以内で S= / A= / C以下= を含み、増量は見出しが変わる', () => {
    const cut = tierPromptSummary('cut');
    expect(cut.length).toBeLessThanOrEqual(400);
    expect(cut).toContain('減量向け');
    expect(cut).toContain('S=');
    expect(cut.split(' / ')[0]).toContain('鶏むね肉（皮なし）');   // 鶏むねは S の並びの中にいる
    expect(cut).toContain('A=');
    expect(cut).toContain('C以下=');
    expect(tierPromptSummary('bulk')).toContain('増量向け');
  });

  it('tierShareOf: たんぱく源10品未満は null、全部Sなら100%、Cティア以下が混ざると worst と kcal差が出る', () => {
    expect(tierShareOf(['鶏むね肉', '鶏むね肉', 'ごはん', 'サラダ'], 'cut')).toBeNull();
    const allS = tierShareOf(new Array(12).fill('鶏むね肉'), 'cut')!;
    expect(allS.n).toBe(12);
    expect(allS.pHigh).toBe(100);
    expect(allS.worst).toBeNull();
    expect(allS.kcalSaved).toBe(0);
    const mix = tierShareOf([...new Array(6).fill('鶏むね肉'), ...new Array(6).fill('豚バラ肉の炒め物'), 'ごはん'], 'cut')!;
    expect(mix.n).toBe(12);
    expect(mix.pHigh).toBeLessThan(100);
    expect(mix.worst?.food.id).toBe('pork_belly');
    expect(mix.worst?.tier).toBe('E');
    expect(mix.best?.id).toBe('chicken_breast');   // 同じカテゴリ（肉）の S 最上位に替える
    expect(mix.kcalSaved).toBeGreaterThan(10);
  });
});

describe('法則 protein_tier（lib/laws.detectProteinTierLaw）', () => {
  const TODAY = '2026-09-03';
  const shift = (d: string, n: number) => { const dt = new Date(d + 'T00:00:00'); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); };
  const days = (names: string[][]) => names.map((ns, i) => ({ date: shift(TODAY, -i), names: ns }));

  it('LAW_KINDS に載り、記事（evidence）がある', () => {
    expect(LAW_KINDS).toContain('protein_tier');
    expect(getLawArticle('protein_tier').ready).toBe(true);
    expect(getLawArticle('protein_tier').article.actions).toHaveLength(3);
  });

  it('直近30日でたんぱく源10品未満なら出ない。31日前の品目は数えない', () => {
    expect(detectProteinTierLaw(days([['鶏むね肉'], ['鶏むね肉'], ['ごはん']]), TODAY)).toBeNull();
    const old = [{ date: shift(TODAY, -40), names: new Array(20).fill('鶏むね肉') }];
    expect(detectProteinTierLaw(old, TODAY)).toBeNull();
  });

  it('全部Sなら「Aティア以上が100%」＋既定の根拠（variant default）', () => {
    const law = detectProteinTierLaw(days(new Array(12).fill(['鶏むね肉'])), TODAY)!;
    expect(law.id).toBe('protein_tier');
    expect(law.title).toBe('あなたのたんぱく源はAティア以上が100%');
    expect(law.sub).toBe('直近30日の12食のたんぱく源から（減量の基準）');
    expect(lawVariant('protein_tier', law.p)).toBe('default');
  });

  it('Cティア以下が混ざると置き換えの根拠（variant swap）。生値は食材id（翻訳非依存）で、文は表示時に名前へ', () => {
    const law = detectProteinTierLaw(days([...new Array(6).fill(['鶏むね肉']), ...new Array(6).fill(['豚バラ肉'])]), TODAY)!;
    expect(law.p.food).toBe('pork_belly');
    expect(law.p.tier).toBe('E');
    expect(Number(law.p.kcal)).toBeGreaterThanOrEqual(10);
    expect(lawVariant('protein_tier', law.p)).toBe('swap');
    expect(law.sub).toMatch(/^豚バラ肉（Eティア）を.+（S）に替えると1食あたり約−\d+kcal$/);
    expect(hasForbiddenWord(law.title + law.sub)).toBe(false);
    // 保存済みの生値から文章を組み直しても同じ
    expect(lawText('protein_tier', law.p).sub).toBe(law.sub);
  });

  it('目的が増量なら増量の基準で格付けし、根拠にも「増量の基準」と出る', () => {
    const law = detectProteinTierLaw(days(new Array(12).fill(['鶏むね肉'])), TODAY, 'bulk')!;
    expect(law.p.mode).toBe('bulk');
    expect(law.sub).toContain('増量の基準');
  });
});

describe('リモート kind nutrients（lib/remoteContent）', () => {
  const row = (x: Partial<RemoteRow>): RemoteRow => ({ id: 'n1', kind: 'nutrients', version: 1, payload: null, published_at: '2026-09-03T00:00:00Z', min_app_version: null, ...x });
  const item = (over: Record<string, unknown> = {}) => ({
    id: 'red_pepper', name: { ja: '赤パプリカ', en: 'Red bell pepper' }, aliases: ['パプリカ'], emoji: '🫑', cat: 'veg',
    unit: { label: { ja: '個', en: 'pepper' }, g: 150 }, serving: 75, per100: { kcal: 28, p: 1.0, f: 0.2, c: 7.2, vc: 165 }, ...over,
  });

  it('検証: 必須キーが揃えば通り、微量栄養素の欠けは 0 で埋まる。妥当範囲を超える値・必須欠けは捨てる', () => {
    const ok = validateNutrientFood(item())!;
    expect(ok.per100.vc).toBe(165);
    expect(ok.per100.fe).toBe(0);
    expect(ok.cat).toBe('veg');
    expect(validateNutrientFood(item({ per100: { kcal: 28, p: 1, f: 0.2, c: 7.2, vc: 5000 } }))).toBeNull();   // VC 5,000mg は桁違い
    expect(validateNutrientFood(item({ per100: { kcal: 28, p: 1, f: 0.2 } }))).toBeNull();                    // c 欠け
    expect(validateNutrientFood(item({ unit: { label: '個', g: 0 } }))).toBeNull();
    expect(validateNutrientFood(item({ id: '' }))).toBeNull();
    expect(validateNutrientFood(item({ cat: 'unknown' }))!.cat).toBe('processed');
    expect(validateNutrientFood(item({ tier: { ease: 1, price: 2, overeat: 3 } }))!.tier).toEqual({ ease: 1, price: 2, overeat: 3 });
    expect(validateNutrientFood(item({ tier: { ease: 9, price: 2, overeat: 3 } }))!.tier).toBeUndefined();
  });

  it('マージ: 同idは値の上書き（赤パプリカVC 170→165）、新idは追加。壊れた項目だけ捨てる', () => {
    const content = mergeRemoteRows([row({ payload: { items: [
      item(),
      item({ id: 'acerola', name: { ja: 'アセロラ' }, per100: { kcal: 36, p: 0.7, f: 0.1, c: 9.0, vc: 199 } }),
      { id: 'broken' },
    ] } })], '1.0.20');
    expect(content.nutrients.map((x) => x.id)).toEqual(['red_pepper', 'acerola']);
    resetRemoteContentForTest(content);
    const db = getNutrientDb();
    expect(db.length).toBe(NUTRIENT_DB.length + 1);
    expect(db.find((f) => f.id === 'red_pepper')!.per100.vc).toBe(165);
    expect(findFood('アセロラ')?.id).toBe('acerola');
    // ランキングにも反映される（アセロラがVC1位）
    expect(rankByNutrient('vc', '100g')[0].food.id).toBe('acerola');
  });

  it('リモートが無ければ同梱のまま', () => {
    expect(getNutrientDb()).toBe(NUTRIENT_DB);
    expect(EMPTY_REMOTE.nutrients).toEqual([]);
  });
});
