import { describe, it, expect } from 'vitest';
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
