// コントラスト計算（WCAG 2.1）。パレットの派生値を「目で合わせる」のではなく計算で決めるための純関数。
//
// 【なぜ必要か】2026-09-02 の新アイコン配色（Electric Blue #4D7CFF）は塗り面には映えるが、
// 白地の小さい文字としては 3.7:1 で WCAG AA（4.5:1）に届かない。同じことは既存の
// グリーン(#059669 → 3.8:1)・ライム(#65a30d → 3.1:1)にも当てはまり、これまで「白地にアクセント色の
// 小さい文字」は全アクセントで基準未達だった。そこで「塗り面用のアクセント（teal）」と
// 「白地の文字用の濃いアクセント（accentInk）」を分け、accentInk は**基準を満たすまで自動で濃くする**。
// 目視で色を選ぶと、ここが必ず抜ける（見た目は綺麗でも数値が足りない）ので、計算で固定する。
//
// ここに色の実値（HEX）は置かない。混ぜる先（黒・白）も数値演算で表す。

/** '#rrggbb' → [r, g, b]（0-255）。3桁・透明度付きは扱わない（パレットは6桁で統一している） */
export function parseHex(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/** sRGB の相対輝度（WCAG 2.1 の定義。0=黒, 1=白） */
export function luminance(hex: string): number {
  const lin = (v8: number) => {
    const v = v8 / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseHex(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** コントラスト比（1〜21）。AA: 本文 4.5 / 大きい文字・UI部品 3.0 */
export function contrast(a: string, b: string): number {
  const l1 = luminance(a), l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA の閾値。テストとパレット導出で同じ数値を参照する（散らばると片方だけ緩む） */
export const AA_TEXT = 4.5;   // 通常の文字
export const AA_LARGE = 3.0;  // 大きい文字（18pt / 14pt太字以上）・アイコン・UI部品の境界

/**
 * fg を bg に対して min 以上のコントラストになるまで、黒（darker）または白（lighter）へ
 * 1%刻みで寄せる。既に満たしていれば fg をそのまま返す（＝既存の色は変えない）。
 * 色相は保たれる（黒/白との線形混合なので彩度だけ落ちる）。
 * 100%寄せても届かないときは端の色（黒/白）を返す。
 */
export function ensureContrast(fg: string, bg: string, min: number, toward: 'darker' | 'lighter'): string {
  if (contrast(fg, bg) >= min) return fg;
  const base = parseHex(fg);
  const target = toward === 'darker' ? 0 : 255;
  for (let step = 1; step <= 100; step++) {
    const k = step / 100;
    const c = toHex([base[0] + (target - base[0]) * k, base[1] + (target - base[1]) * k, base[2] + (target - base[2]) * k]);
    if (contrast(c, bg) >= min) return c;
  }
  return toHex([target, target, target]);
}

/** 2色を t:1-t で混ぜる（t=1 で a、t=0 で b）。派生パレットの薄い面・暗所の持ち上げに使う */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a), pb = parseHex(b);
  return toHex([pa[0] * t + pb[0] * (1 - t), pa[1] * t + pb[1] * (1 - t), pa[2] * t + pb[2] * (1 - t)]);
}
