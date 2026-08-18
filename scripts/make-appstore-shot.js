// App Store用スクリーンショット生成（6.5インチ = 1242×2688px ちょうど）
// アプリの実UI（native/src/lib/ui.ts のパレットと log.tsx のレイアウト）を忠実に再現する。
// 実行: node scripts/make-appstore-shot.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const W = 1242, H = 2688;
const S = 3;                     // @3x（6.5インチ = 414×896pt）
const CW = W / S, CH = H / S;    // CSS px 換算 = 414 × 896
const px = (v) => v * S;

// アプリの実パレット
const C = {
  bg: '#fbfbfa', panel: '#ffffff', ink: '#0e1116', sub: '#6a7280', faint: '#9aa1ab',
  line: '#e9eae7', teal: '#059669', accentBadge: '#e6f7f2', track: '#eceeeb',
  calorieBar: '#3f4c5a', coral: '#ff2d2d', chipBg: '#f4f5f3',
  pfcP: '#059669', pfcF: '#d97706', pfcC: '#2563eb',
};
const FONT = "'Yu Gothic UI','Yu Gothic','Meiryo','Hiragino Sans',sans-serif";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function T(x, y, text, { size = 14, weight = 400, fill = C.ink, anchor = 'start', spacing = 0 } = {}) {
  return `<text x="${px(x)}" y="${px(y)}" font-family="${FONT}" font-size="${px(size)}"
    font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"
    letter-spacing="${px(spacing)}">${esc(text)}</text>`;
}
function R(x, y, w, h, r, fill, stroke = null, sw = 1) {
  return `<rect x="${px(x)}" y="${px(y)}" width="${px(w)}" height="${px(h)}" rx="${px(r)}"
    fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${px(sw)}"` : ''} />`;
}
function LINE(x1, y1, x2, y2, color, sw = 0.7) {
  return `<line x1="${px(x1)}" y1="${px(y1)}" x2="${px(x2)}" y2="${px(y2)}" stroke="${color}" stroke-width="${px(sw)}"/>`;
}

// ===== 表示する内容（デモデータの数値に合わせる） =====
const GOAL = 2100, EATEN = 1320, LEFT = GOAL - EATEN;
const feed = [
  ['7:52', '🍽', '納豆ごはん、味噌汁、焼き鮭', '520'],
  ['8:10', '🏃', 'ウォーキング 30分（約155kcal）', ''],
  ['12:35', '🍽', '鶏むね肉のサラダボウル、玄米', '620'],
  ['18:42', '🏋', 'ベンチプレス 75kg×8×3', ''],
];

let g = `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;

// ---- 見出し帯 ----
const BAND = 96;
g += `<rect width="${W}" height="${px(BAND)}" fill="${C.teal}"/>`;
g += T(24, 42, '食事を1行書くだけ。', { size: 25, weight: 700, fill: '#ffffff' });
g += T(24, 72, 'AIが栄養とカロリーを推定します', { size: 14, weight: 500, fill: 'rgba(255,255,255,0.93)' });

// ---- ステータスバー ----
let y = BAND + 20;
g += T(28, y + 6, '9:41', { size: 14, weight: 700 });
for (let i = 0; i < 4; i++) g += R(336 + i * 7, y + 2 - i * 2.2, 4, 5 + i * 2.2, 1, C.ink);
g += R(372, y - 5, 24, 11, 3, 'none', C.ink, 1.2);
g += R(374, y - 3, 18, 7, 2, C.ink);

// ---- ヘッダー ----
y = BAND + 52;
g += T(22, y + 8, '食事', { size: 21, weight: 700 });
g += R(228, y - 12, 84, 30, 15, C.panel, C.line, 1);
g += T(270, y + 8, '今日', { size: 14, weight: 700, anchor: 'middle' });
g += R(356, y - 12, 30, 30, 9, C.panel, C.line, 1);
g += `<circle cx="${px(371)}" cy="${px(y + 3)}" r="${px(5.5)}" fill="none" stroke="${C.sub}" stroke-width="${px(1.6)}"/>`;
g += `<circle cx="${px(371)}" cy="${px(y + 3)}" r="${px(1.8)}" fill="none" stroke="${C.sub}" stroke-width="${px(1.6)}"/>`;

// ---- ヒーローカード ----
const cardX = 16, cardW = CW - 32;
const heroY = BAND + 78, heroH = 272;
g += R(cardX, heroY, cardW, heroH, 20, C.panel, C.line, 1);
g += T(cardX + 18, heroY + 28, 'あと食べられる（計画）', { size: 11.5, weight: 700, fill: C.sub, spacing: 0.5 });
g += T(cardX + 18, heroY + 80, String(LEFT), { size: 44, weight: 800 });
g += T(cardX + 18 + String(LEFT).length * 26 + 6, heroY + 80, 'kcal', { size: 15, weight: 600, fill: C.sub });

const barY = heroY + 98;
g += R(cardX + 18, barY, cardW - 36, 7, 4, C.track);
g += R(cardX + 18, barY, (cardW - 36) * (EATEN / GOAL), 7, 4, C.calorieBar);
g += T(cardX + 18, barY + 28, `摂取 ${EATEN.toLocaleString()}`, { size: 12, fill: C.sub });
g += T(cardX + cardW - 18, barY + 28, `目標 ${GOAL.toLocaleString()}`, { size: 12, fill: C.sub, anchor: 'end' });

