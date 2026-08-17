// アプリアイコンの円盤センタリング検査（アイコン変更時は必ず実行すること）
// 使い方: sharpが入った環境で `node scripts/icon-center-check.js`
//   （sharpはネイティブ依存のためdevDependenciesに入れていない。
//     `npm i --no-save sharp` するか、sharp導入済みの作業ディレクトリから
//     `node <このファイル> <icon.pngのパス>` で実行）
//
// 手法: 円盤の外周エッジを全方位レイキャストで検出し、最小二乗円フィットで中心を推定。
// 右下の落ち影帯(10°-120°)は除外。バウンディングボックス法は影で偏るため使用禁止
// （2026-08 に bbox 法で 12px の見た目ズレを見逃した実績あり）。
// 合格基準: |オフセット| ≤ 2px（閾値250・252の両方で）
const sharp = require('sharp');

const file = process.argv[2] || `${__dirname}/../assets/images/icon.png`;

function fitCircle(pts) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  for (const [x, y] of pts) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], b = [sxz, syz, sz];
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let j = i + 1; j < 3; j++) { const f = A[j][i] / A[i][i]; for (let k = i; k < 3; k++) A[j][k] -= f * A[i][k]; b[j] -= f * b[i]; }
  }
  const v = [0, 0, 0];
  for (let i = 2; i >= 0; i--) { v[i] = b[i]; for (let k = i + 1; k < 3; k++) v[i] -= A[i][k] * v[k]; v[i] /= A[i][i]; }
  return { cx: v[0] / 2, cy: v[1] / 2 };
}

(async () => {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels;
  const cx0 = W / 2, cy0 = H / 2;
  const lum = (x, y) => { const i = (y * W + x) * ch; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  let pass = true;
  for (const thr of [250, 252]) {
    const pts = [];
    for (let a = 0; a < 360; a += 1) {
      if (a >= 10 && a <= 120) continue; // 右下の落ち影帯を除外
      const rad = (a * Math.PI) / 180;
      for (let r = Math.floor(W * 0.49); r > W * 0.2; r--) {
        const x = Math.round(cx0 + r * Math.cos(rad)), y = Math.round(cy0 + r * Math.sin(rad));
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (lum(x, y) < thr) { pts.push([cx0 + r * Math.cos(rad), cy0 + r * Math.sin(rad)]); break; }
      }
    }
    const c = fitCircle(pts);
    const dx = c.cx - cx0, dy = c.cy - cy0;
    const ok = Math.abs(dx) <= 2 && Math.abs(dy) <= 2;
    pass = pass && ok;
    console.log(`thr${thr}: offset(${dx.toFixed(1)}, ${dy.toFixed(1)}) ${ok ? 'OK' : 'NG'}`);
  }
  console.log(pass ? '✅ センタリング合格（±2px以内）' : '❌ 不合格 — アイコンを再センタリングしてください');
  process.exit(pass ? 0 : 1);
})();
