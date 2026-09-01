// 食事の制約（B-18）の端末内判定テスト。docs/DIET-MODES.md §2 / §6。
//
// ここで守っているのは大きく3つ。
// ①黒と灰が混ざらないこと（灰を黒にすると警告が鳴りっぱなしになり黒が埋もれる）
// ②表記ゆれ（ひらがな/カタカナ/漢字・大文字小文字・全角）を吸収すること
// ③「該当なし」が空配列で返るだけで、安全を意味する値を一切返さないこと
import {
  checkItems, checkOne, normalizeForMatch, rulesFor, stronger,
  levelFromAiFlag, visibleHits, topLevel, mergeAlerts,
} from '../dietCheck';

const R = (...keys: string[]) => rulesFor(keys);

describe('normalizeForMatch', () => {
  it('全角・大文字・ひらがなを畳む', () => {
    expect(normalizeForMatch('ＭＩＬＫ')).toBe('milk');
    expect(normalizeForMatch('ぎゅうにゅう')).toBe(normalizeForMatch('ギュウニュウ'));
    expect(normalizeForMatch('  生  クリーム  ')).toBe('生 クリーム');
  });
});

describe('checkItems: 黒（high）の検知', () => {
  it('ビーガンで豚肉を黒と判定する', () => {
    const hits = checkItems([{ name: '豚肉の生姜焼き' }], R('vegan'));
    expect(hits).toHaveLength(1);
    expect(hits[0].level).toBe('high');
    expect(hits[0].mode).toBe('vegan');
    expect(hits[0].name).toBe('豚肉の生姜焼き');
    expect(hits[0].reason).toBeTruthy();
  });

  it('グルテンフリーでパン・うどんを黒と判定する', () => {
    const hits = checkItems([{ name: '食パン 2枚' }, { name: 'ざるうどん' }], R('gluten_free'));
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.level === 'high')).toBe(true);
  });

  it('ハラールで日本酒を黒と判定する', () => {
    const hits = checkItems([{ name: '日本酒 1合' }], R('halal'));
    expect(hits[0].level).toBe('high');
    expect(hits[0].mode).toBe('halal');
  });

  it('乳製品なしでカフェラテを黒と判定する', () => {
    const hits = checkItems([{ name: 'カフェラテ' }], R('dairy_free'));
    expect(hits[0].level).toBe('high');
  });
});

describe('checkItems: 灰（maybe）と黒の切り分け', () => {
  it('グルテンフリーのしょうゆ・みそは灰（製品による）', () => {
    const hits = checkItems([{ name: '冷奴（しょうゆ）' }, { name: '味噌汁' }], R('gluten_free'));
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.level === 'maybe')).toBe(true);
  });

  it('ベジタリアンのだし・めんつゆは灰、魚そのものは黒', () => {
    const dashi = checkOne({ name: 'めんつゆ' }, R('vegetarian'));
    const fish = checkOne({ name: '鯖の塩焼き' }, R('vegetarian'));
    expect(dashi?.level).toBe('maybe');
    expect(fish?.level).toBe('high');
  });

  it('ハラールの牛肉は灰（屠殺方法が品目名から分からない）／豚肉は黒', () => {
    expect(checkOne({ name: '牛肉ステーキ' }, R('halal'))?.level).toBe('maybe');
    expect(checkOne({ name: '豚バラ炒め' }, R('halal'))?.level).toBe('high');
  });

  it('複数プリセットで当たったら強い方（黒）を1件だけ返す', () => {
    // 「豚カツ」= ハラール黒・グルテンフリー黒。灰しか無いプリセットを先に置いても黒が勝つ
    const hit = checkOne({ name: '豚カツ定食' }, R('dairy_free', 'halal'));
    expect(hit?.level).toBe('high');
    expect(hit?.mode).toBe('halal');
    // 灰のプリセットを先に並べても黒が優先される（全ルールのhighを先に走査する）
    const hit2 = checkOne({ name: 'とんかつ' }, R('vegan', 'gluten_free'));
    expect(hit2?.level).toBe('high');
  });
});

describe('checkItems: 表記ゆれの吸収', () => {
  it('ひらがな・カタカナ・漢字のどれでも拾う', () => {
    expect(checkOne({ name: 'たまごサンド' }, R('vegan'))?.level).toBe('high');
    expect(checkOne({ name: 'タマゴサンド' }, R('vegan'))?.level).toBe('high');
    expect(checkOne({ name: '卵サンド' }, R('vegan'))?.level).toBe('high');
  });

  it('英語表記・大文字小文字・全角を拾う', () => {
    expect(checkOne({ name: 'Grilled Chicken Salad' }, R('vegan'))?.level).toBe('high');
    expect(checkOne({ name: 'ＭＩＬＫ ＴＥＡ' }, R('dairy_free'))?.level).toBe('high');
  });

  it('原材料テキスト側の語も判定に使う', () => {
    const hit = checkOne({ name: '袋菓子', text: '原材料: 小麦粉、砂糖、食塩' }, R('gluten_free'));
    expect(hit?.level).toBe('high');
    expect(hit?.name).toBe('袋菓子');
  });

  it('英語は単語境界で判定する（eggplant を egg と誤検知しない）', () => {
    expect(checkOne({ name: 'eggplant curry' }, R('vegan'))?.level).not.toBe('high');
    expect(checkOne({ name: 'graham cracker' }, R('vegan'))).toBeNull();
  });
});

