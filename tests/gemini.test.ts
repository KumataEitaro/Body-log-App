import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseJsonLoose, isBillingExhausted } from '../lib/gemini';

describe('parseJsonLoose（AI応答からのJSON抽出）', () => {
  it('素のJSONオブジェクト', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });
  it('素のJSON配列', () => {
    expect(parseJsonLoose('["x","y"]')).toEqual(['x', 'y']);
  });
  it('```json フェンス付き', () => {
    expect(parseJsonLoose('```json\n{"kcal":300}\n```')).toEqual({ kcal: 300 });
  });
  it('言語指定なしフェンス', () => {
    expect(parseJsonLoose('```\n[1,2]\n```')).toEqual([1, 2]);
  });
  it('前置きの思考テキスト付き', () => {
    expect(parseJsonLoose('了解しました。計算します。\n{"total":{"kcal":86}}')).toEqual({ total: { kcal: 86 } });
  });
  it('前後にテキストがあるJSON配列', () => {
    expect(parseJsonLoose('Here are the translations:\n["Settings","Save"]\nDone.')).toEqual(['Settings', 'Save']);
  });
  it('JSONが無ければthrow', () => {
    expect(() => parseJsonLoose('ただの文章です')).toThrow();
  });
  it('改行・空白入りのネスト', () => {
    const t = ' \n {"items":[{"name":"醤油","kcal":13}],"total":{"kcal":13}} \n';
    const v = parseJsonLoose(t) as { items: { name: string }[] };
    expect(v.items[0].name).toBe('醤油');
  });
});

// 「待てば直る」と「待っても直らない」の切り分け（2026-09-15）。
// 実際の事故: Gemini のプリペイド残高が尽きて全モデルが 429 を返したのに、画面は
// 「少し待って再試行してください」のままで、利用者は何度も押し続けた。
// Google は枯渇も過負荷も同じ 429 で返すので、本文で切り分けるしかない。
describe('isBillingExhausted（AI全断が課金枠の枯渇か）', () => {
  const depleted = 'gemini-flash-latest: HTTP 429 {"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio"}}';

  it('プリペイド残高の枯渇は true', () => {
    expect(isBillingExhausted([depleted])).toBe(true);
  });

  it('一時的な過負荷（429だが枯渇の文言なし）は false＝従来どおり「待って再試行」', () => {
    expect(isBillingExhausted(['gemini-flash-latest: HTTP 429 {"error":{"message":"The model is overloaded. Please try again later."}}'])).toBe(false);
    expect(isBillingExhausted(['gemini-flash-latest: HTTP 503 overloaded'])).toBe(false);
  });

  it('モデル廃止（404）やタイムアウトだけなら false', () => {
    expect(isBillingExhausted(['gemini-2.5-flash: HTTP 404 not found', 'gemini-3-pro: タイムアウト(20秒)'])).toBe(false);
  });

  it('失敗が1件も無ければ false', () => {
    expect(isBillingExhausted([])).toBe(false);
  });

  it('他のモデルの過負荷に枯渇が1件混ざっていても枯渇として扱う（枯渇はプロジェクト単位で起きる）', () => {
    expect(isBillingExhausted(['a: HTTP 429 overloaded', depleted])).toBe(true);
  });

  it('quota exceeded / RESOURCE_EXHAUSTED の表記ゆれも拾う', () => {
    expect(isBillingExhausted(['m: HTTP 429 You exceeded your current quota'])).toBe(true);
    expect(isBillingExhausted(['m: HTTP 429 {"status":"RESOURCE_EXHAUSTED"}'])).toBe(true);
  });
});


// モデルの優先順位は「安い順」（2026-09-15 に方針を反転）。
//
// それまで rank() は lite に -6 のペナルティを付けて「品質重視で lite は後回し」にしていた。
// ところが Google の価格は**新しい世代ほど高い**ため、この並びだと自動的に最も高いモデル
// （`gemini-flash-latest` = 実体 `gemini-3.8-flash`・$0.75/$3.75、2027-01-01 に $1.50/$7.50 へ倍増）
// が選ばれ続ける。用途は JSON の抽出であって最前線の推論ではないので lite で足りる。
//
// あわせて、作り直したプロジェクトの API キーで全モデルを実測したところ
// `gemini-2.5-flash-lite` / `gemini-2.5-flash` は "no longer available to new users" で 404 になった。
// 保険リストに残しておくと、フォールバックの枠を確実に失敗する名前で潰すことになる。
describe('モデルの優先順位は安い順（lite が先）', () => {
  const src = readFileSync(join(__dirname, '..', 'lib', 'gemini.ts'), 'utf8');
  const staticList = (src.match(/const STATIC_FALLBACK = \[([\s\S]*?)\];/) || [])[1] || '';

  it('rank は lite を加点する（減点していない）', () => {
    expect(src).toMatch(/includes\('lite'\)\) s \+= 40/);
    expect(src).not.toMatch(/includes\('lite'\)\) s -=/);
  });

  it('新しさの加点は lite の加点より弱い（新世代ほど高いため）', () => {
    const lite = Number((src.match(/includes\('lite'\)\) s \+= (\d+)/) || [])[1]);
    const ver = Number((src.match(/s \+= parseFloat\(m\[1\]\) \* ([\d.]+)/) || [])[1]);
    expect(lite).toBeGreaterThan(0);
    expect(ver).toBeGreaterThan(0);
    // 世代が4つ進んでも lite の加点を超えない＝lite が常に先に来る
    expect(ver * 4).toBeLessThan(lite);
  });

  it('静的フォールバックの先頭は実測で通る最安（gemini-3.1-flash-lite）', () => {
    const first = (staticList.match(/'([^']+)'/) || [])[1];
    expect(first).toBe('gemini-3.1-flash-lite');
  });

  it('新規プロジェクトで 404 になる 2.5 系を保険に残していない', () => {
    expect(staticList).not.toMatch(/gemini-2\.5/);
  });

  it('静的フォールバックは lite が非 lite より先に並んでいる', () => {
    const names = [...staticList.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const lastLite = names.map((n) => n.includes('lite')).lastIndexOf(true);
    const firstNonLite = names.map((n) => n.includes('lite')).indexOf(false);
    expect(names.length).toBeGreaterThan(1);
    if (firstNonLite >= 0) expect(lastLite).toBeLessThan(firstNonLite);
  });
});
