// テーマ切替のリグレッションテスト。
//
// 2026-09-02 の「まだらバグ」は、色を**値で置換**していたことが原因だった。
// 現在の方式は「テーマが変わったらスタイルを作り直す（themed）」。
// ここでは、以前の方式が落ちていた4つの穴が塞がっていることを固定する:
//   1) 遅れて定義されたスタイルも現在のテーマで作られる
//   2) rgba(C.x, a) のような加工色も追従する
//   3) 同じ値を持つ別トークン／生の白と混同しない
//   4) テーマ変更でスタイルの**参照が変わる**（Reactが差分を検知できる）
import { C, applyPalette, themed, themeGeneration, rgba } from '@/lib/ui';
import { PALETTES, pfcColors, DEFAULT_PFC, paletteFor, darkPaletteFor } from '@/lib/theme';

beforeEach(() => { applyPalette(PALETTES.green); }); // 各テストは既定のグリーンから始める

describe('テーマ', () => {
  it('パレット適用で背景・罫線・アクセントがまとめて変わる', () => {
    expect(C.teal).toBe('#059669');
    applyPalette(PALETTES.blue);
    expect(C.teal).toBe('#2563eb');
    expect(C.bg).toBe('#fafbfd');    // 背景も青寄りに
    expect(C.line).toBe('#e5e9f0');  // 罫線も
    applyPalette(PALETTES.green);
    expect(C.bg).toBe('#fbfbfa');
  });

  it('P/F/Cの配色はテーマとは独立している', () => {
    const before = pfcColors();
    applyPalette(PALETTES.pink);
    expect(pfcColors()).toEqual(before); // テーマを変えてもPFCは不変
    expect(pfcColors().p).toBe(DEFAULT_PFC.p);
  });

  it('全テーマがパレットの全キーを持つ', () => {
    const keys = Object.keys(PALETTES.green);
    for (const p of Object.values(PALETTES)) {
      expect(Object.keys(p).sort()).toEqual(keys.sort());
    }
  });
});

describe('themed（テーマ追従スタイル）', () => {
  it('テーマを変えると色が入れ替わる（再起動不要）', () => {
    const s = themed(() => ({
      card: { backgroundColor: C.panel, borderColor: C.line },
      btn: { backgroundColor: C.teal },
    }));
    expect(s.btn.backgroundColor).toBe('#059669');

    applyPalette(PALETTES.purple);
    expect(s.btn.backgroundColor).toBe('#7c3aed');
    expect(s.card.borderColor).toBe('#ebe6f0');
  });

  it('【穴1】テーマ変更後に初めて定義されたスタイルも新しいテーマで作られる', () => {
    // 画面は遅延読込されるため、切替のあとに初めて評価されるスタイル定義がある。
    // 旧方式（生成済みを遡って置換）はこれを取りこぼし、まだらの主犯になっていた
    applyPalette(PALETTES.orange);
    const late = themed(() => ({ box: { backgroundColor: C.teal, borderColor: C.line } }));
    expect(late.box.backgroundColor).toBe(PALETTES.orange.teal);
    expect(late.box.borderColor).toBe(PALETTES.orange.line);
  });

  it('【穴2】rgba(C.x, a) のような加工色も追従する', () => {
    // 旧方式は「値の一致」で置換していたため、計算で作った色は対応表に載らず取り残された
    const s = themed(() => ({ glow: { borderColor: rgba(C.teal, 0.3), shadowColor: rgba(C.ink, 0.08) } }));
    expect(s.glow.borderColor).toBe(rgba(PALETTES.green.teal, 0.3));

    applyPalette(PALETTES.rose);
    expect(s.glow.borderColor).toBe(rgba(PALETTES.rose.teal, 0.3));
    expect(s.glow.shadowColor).toBe(rgba(PALETTES.rose.ink, 0.08));
  });

  it('【穴3】同じ値の別トークン・生の白を取り違えない', () => {
    // ライトの panel は '#ffffff'。旧方式では「白文字の #ffffff」まで
    // カード面の暗色へ巻き込み置換していた（＝文字が読めなくなる）
    const s = themed(() => ({
      card: { backgroundColor: C.panel },
      onAccent: { color: '#ffffff' },   // アクセント地の上に載る白文字。テーマに追従してはいけない
    }));
    expect(s.card.backgroundColor).toBe('#ffffff');

    applyPalette(darkPaletteFor('green'));
    expect(s.card.backgroundColor).toBe(darkPaletteFor('green').panel); // 面は暗くなる
    expect(s.onAccent.color).toBe('#ffffff');                          // 白文字は白のまま
  });

  it('【穴4】テーマを変えるとスタイルの参照が変わる（Reactが差分を検知できる）', () => {
    // オブジェクトを破壊的に書き換えるだけだと、Reactはstyleを参照の同一性で
    // 判定するため「変化なし」と見なし、ネイティブビューに新しい色が届かない
    const s = themed(() => ({ card: { backgroundColor: C.panel } }));
    const before = s.card;
    expect(s.card).toBe(before); // 同じテーマの間は安定（無駄な再描画を起こさない）

    applyPalette(darkPaletteFor('blue'));
    expect(s.card).not.toBe(before);
  });

  it('世代番号はパレットが実際に変わったときだけ進む', () => {
    const g0 = themeGeneration();
    applyPalette(PALETTES.green);   // 同じパレット＝変化なし
    expect(themeGeneration()).toBe(g0);
    applyPalette(PALETTES.lime);
    expect(themeGeneration()).toBe(g0 + 1);
  });

  it('明暗・アクセント・背景トーンの3種すべてで全トークンが入れ替わる', () => {
    const s = themed(() => ({ v: { backgroundColor: C.bg, color: C.ink, borderColor: C.hairline } }));

    // (a) 背景トーンだけ変える
    applyPalette(paletteFor('green', 'white'));
    const white = s.v.backgroundColor;
    applyPalette(paletteFor('green', 'strong'));
    expect(s.v.backgroundColor).not.toBe(white);

    // (b) アクセントだけ変える
    applyPalette(paletteFor('indigo', 'strong'));
    expect(s.v.backgroundColor).toBe(paletteFor('indigo', 'strong').bg);

    // (c) 明暗を変える（文字色・ヘアラインまで反転する）
    applyPalette(darkPaletteFor('indigo'));
    expect(s.v.color).toBe(darkPaletteFor('indigo').ink);
    expect(s.v.borderColor).toBe(darkPaletteFor('indigo').hairline);
  });

  it('ダークではヘアラインと影が明色側／純黒へ入れ替わる', () => {
    // ライトの 'rgba(14,17,22,0.08)' をダークでそのまま使うと、暗い面の上で
    // 縁取りが消えてカードの輪郭が失われる（βフィードバックのダーク時の症状）
    for (const accent of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
      const light = paletteFor(accent, 'soft');
      const dark = darkPaletteFor(accent);
      expect(light.hairline).toBe('rgba(14,17,22,0.08)');
      expect(dark.hairline).not.toBe(light.hairline);
      expect(dark.shadow).toBe('#000000');
    }
  });
});
