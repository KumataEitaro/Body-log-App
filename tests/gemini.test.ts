import { describe, it, expect } from 'vitest';
import { parseJsonLoose } from '../lib/gemini';

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
