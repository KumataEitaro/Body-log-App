// 「何を食べる？」の純関数（lib/whatToEat.ts）
import {
  EAT_CONTEXTS, PICK_TARGET, promptKindOf, remainingLine, validateProposal,
  recentTagSummary, topMyFoodNames, sampleProposal,
} from '@/lib/whatToEat';

describe('whatToEat: promptKindOf（文脈チップ→プロンプト型）', () => {
  it('コンビニ・外食・時間がない は「一品」型、自炊は「献立」型、間食は「間食」型', () => {
    expect(promptKindOf('convenience')).toBe('item');
    expect(promptKindOf('eatout')).toBe('item');
    expect(promptKindOf('quick')).toBe('item');
    expect(promptKindOf('cook')).toBe('menu');
    expect(promptKindOf('snack')).toBe('snack');
  });

  it('全文脈に見本が1件ずつあり、間食の見本は200kcal以内', () => {
    for (const c of EAT_CONTEXTS) {
      const s = sampleProposal(c);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.reason.length).toBeGreaterThan(0);
    }
    expect(sampleProposal('snack').estKcal).toBeLessThanOrEqual(200);
  });
});

describe('whatToEat: remainingLine（残量→制約文）', () => {
  it('残りkcalとPFCの残りgを中黒でつなぐ', () => {
    expect(remainingLine({ kcal: 620, p: 40, f: 12, c: 80 })).toBe('残り620kcal・P残り40g・F残り12g・C残り80g');
  });

  it('超過中は「超過」と言い切り、マイナスのgは出さない（残っている栄養素だけ添える）', () => {
    expect(remainingLine({ kcal: -230, p: 15, f: -4, c: 0 })).toBe('230kcal超過・P残り15g');
  });

  it('PFCが未計算（null）ならkcalだけ。1000以上は桁区切り', () => {
    expect(remainingLine({ kcal: 1480.4, p: null, f: null, c: null })).toBe('残り1,480kcal');
  });
});

describe('whatToEat: validateProposal（提案JSONの検証）', () => {
  const good = (i: number) => ({ name: `案${i}`, estKcal: 300 + i, p: 20, f: 8, c: 40, reason: `理由${i}` });

  it('3案がそのまま通り、noteも整形される', () => {
    const r = validateProposal({ picks: [good(1), good(2), good(3)], note: '  補足  です ' });
    expect(r).not.toBeNull();
    expect(r!.picks).toHaveLength(PICK_TARGET);
    expect(r!.picks[0]).toEqual({ name: '案1', estKcal: 301, p: 20, f: 8, c: 40, reason: '理由1' });
    expect(r!.note).toBe('補足 です');
  });

  it('数値が範囲外・欠落の案だけ落とし、残りは返す（4案目以降は捨てる）', () => {
    const r = validateProposal({ picks: [
      { ...good(1), estKcal: 99999 },      // kcal暴走 → 落とす
      { ...good(2), p: -3 },               // 負のg → 落とす
      { name: '', estKcal: 100, p: 1, f: 1, c: 1 },   // 名前なし → 落とす
      good(4), good(5), good(6), good(7),  // 4案以上 → 3案で打ち切り
    ] });
    expect(r!.picks.map((p) => p.name)).toEqual(['案4', '案5', '案6']);
  });

  it('1案も残らなければ null（呼び出し側は「もう一度」を出す）', () => {
    expect(validateProposal({ picks: [] })).toBeNull();
    expect(validateProposal({ picks: 'x' })).toBeNull();
    expect(validateProposal(null)).toBeNull();
    expect(validateProposal({ picks: [{ name: 'x', estKcal: 'abc', p: 1, f: 1, c: 1 }] })).toBeNull();
  });

  it('dietFlag は high/maybe だけ通し、none・未知値はキーごと落とす（安全を意味する値を画面に渡さない）', () => {
    const r = validateProposal({ picks: [
      { ...good(1), dietFlag: 'high' }, { ...good(2), dietFlag: 'none' }, { ...good(3), dietFlag: 'safe' },
    ] });
    expect(r!.picks[0].dietFlag).toBe('high');
    expect('dietFlag' in r!.picks[1]).toBe(false);
    expect('dietFlag' in r!.picks[2]).toBe(false);
  });
});

describe('whatToEat: recentTagSummary（直近の食材タグ）', () => {
  it('多い順に上位3タグを「タグ: 約Ng」で並べ、0gのタグは出さない', () => {
    const s = recentTagSummary([
      { name: 'ご飯', qty: '200g' }, { name: 'ご飯', qty: '150g' },
      { name: 'サラダチキン', qty: '110g' },
      { name: '食パン', qty: '1枚' },
      { name: '牛乳', qty: '200ml' },
    ]);
    expect(s.startsWith('米: 約350g')).toBe(true);
    expect(s.split('・')).toHaveLength(3);
    expect(s).not.toContain('甘い飲み物');
  });

  it('品目が無ければ空文字（プロンプトに行を足さない）', () => {
    expect(recentTagSummary([])).toBe('');
  });
});

describe('whatToEat: topMyFoodNames（マイ食品の上位名）', () => {
  it('使用頻度の高い順・重複名は1つ・上限n件', () => {
    const foods = [
      { id: 'a', name: 'オートミール' }, { id: 'b', name: 'プロテイン' }, { id: 'c', name: 'オートミール' },
      { id: 'd', name: 'ゆで卵' }, { id: 'e', name: '  ' },
    ];
    expect(topMyFoodNames(foods, { d: 5, b: 3 }, 10)).toEqual(['ゆで卵', 'プロテイン', 'オートミール']);
    expect(topMyFoodNames(foods, {}, 2)).toEqual(['オートミール', 'プロテイン']);
  });
});