const pfc = [
  ['たんぱく質', 'P', 0.62, C.pfcP, 'あと 48g', false],
  ['脂質', 'F', 0.44, C.pfcF, 'あと 32g', false],
  ['炭水化物', 'C', 1.0, C.pfcC, '+18g 超過', true],
];
let py = barY + 46;
for (const [ja, ab, ratio, col, right, over] of pfc) {
  g += T(cardX + 18, py + 9, ja, { size: 12, weight: 700 });
  g += T(cardX + 18 + ja.length * 12.5 + 3, py + 9, ab, { size: 9.5, weight: 700, fill: C.faint });
  const bx = cardX + 112, bw = 150;
  g += R(bx, py + 2, bw, 7, 4, C.track);
  g += R(bx, py + 2, bw * ratio, 7, 4, over ? C.coral : col);
  g += T(cardX + cardW - 18, py + 9, right, { size: 11.5, weight: 600, fill: over ? C.coral : C.sub, anchor: 'end' });
  py += 20;
}

const advY = py + 6;
g += R(cardX + 14, advY, cardW - 28, 48, 12, C.accentBadge);
g += T(cardX + 26, advY + 20, '炭水化物はもう十分なので、追加するなら', { size: 11.5 });
g += T(cardX + 26, advY + 37, '「低脂質・高たんぱく」の鶏むね肉がおすすめです。', { size: 11.5 });

// ---- 今日の記録カード ----
const feedY = heroY + heroH + 12;
const feedH = 42 + feed.length * 40;
g += R(cardX, feedY, cardW, feedH, 20, C.panel, C.line, 1);
g += T(cardX + 18, feedY + 28, '今日の記録', { size: 13, weight: 800, spacing: 0.8 });
g += T(cardX + 100, feedY + 28, `— ${feed.length}件`, { size: 13, fill: C.sub });
let fy = feedY + 44;
for (const [time, icon, title, kcal] of feed) {
  g += LINE(cardX + 18, fy, cardX + cardW - 18, fy, C.line);
  g += T(cardX + 18, fy + 24, time, { size: 11, weight: 700, fill: C.faint });
  g += T(cardX + 56, fy + 25, icon, { size: 14 });
  g += T(cardX + 80, fy + 25, title, { size: 13 });
  if (kcal) {
    g += T(cardX + cardW - 44, fy + 25, kcal, { size: 14, weight: 700, anchor: 'end' });
    g += T(cardX + cardW - 18, fy + 25, 'kcal', { size: 10, fill: C.faint, anchor: 'end' });
  }
  fy += 40;
}

// ---- 残量ストリップ ＋ 入力ドック（下部固定） ----
const tabTop = CH - 76;          // タブバーの上端
const dockH = 56;
const dockY = tabTop - dockH - 12;
const stripY = dockY - 30;

g += LINE(0, stripY - 8, CW, stripY - 8, C.line);
g += T(20, stripY + 12, `残り ${LEFT}kcal`, { size: 12.5, weight: 800, fill: C.teal });
g += T(140, stripY + 12, '残り たんぱく質 48g・脂質 32g', { size: 11.5, weight: 700, fill: C.sub });

g += `<rect x="${px(10)}" y="${px(dockY)}" width="${px(CW - 20)}" height="${px(dockH)}" rx="${px(18)}"
      fill="${C.panel}" stroke="${C.teal}" stroke-width="${px(2)}"/>`;
g += R(20, dockY + 12, 32, 32, 10, C.accentBadge);
g += T(36, dockY + 33, '✎', { size: 16, fill: C.teal, anchor: 'middle' });
g += T(64, dockY + 34, 'ここをタップして食事を入力…', { size: 15, weight: 600, fill: C.sub });
g += `<circle cx="${px(CW - 36)}" cy="${px(dockY + 28)}" r="${px(17)}" fill="${C.teal}"/>`;
g += T(CW - 36, dockY + 34, '↑', { size: 17, weight: 700, fill: '#ffffff', anchor: 'middle' });

// ---- タブバー ----
g += LINE(0, tabTop, CW, tabTop, C.line);
const tabs = [['🍽', '食事', true], ['📈', '運動', false], ['💬', '相談', false], ['📊', '概要', false]];
tabs.forEach(([icon, label, active], i) => {
  const cx = CW / 8 + (i * CW) / 4;
  g += T(cx, tabTop + 28, icon, { size: 17, anchor: 'middle' });
  g += T(cx, tabTop + 46, label, { size: 10.5, weight: 700, fill: active ? C.teal : C.faint, anchor: 'middle' });
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${g}</svg>`;

const outDir = path.join(__dirname, '..', 'appstore');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'screenshot-1-meals-1242x2688.png');

sharp(Buffer.from(svg)).png().toFile(out).then((info) => {
  console.log(`生成: ${out}`);
  console.log(`サイズ: ${info.width} × ${info.height} px`);
  if (info.width !== W || info.height !== H) throw new Error('寸法が違います');
}).catch((e) => { console.error('失敗:', e.message); process.exit(1); });
