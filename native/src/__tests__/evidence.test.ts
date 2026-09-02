// 法則の解説記事カタログ（content/evidence.ts）の整合を固定する（E1b）。
// 守りたいこと:
//  ①既存の全 LawKind（variant含む）に記事があり、7節が揃っている（意味／科学的背景／できること3つ／注意／出典）
//  ②出典は https の URL・著者・題・誌名・年を持ち、科学的背景の参照は必ず出典に含まれる
//  ③煽り表現（「最新の研究」）を書かない
//  ④未登録キーは「準備中」の汎用記事に落ちる（落ちない・空にならない）
//  ⑤リモートの laws_text.article で節ごとに上書きできる（無い節は同梱のまま・非https出典は捨てる）
import {
  EVIDENCE, FALLBACK_ARTICLE, COMMON_CAUTIONS, evidenceKeyOf, getLawArticle, sourceNumber, type LawArticle,
} from '@/content/evidence';
import { LAW_KINDS } from '@/lib/laws';
import {
  mergeRemoteRows, resetRemoteContentForTest, validateLawText, EMPTY_REMOTE, type RemoteRow,
} from '@/lib/remoteContent';

const row = (x: Partial<RemoteRow>): RemoteRow => ({
  id: 'r1', kind: 'laws_text', version: 1, payload: null, published_at: '2026-09-01T00:00:00Z', min_app_version: null, ...x,
});

// 既存8種＋分岐のある variant。並行セッション（E1a）が増やす種類は §3 の表に沿って E1c で追記するので、
// ここは「記事が揃っているべき種類」を固定の一覧で持つ（LAW_KINDS 全体は後述の「落ちない」テストで見る）
const EXISTING_KINDS = ['food_up', 'food_safe', 'weekday', 'binge_trigger', 'timeslot', 'recover', 'comeback', 'sleep_factor'];
const VARIANTS: [string, string][] = [
  ...EXISTING_KINDS.map((k): [string, string] => [k, 'default']),
  ['weekday', 'stable'], ['sleep_factor', 'long'], ['sleep_factor', 'short'],
];

const ja = (v: unknown): string => (typeof v === 'string' ? v : (v as Record<string, string>)?.ja ?? '');
const en = (v: unknown): string => (typeof v === 'string' ? v : (v as Record<string, string>)?.en ?? '');

function allJaText(a: LawArticle): string {
  return [
    ja(a.meaning), ...a.science.map((p) => ja(p.text)), ...a.actions.map(ja), ja(a.seeDoctor ?? ''), ja(a.caution ?? ''),
  ].join('\n');
}

afterEach(() => resetRemoteContentForTest(EMPTY_REMOTE));

describe('カタログの網羅性（全LawKindに記事がある）', () => {
  it.each(VARIANTS)('%s / %s は準備中ではない', (kind, variant) => {
    const { ready, article } = getLawArticle(kind, variant);
    expect(ready).toBe(true);
    expect(article).not.toBe(FALLBACK_ARTICLE);
  });
  it('LAW_KINDS のどの種類でも落ちず、記事（同梱か準備中）が返る', () => {
    expect(LAW_KINDS).toEqual(expect.arrayContaining(EXISTING_KINDS));
    for (const k of LAW_KINDS) {
      const { article } = getLawArticle(k, 'default');
      expect(article.actions).toHaveLength(3);
      expect(ja(article.meaning).length).toBeGreaterThan(10);
    }
  });
  it('variant付きのキーは専用記事があるときだけ使う', () => {
    expect(evidenceKeyOf('weekday', 'stable')).toBe('weekday:stable');
    expect(evidenceKeyOf('weekday', 'default')).toBe('weekday');
    expect(evidenceKeyOf('sleep_factor', 'long')).toBe('sleep_factor');   // 方向は1記事で扱う
  });
});

