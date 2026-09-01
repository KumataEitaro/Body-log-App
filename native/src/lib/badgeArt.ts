// バッジ（メダル）の配色を「テーマトークン1色」から導出する純関数群。
//
// なぜ計算するのか:
//  ・生HEXを置くとテーマ（12アクセント×明暗）のどれかで必ず浮く。トークンの色相だけを借りて
//    彩度・明度はメダル用の固定値に正規化すると、どのテーマでも「同じ質感の金属円盤」になる。
//  ・カテゴリの色相はトークン由来（継続=amber / 記録=アクセント / 体重・運動=calorieBar系）。
//    アクセントと衝突したときだけ色相をずらす（spreadHues）ので、
//    オレンジテーマでも「継続」と「記録」が同じ色に見えることがない。
//  ・純関数なのでテストできる（badgeArt.test.ts）。Cトークンの読み出しは呼び出し側（BadgeIcon）。

export type Rgb = { r: number; g: number; b: number };

/** '#rgb' / '#rrggbb' / 'rgb(...)' / 'rgba(...)' を数値に。読めなければnull */
export function parseColor(c: string): Rgb | null {
  const s = c.trim();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (h.length === 3) {
      const n = [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16));
      return n.some(Number.isNaN) ? null : { r: n[0], g: n[1], b: n[2] };
    }
    if (h.length >= 6) {
      const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      return n.some(Number.isNaN) ? null : { r: n[0], g: n[1], b: n[2] };
    }
    return null;
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!m) return null;
  const n = [1, 2, 3].map((i) => Number(m[i]));
  return n.some((v) => !Number.isFinite(v)) ? null : { r: n[0], g: n[1], b: n[2] };
}

/** 色相（0-360）。無彩色や解析不能はnull */
export function hueOf(color: string): number | null {
  const c = parseColor(color);
  if (!c) return null;
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.004) return null;                    // ほぼグレー＝色相を持たない
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return (h + 360) % 360;
}

/** HSL→'rgb(r,g,b)'（生HEXを作らないため文字列はrgb()で返す） */
export function hsl(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.min(1, Math.max(0, s));
  const ll = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  const seg = Math.floor(hh / 60) % 6;
  const rgb = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg].map((v) => Math.round((v + m) * 255));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

/** 円周上の色相差（0-180） */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * アクセントの色相（anchor）から min 度以上離れるように、希望色相を押しのける。
 * 例: オレンジテーマ（anchor≒25）では「継続」の金色(36)が近すぎるので、離れる側へ寄せる。
 * anchorがnull（無彩色テーマ）のときは希望値そのまま。
 */
export function spreadHues(anchor: number | null, wanted: number[], min = 28): number[] {
  if (anchor == null) return wanted.slice();
  return wanted.map((w) => {
    if (hueGap(w, anchor) >= min) return w;
    // どちら回りで離れるか: いま少しでも進んでいる向きを尊重（同値なら+方向）
    const diff = ((w - anchor + 540) % 360) - 180;   // -180..180
    const dir = diff >= 0 ? 1 : -1;
    return ((anchor + dir * min) % 360 + 360) % 360;
  });
}

// メダルの質感（彩度・明度）。金ピカを避けるため彩度は0.6未満に抑え、
// 中心を明るく・外周を暗くして「厚みのある円盤」に見せる
const FACE = {
  core: { s: 0.52, l: 0.73 },   // 中心のハイライト
  mid: { s: 0.55, l: 0.53 },    // 面の主色
  edge: { s: 0.58, l: 0.35 },   // 外周へ向かう影
  rimHi: { s: 0.38, l: 0.82 },  // 外周リングの光る側
  rimLo: { s: 0.50, l: 0.42 },  // 外周リングの陰る側
};

export type MedalTones = {
  core: string; mid: string; edge: string;   // 円盤の面（放射グラデ）
  rimHi: string; rimLo: string;              // 外周リング（線形グラデ）
  shade: string;                             // 面の内側に落ちる影
  gloss: string;                             // 上半分の光沢
  icon: string;                              // 中央のシンボル
  ring: string;                              // 面と外周を分ける細い線
};

/** 獲得済みメダル: 色相だけを受け取り、質感は固定値で組む */
export function medalTones(hue: number): MedalTones {
  return {
    core: hsl(hue, FACE.core.s, FACE.core.l),
    mid: hsl(hue, FACE.mid.s, FACE.mid.l),
    edge: hsl(hue, FACE.edge.s, FACE.edge.l),
    rimHi: hsl(hue, FACE.rimHi.s, FACE.rimHi.l),
    rimLo: hsl(hue, FACE.rimLo.s, FACE.rimLo.l),
    shade: 'rgba(0,0,0,0.22)',
    gloss: 'rgba(255,255,255,0.22)',
    icon: 'rgba(255,255,255,0.97)',
    ring: 'rgba(255,255,255,0.35)',
  };
}

/**
 * 未獲得メダル: Appleのアチーブメントと同じ「無彩色のシルエット」。
 * 色はテーマトークンをそのまま使う（明暗どちらでも面と地の関係が壊れない）。
 */
export function silhouetteTones(tk: { chipBg: string; track: string; line: string; faint: string }): MedalTones {
  return {
    core: tk.chipBg, mid: tk.chipBg, edge: tk.track,
    rimHi: tk.line, rimLo: tk.line,
    shade: 'rgba(0,0,0,0.05)',
    gloss: 'rgba(255,255,255,0.05)',
    icon: tk.faint,
    ring: 'rgba(0,0,0,0.04)',
  };
}
