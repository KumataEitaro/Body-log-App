// コラムの日英が対応していること（片方だけ増えると表示が崩れるため）
import { COLUMNS } from '@/content/columns';
import { COLUMNS_EN } from '@/content/columns.en';

describe('コラムの日英対応', () => {
  it('本数が同じ', () => {
    expect(COLUMNS_EN.length).toBe(COLUMNS.length);
  });

  it('idが同じ順序で並んでいる', () => {
    expect(COLUMNS_EN.map((c) => c.id)).toEqual(COLUMNS.map((c) => c.id));
  });

  it('絵文字と読了目安も揃っている', () => {
    COLUMNS.forEach((ja, i) => {
      expect(COLUMNS_EN[i].emoji).toBe(ja.emoji);
      expect(COLUMNS_EN[i].minutes).toBe(ja.minutes);
    });
  });

  it('英語版に日本語が混入していない（本文・見出し）', () => {
    const JP = /[ぁ-んァ-ヶ一-龠]/;
    for (const c of COLUMNS_EN) {
      expect(JP.test(c.title)).toBe(false);
      expect(JP.test(c.lead)).toBe(false);
      expect(JP.test(c.body)).toBe(false);
    }
  });

  it('どの記事にも出典が付いている', () => {
    for (const c of COLUMNS_EN) {
      expect(c.sources.length).toBeGreaterThan(0);
      for (const s of c.sources) expect(s.url).toMatch(/^https:\/\//);
    }
  });
});