describe('各記事の7節の整合', () => {
  const entries = Object.entries(EVIDENCE);
  it.each(entries)('%s: 意味・科学的背景・できること3つ・出典が揃い、ja/enを持つ', (_key, a) => {
    expect(ja(a.meaning).length).toBeGreaterThan(40);
    expect(en(a.meaning).length).toBeGreaterThan(20);
    expect(a.science.length).toBeGreaterThanOrEqual(1);
    for (const p of a.science) {
      expect(ja(p.text).length).toBeGreaterThan(20);
      expect(en(p.text).length).toBeGreaterThan(10);
      expect(p.refs.length).toBeGreaterThanOrEqual(1);
      for (const r of p.refs) expect(a.sources).toContain(r);           // 参照は必ず出典に含まれる
      for (const r of p.refs) expect(sourceNumber(a, r)).toBeGreaterThan(0);
    }
    expect(a.actions).toHaveLength(3);
    for (const x of a.actions) { expect(ja(x).length).toBeGreaterThan(8); expect(en(x).length).toBeGreaterThan(8); }
    if (a.seeDoctor) { expect(ja(a.seeDoctor).length).toBeGreaterThan(20); expect(en(a.seeDoctor).length).toBeGreaterThan(10); }
    expect(a.sources.length).toBeGreaterThanOrEqual(1);
  });
  it.each(entries)('%s: 出典は https・著者・題・誌名・年を持ち、URLが重複しない', (_key, a) => {
    const urls = new Set<string>();
    for (const src of a.sources) {
      expect(src.url).toMatch(/^https:\/\//);
      expect(src.url).toMatch(/pubmed\.ncbi\.nlm\.nih\.gov|doi\.org|mhlw\.go\.jp/);   // 査読誌（PubMed/DOI）か公的機関
      expect(src.authors.length).toBeGreaterThan(2);
      expect(src.title.length).toBeGreaterThan(5);
      expect(src.journal.length).toBeGreaterThan(2);
      expect(src.year).toBeGreaterThanOrEqual(1980);
      expect(src.year).toBeLessThanOrEqual(2026);
      expect(urls.has(src.url)).toBe(false);
      urls.add(src.url);
    }
  });
  it.each(entries)('%s: 煽り表現・断定を書かない', (_key, a) => {
    const txt = allJaText(a);
    expect(txt).not.toMatch(/最新の研究/);
    expect(txt).not.toMatch(/科学的に証明/);
    expect(txt).not.toMatch(/必ず痩せ/);
  });
  it('共通の注意は3点（相関≠因果／個人差／医療機器ではない）', () => {
    expect(COMMON_CAUTIONS).toHaveLength(3);
    const txt = COMMON_CAUTIONS.map(ja).join('');
    expect(txt).toMatch(/因果/);
    expect(txt).toMatch(/個人差/);
    expect(txt).toMatch(/医療機器/);
  });
});

describe('未登録キーのフォールバック', () => {
  it('知らない kind は準備中の汎用記事（できること3つ・出典なし）に落ちる', () => {
    const { ready, article } = getLawArticle('multi_sleep_mood_wed', 'default');
    expect(ready).toBe(false);
    expect(article).toBe(FALLBACK_ARTICLE);
    expect(article.actions).toHaveLength(3);
    expect(article.sources).toEqual([]);
    expect(ja(article.meaning)).toMatch(/準備中/);
  });
});

describe('リモート（laws_text.article）での差し替え', () => {
  const remoteSrc = { authors: 'Test A', title: 'Remote study', journal: 'J Test. 1:1', year: 2025, url: 'https://doi.org/10.1000/test' };

  it('節ごとに上書きし、無い節は同梱のまま。refs はリモート sources の番号を指す', () => {
    resetRemoteContentForTest(mergeRemoteRows([row({ payload: { items: [
      { id: 'recover', article: {
        meaning: { ja: 'リモートの意味' },
        science: [{ text: { ja: 'リモートの背景' }, refs: [1, 9] }],   // 9 は存在しない番号→落とす
        sources: [remoteSrc],
      } },
    ] } })], '1.0.20'));
    const { ready, article } = getLawArticle('recover', 'default');
    expect(ready).toBe(true);
    expect(ja(article.meaning)).toBe('リモートの意味');
    expect(article.science).toHaveLength(1);
    expect(article.science[0].refs).toEqual([remoteSrc]);
    expect(article.actions).toEqual(EVIDENCE.recover.actions);           // 無い節は同梱
    expect(article.sources).toEqual([remoteSrc]);
  });

  it('seeDoctor を空文字にすると同梱の受診の目安が消える', () => {
    resetRemoteContentForTest(mergeRemoteRows([row({ payload: { items: [
      { id: 'timeslot', article: { seeDoctor: '' } },
    ] } })], '1.0.20'));
    expect(getLawArticle('timeslot').article.seeDoctor).toBeUndefined();
    expect(EVIDENCE.timeslot.seeDoctor).toBeDefined();
  });

  it('variant付き id（weekday:stable）は variant の記事だけに効く', () => {
    resetRemoteContentForTest(mergeRemoteRows([row({ payload: { items: [
      { id: 'weekday:stable', article: { meaning: { ja: '安定の意味（リモート）' } } },
    ] } })], '1.0.20'));
    expect(ja(getLawArticle('weekday', 'stable').article.meaning)).toBe('安定の意味（リモート）');
    expect(getLawArticle('weekday', 'default').article.meaning).toBe(EVIDENCE.weekday.meaning);
  });

  it('未登録の kind でもリモートに記事があれば準備中にならない', () => {
    resetRemoteContentForTest(mergeRemoteRows([row({ payload: { items: [
      { id: 'lift_sleep', article: { meaning: { ja: '新しい法則の意味' } } },
    ] } })], '1.0.20'));
    const { ready, article } = getLawArticle('lift_sleep');
    expect(ready).toBe(true);
    expect(ja(article.meaning)).toBe('新しい法則の意味');
    expect(article.actions).toEqual(FALLBACK_ARTICLE.actions);           // 他の節は汎用記事で埋める
  });

  it('validateLawText: article だけの行を受け付け、非https の出典・壊れた段落は捨てる', () => {
    const v = validateLawText({ id: 'recover', article: {
      meaning: { ja: 'x' },
      science: [{ text: { ja: 'ok' }, refs: [1, 'a', 0] }, { refs: [1] }, 'junk'],
      actions: ['a', { en: 'b' }, 3],
      sources: [remoteSrc, { ...remoteSrc, url: 'http://insecure.example' }, { title: 'no authors' }],
    } });
    expect(v?.article?.meaning).toEqual({ ja: 'x' });
    expect(v?.article?.science).toEqual([{ text: { ja: 'ok' }, refs: [1] }]);
    expect(v?.article?.actions).toEqual(['a', { en: 'b' }]);
    expect(v?.article?.sources).toEqual([remoteSrc]);
    expect(validateLawText({ id: 'recover', article: { sources: [{ ...remoteSrc, url: 'http://x' }] } })).toBeNull();
  });
});
