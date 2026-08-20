// 背景に色を敷いても読みやすさとカードの浮きが崩れないこと。
// 目視では判断できないため、コントラスト比と明度差を計算で検証する。
import { PALETTES, paletteFor, BG_TINTS, type AccentKey } from '@/lib/theme';

const ACCENTS = Object.keys(PALETTES) as AccentKey[];

/** sRGBの相対輝度（WCAG 2.1の定義） */
function luminance(hex: string): number {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
}

/** コントラスト比（1〜21）。WCAG AAの本文基準は4.5:1 */
function contrast(a: string, b: string): number {
  const l1 = luminance(a), l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

describe('背景の色づけ', () => {
  it('全テーマ・両モードで本文がWCAG AA（4.5:1）を満たす', () => {
    for (const accent of ACCENTS) {
      for (const { key } of BG_TINTS) {
        const pal = paletteFor(accent, key);
        expect({ accent, key, ratio: contrast(pal.ink, pal.bg) >= 4.5 })
          .toEqual({ accent, key, ratio: true });
      }
    }
  });

  it('補助テキスト（sub）も背景に対して読める（3:1以上）', () => {
    for (const accent of ACCENTS) {
      for (const { key } of BG_TINTS) {
        const pal = paletteFor(accent, key);
        expect({ accent, key, ok: contrast(pal.sub, pal.bg) >= 3 })
          .toEqual({ accent, key, ok: true });
      }
    }
  });

  it('カード（白）が背景より明るく、浮いている関係が保たれる', () => {
    for (const accent of ACCENTS) {
      const soft = paletteFor(accent, 'soft');
      // panelは白のまま。下地より明るくないとカードが沈んで見える
      expect({ accent, ok: luminance(soft.panel) > luminance(soft.bg) })
        .toEqual({ accent, ok: true });
    }
  });

  it('色づけは「薄い」範囲に収まる（下地と白の差が小さい）', () => {
    for (const accent of ACCENTS) {
      const soft = paletteFor(accent, 'soft');
      // 白との輝度差が大きすぎると「イメージが変わった」と感じる。
      // 0.10未満＝知覚できるが主張しない範囲
      const diff = luminance('#ffffff') - luminance(soft.bg);
      expect({ accent, diff: diff < 0.10 }).toEqual({ accent, diff: true });
    }
  });

  it('白を選んだときは全テーマで同じ無彩色になる', () => {
    const bgs = ACCENTS.map((a) => paletteFor(a, 'white').bg);
    expect(new Set(bgs).size).toBe(1);
  });

  it('テーマ色を薄くを選ぶと、テーマごとに下地が変わる', () => {
    const bgs = ACCENTS.map((a) => paletteFor(a, 'soft').bg);
    expect(new Set(bgs).size).toBe(ACCENTS.length);   // 12テーマすべて別の色
  });

  it('背景以外のトークンはモードで変わらない（カード面や文字色は不変）', () => {
    for (const accent of ACCENTS) {
      const w = paletteFor(accent, 'white');
      const s = paletteFor(accent, 'soft');
      const { bg: _w, ...restW } = w;
      const { bg: _s, ...restS } = s;
      expect(restS).toEqual(restW);
    }
  });
});
