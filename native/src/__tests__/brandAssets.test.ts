// アイコンに紐づく素材と色の整合（2026-10-07 熊田さん「前の白地に丸のアイコンに戻したい。紐づく色やイメージをすべて合わせて再設計」）。
//
// 見張ること:
//   1. app.json のスプラッシュ（明/暗）・Android 適応アイコンの地・通知の色が lib/brand.ts の BRAND と同値（app.json は TS を読めないため手書き）
//   2. LaunchIntro が BRAND を使い、生の HEX（旧 #C8FAFB 等）を持たない
//   3. 画像の形式: icon.png は 1024 の完全不透明・純白地 / splash-icon.png は角だけ透明の白いタイル /
//      Android foreground は 1024 不透明 / monochrome は白1色・アルファ2段（リング60%・円弧100%）で安全域（中央66%）に収まる / favicon 48 / Web 256
//   4. ダークの地は theme.ts のダークの bg と同値（起動→ホームの継ぎ目で色が飛ばない）
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { BRAND } from '@/lib/brand';
import { darkPaletteFor } from '@/lib/theme';

const ROOT = path.resolve(__dirname, '..', '..');
const img = (rel: string) => PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets', 'images', rel)));
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;
const plugin = (name: string) => (app.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === name) as [string, Record<string, unknown>];
const px = (p: PNG, x: number, y: number) => { const i = (y * p.width + x) * 4; return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]]; };
const up = (s: string) => s.toUpperCase();

describe('ブランド色: app.json と BRAND が同値', () => {
  it('スプラッシュの地（明＝白・暗＝Navy）', () => {
    const s = plugin('expo-splash-screen')[1] as { backgroundColor: string; image: string; imageWidth: number; dark: { backgroundColor: string; image: string } };
    expect(up(s.backgroundColor)).toBe(BRAND.white);
    expect(up(s.dark.backgroundColor)).toBe(BRAND.navy);
    expect(s.image).toBe('./assets/images/splash-icon.png');
    expect(s.dark.image).toBe('./assets/images/splash-icon.png');   // 1素材で明暗両対応（白いタイル）
    expect(s.imageWidth).toBe(160);
  });
  it('Android 適応アイコンの地は白・背景画像は使わない（タイル二重化の廃止）', () => {
    const ai = app.android.adaptiveIcon as Record<string, string>;
    expect(up(ai.backgroundColor)).toBe(BRAND.white);
    expect(ai.backgroundImage).toBeUndefined();
    expect(ai.monochromeImage).toBe('./assets/images/android-icon-monochrome.png');
  });
  it('通知アイコンはテーマアイコンと同じ素材・色は円弧の赤', () => {
    const n = plugin('expo-notifications')[1] as { icon: string; color: string };
    expect(n.icon).toBe('./assets/images/android-icon-monochrome.png');
    expect(up(n.color)).toBe(BRAND.signal);
  });
  it('ダークのスプラッシュの地は theme.ts のダークの bg と同値', () => {
    expect(up(darkPaletteFor('electric').bg)).toBe(BRAND.navy);
  });
  it('LaunchIntro は BRAND を使い、生の HEX を持たない', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'components', 'LaunchIntro.tsx'), 'utf8');
    expect(src).toMatch(/BRAND\.white/);
    expect(src).toMatch(/BRAND\.navy/);
    expect(src).toMatch(/Appearance\.getColorScheme\(\)/);
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
  it('Web の theme-color も白', () => {
    const src = fs.readFileSync(path.join(ROOT, '..', 'app', 'layout.tsx'), 'utf8');
    expect(src).toMatch(/themeColor: '#ffffff'/);
  });
});

describe('画像の形式', () => {
  it('icon.png は 1024 の完全不透明・純白地（iOS は透明不可・角丸はOSが付ける）', () => {
    const p = img('icon.png');
    expect([p.width, p.height]).toEqual([1024, 1024]);
    let minA = 255;
    for (let i = 3; i < p.data.length; i += 4) if (p.data[i] < minA) minA = p.data[i];
    expect(minA).toBe(255);
    expect(px(p, 2, 2).slice(0, 3)).toEqual([255, 255, 255]);
    expect(px(p, 1021, 1021).slice(0, 3)).toEqual([255, 255, 255]);
  });
  it('splash-icon.png は角だけ透明の白いタイル（白地では円盤だけ・Navy 地では白いタイル）', () => {
    const p = img('splash-icon.png');
    expect([p.width, p.height]).toEqual([1024, 1024]);
    expect(px(p, 2, 2)[3]).toBe(0);                 // 角は透明
    expect(px(p, 512, 20)[3]).toBe(255);            // 辺の中央は不透明
    expect(px(p, 512, 20).slice(0, 3)).toEqual([255, 255, 255]);   // タイルは白
  });
  it('Android foreground は 1024 不透明・白地', () => {
    const p = img('android-icon-foreground.png');
    expect([p.width, p.height]).toEqual([1024, 1024]);
    expect(px(p, 2, 2)).toEqual([255, 255, 255, 255]);
  });
  it('monochrome は白1色・アルファ2段（リング60%・円弧100%）で、シルエットが安全域（中央66%＝205..819px）に収まる', () => {
    const p = img('android-icon-monochrome.png');
    expect([p.width, p.height]).toEqual([1024, 1024]);
    let minX = 1024, maxX = 0, minY = 1024, maxY = 0, n = 0, badAlpha = 0, notWhite = 0;
    const d = p.data;
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
      const i = (y * 1024 + x) * 4; const a = d[i + 3];
      if (a !== 0 && a !== 153 && a !== 255) badAlpha++;
      if (a !== 0) { n++; if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) notWhite++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    expect(badAlpha).toBe(0);            // アルファは 0 / 153（リング 60%）/ 255（円弧 100%）だけ（HIG Mono: 主 100%・副 60〜65%）
    expect(notWhite).toBe(0);            // 不透明画素は白1色
    expect(n).toBeGreaterThan(100000);   // 円盤ぶんの面積がある
    expect(minX).toBeGreaterThanOrEqual(205); expect(maxX).toBeLessThanOrEqual(819);
    expect(minY).toBeGreaterThanOrEqual(205); expect(maxY).toBeLessThanOrEqual(819);
  });
  it('favicon は 48px・Web の app-icon は 256px の角丸タイル', () => {
    const f = img('favicon.png');
    expect([f.width, f.height]).toEqual([48, 48]);
    const w = PNG.sync.read(fs.readFileSync(path.join(ROOT, '..', 'public', 'icons', 'app-icon.png')));
    expect([w.width, w.height]).toEqual([256, 256]);
    expect(px(w, 1, 1)[3]).toBe(0);
  });
  it('旧 Android 背景画像は無い', () => {
    expect(fs.existsSync(path.join(ROOT, 'assets', 'images', 'android-icon-background.png'))).toBe(false);
  });
});