describe('checkItems: 該当なし・入力の頑健さ', () => {
  it('該当が無ければ空配列（「安全」を意味する値は返さない）', () => {
    expect(checkItems([{ name: '白米 150g' }, { name: 'ほうれん草のおひたし' }], R('gluten_free'))).toEqual([]);
  });

  it('プリセットが空なら常に空配列（ONにしていない人の画面は何も変わらない）', () => {
    expect(checkItems([{ name: '豚肉' }], R())).toEqual([]);
    expect(checkItems([{ name: '豚肉' }], rulesFor(null))).toEqual([]);
  });

  it('未知のキー・不正な値は無視する（列が無いDBやゴミデータで壊れない）', () => {
    expect(rulesFor(['vegan', 'unknown_key', 'vegan'])).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(rulesFor(['x', 1 as any, null as any])).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(checkItems([{ name: '' }, null as any, { name: '豚肉' }], R('vegan'))).toHaveLength(1);
  });

  it('該当した品目だけが結果に入る（順序は入力順）', () => {
    const hits = checkItems(
      [{ name: '白米' }, { name: 'ベーコンエッグ' }, { name: 'トマト' }, { name: '牛乳' }],
      R('vegan'),
    );
    expect(hits.map((h) => h.name)).toEqual(['ベーコンエッグ', '牛乳']);
  });
});

describe('強さの合成と課金の線引き', () => {
  it('stronger は high を優先し、該当なし同士は null', () => {
    expect(stronger('maybe', 'high')).toBe('high');
    expect(stronger('maybe', null)).toBe('maybe');
    expect(stronger(null, null)).toBeNull();
  });

  it('AIのdietFlagは high/maybe だけ受け取り、none・未知値は該当なし', () => {
    expect(levelFromAiFlag('high')).toBe('high');
    expect(levelFromAiFlag('maybe')).toBe('maybe');
    expect(levelFromAiFlag('none')).toBeNull();
    expect(levelFromAiFlag('safe')).toBeNull();
    expect(levelFromAiFlag(undefined)).toBeNull();
  });

  it('無料プランは黒だけ見える（灰は有料・黒は無料でも必ず見せる）', () => {
    const hits = checkItems([{ name: '豚カツ' }, { name: 'めんつゆ' }], R('gluten_free'));
    expect(topLevel(hits)).toBe('high');
    const free = visibleHits(hits, false);
    expect(free).toHaveLength(1);
    expect(free[0].level).toBe('high');
    expect(visibleHits(hits, true)).toHaveLength(2);
  });
});

describe('mergeAlerts: 二段構えの合成（辞書 × AI判定）', () => {
  const items = [{ name: '白米' }, { name: 'から揚げ' }, { name: 'ミートソースパスタ' }];

  it('辞書で当たらない品目にAIが high を付けたら、AI由来の警告として出る（プレミアム）', () => {
    const a = mergeAlerts({
      items: [{ name: '謎のスープ' }], rules: rulesFor(['vegan']),
      aiFlags: { '謎のスープ': 'high' }, premium: true,
    });
    expect(a).toHaveLength(1);
    expect(a[0].source).toBe('ai');
    expect(a[0].level).toBe('high');
    // AIには理由を語らせない（断定の余地を作らない）
    expect(a[0].reason).toBe('');
    expect(a[0].mode).toBeUndefined();
  });

  it('無料プランはAI判定を一切使わず、辞書の黒だけを出す', () => {
    const free = mergeAlerts({
      items, rules: rulesFor(['gluten_free']),
      aiFlags: { '白米': 'high' }, premium: false,
    });
    // 白米（AIのhigh）は無料では出ない。から揚げ・パスタは辞書の黒
    expect(free.map((x) => x.name)).toEqual(['から揚げ', 'ミートソースパスタ']);
    expect(free.every((x) => x.source === 'dict' && x.level === 'high')).toBe(true);
  });

  it('辞書が灰・AIが黒なら黒に上がり、逆でも強い方が残る', () => {
    const up = mergeAlerts({
      items: [{ name: 'めんつゆ' }], rules: rulesFor(['gluten_free']),
      aiFlags: { 'めんつゆ': 'high' }, premium: true,
    });
    expect(up[0].level).toBe('high');
    expect(up[0].source).toBe('ai');   // 辞書より強いのでAI由来として出す
    const keep = mergeAlerts({
      items: [{ name: 'から揚げ' }], rules: rulesFor(['gluten_free']),
      aiFlags: { 'から揚げ': 'maybe' }, premium: true,
    });
    expect(keep[0].level).toBe('high');
    expect(keep[0].source).toBe('dict');  // 辞書の黒が勝つので語も出せる
    expect(keep[0].reason).toBeTruthy();
  });

  it('制約が空・AI判定も無ければ何も出ない（機能をONにしていない人の画面は不変）', () => {
    expect(mergeAlerts({ items, rules: rulesFor([]), premium: true })).toEqual([]);
    expect(mergeAlerts({ items: [], rules: rulesFor(['vegan']), premium: true })).toEqual([]);
  });

  it('AIの none・未知値は該当なし扱いで、警告を作らない', () => {
    const a = mergeAlerts({
      items: [{ name: '白米' }], rules: rulesFor(['vegan']),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiFlags: { '白米': 'none' as any }, premium: true,
    });
    expect(a).toEqual([]);
  });
});
