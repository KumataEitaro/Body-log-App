// 配色のコントラスト検査（WCAG AA）を固定する。
//
// 2026-09-02 新アイコンに合わせた刷新で、「白地の小さい文字にアクセント色」が全アクセントで
// AA未達だったことが分かった（エレクトリック 3.7:1・グリーン 3.8:1・ライム 3.1:1）。
// 文字用の accentInk を分け、足りない色は自動で濃くする（lib/contrast.ts）。目視では戻るので、
// ライト（全背景トーン）・ダークの両方について、主要な組み合わせを数値で落とす。
//
// 基準（WCAG 2.1 AA）: 通常の文字 4.5:1 / 大きい文字・太字・UI部品 3:1
import { contrast, ensureContrast, luminance, mixHex, AA_TEXT, AA_LARGE } from '@/lib/contrast';
import { PALETTES, paletteFor, darkPaletteFor, BG_TINTS, PFC_PRESETS, type AccentKey } from '@/lib/theme';

const ACCENT_KEYS = Object.keys(PALETTES) as AccentKey[];
const WHITE = '#ffffff';

describe('lib/contrast（純関数）', () => {
  it('相対輝度は白=1・黒=0', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
  });
  it('白と黒のコントラストは21:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 1); // 順序に依らない
  });
  it('ensureContrast は既に満たす色を変えず、足りない色は基準まで寄せる', () => {
    expect(ensureContrast('#2563eb', WHITE, AA_TEXT, 'darker')).toBe('#2563eb'); // ブルーは5.2:1で不変
    const inked = ensureContrast('#4d7cff', WHITE, AA_TEXT, 'darker');            // エレクトリック 3.7:1 → 濃くなる
    expect(inked).not.toBe('#4d7cff');
    expect(contrast(inked, WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
    // 明るい側にも寄せられる（ダークの面に対して）
    const lit = ensureContrast('#475569', '#111827', AA_TEXT, 'lighter');
    expect(contrast(lit, '#111827')).toBeGreaterThanOrEqual(AA_TEXT);
  });
  it('mixHex は t=1 で a、t=0 で b', () => {
    expect(mixHex('#ff0000', '#0000ff', 1)).toBe('#ff0000');
    expect(mixHex('#ff0000', '#0000ff', 0)).toBe('#0000ff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('ライトパレット（13アクセント × 背景トーン5種）', () => {
  for (const accent of ACCENT_KEYS) {
    for (const { key } of BG_TINTS) {
      const pal = paletteFor(accent, key);
      it(`${accent}/${key}: ink on bg ≥ ${AA_TEXT}`, () => {
        expect(contrast(pal.ink, pal.bg)).toBeGreaterThanOrEqual(AA_TEXT);
      });
      it(`${accent}/${key}: sub on bg ≥ ${AA_LARGE}（補助文字は地の上にも載る）`, () => {
        expect(contrast(pal.sub, pal.bg)).toBeGreaterThanOrEqual(AA_LARGE);
      });
    }
    const pal = PALETTES[accent];
    it(`${accent}: sub on panel ≥ ${AA_TEXT}`, () => {
      expect(contrast(pal.sub, pal.panel)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`${accent}: accentInk on panel ≥ ${AA_TEXT}（白地の文字・リンク）`, () => {
      expect(contrast(pal.accentInk, pal.panel)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`${accent}: white on accent ≥ ${AA_LARGE}（塗りボタンの白文字は15px太字＝大きい文字扱い）`, () => {
      expect(contrast(WHITE, pal.teal)).toBeGreaterThanOrEqual(AA_LARGE);
    });
    it(`${accent}: 意味色の文字（successInk / amber / coral）が panel に対して読める`, () => {
      expect(contrast(pal.successInk, pal.panel)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(pal.amber, pal.panel)).toBeGreaterThanOrEqual(AA_LARGE);   // 注意は太字で使う
      expect(contrast(pal.coral, pal.panel)).toBeGreaterThanOrEqual(AA_LARGE);   // 超過は太字で使う
    });
    it(`${accent}: accentInk は teal 以上に濃い（薄くなる方向へは派生しない）`, () => {
      expect(luminance(pal.accentInk)).toBeLessThanOrEqual(luminance(pal.teal) + 1e-9);
    });
  }
});

describe('ダークパレット（13アクセント）', () => {
  for (const accent of ACCENT_KEYS) {
    const pal = darkPaletteFor(accent);
    it(`${accent}: ink on bg ≥ ${AA_TEXT}`, () => {
      expect(contrast(pal.ink, pal.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`${accent}: sub on panel ≥ ${AA_TEXT}`, () => {
      expect(contrast(pal.sub, pal.panel)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`${accent}: accentInk on panel ≥ ${AA_TEXT}`, () => {
      expect(contrast(pal.accentInk, pal.panel)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`${accent}: white on accent ≥ ${AA_LARGE}（暗所で持ち上げても白文字が薄くならない）`, () => {
      expect(contrast(WHITE, pal.teal)).toBeGreaterThanOrEqual(AA_LARGE);
    });
    it(`${accent}: 意味色の文字が panel に対して読める`, () => {
      expect(contrast(pal.successInk, pal.panel)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(pal.amber, pal.panel)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(pal.coral, pal.panel)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`${accent}: 地(bg)より面(panel)が明るい（カードが浮く2階調）`, () => {
      expect(luminance(pal.panel)).toBeGreaterThan(luminance(pal.bg));
    });
  }
  it('地と面はアクセントに依らず Navy / Card Gray に固定', () => {
    const bgs = new Set(ACCENT_KEYS.map((a) => darkPaletteFor(a).bg));
    const panels = new Set(ACCENT_KEYS.map((a) => darkPaletteFor(a).panel));
    expect(bgs.size).toBe(1);
    expect(panels.size).toBe(1);
  });
});

describe('新アイコンの配色（エレクトリック）', () => {
  it('アクセントは #4D7CFF、白地の文字用は #2F5FE6（デザイン指定値）', () => {
    expect(PALETTES.electric.teal).toBe('#4d7cff');
    expect(PALETTES.electric.accentInk).toBe('#2f5fe6');
    expect(contrast(PALETTES.electric.accentInk, WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
  });
  it('意味色は全アクセント共通（Leaf / Citrus由来 / Berry）', () => {
    for (const a of ACCENT_KEYS) {
      expect(PALETTES[a].success).toBe('#34b36a');
      expect(PALETTES[a].coral).toBe('#e43d5b');
      expect(PALETTES[a].amber).toBe(PALETTES.electric.amber);
    }
  });
  it('背景トーン「アクア」は全アクセントで同じ下地で、白いカードより暗い', () => {
    const bgs = new Set(ACCENT_KEYS.map((a) => paletteFor(a, 'aqua').bg));
    expect(bgs.size).toBe(1);
    expect(luminance(paletteFor('electric', 'aqua').bg)).toBeLessThan(luminance(WHITE));
  });
  it('PFCプリセット「アイコン調」が先頭で、3色が互いに異なる', () => {
    expect(PFC_PRESETS[0].key).toBe('icon');
    const { p, f, c } = PFC_PRESETS[0].colors;
    expect(new Set([p, f, c]).size).toBe(3);
  });
});
