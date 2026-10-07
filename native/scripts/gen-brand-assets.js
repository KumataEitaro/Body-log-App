// 旧アイコン（白地・白い円盤・赤い円弧 = 356f29d の icon.png）からブランド素材一式を生成する（2026-10-07）
//   icon.png                    1024 不透明・純白地（iOS / App Store / Expo 既定）
//   splash-icon.png             1024 白い角丸タイル（透明角）。白地では縁が見えず円盤だけ、ダーク地では白いアイコンタイルに見える＝1素材で明暗両対応
//   android-icon-foreground.png 1024 不透明白地・円盤を安全域（中央66%）に収めて再配置
//   android-icon-monochrome.png 1024 白1色・アルファ2値のシルエット（円盤∪円弧）。テーマアイコンと通知アイコンの共通素材
//   favicon.png                 48   不透明白地
//   public/icons/app-icon.png   256  角丸タイル（透明角）Web 招待ページ用
// sharp はネイティブ依存のため devDependencies に入れていない。リポジトリ直下（Next.js 側）の node_modules から解決される
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
// 元画像 = 現行の icon.png（1024・不透明・純白地）。差し替えるときは icon.png を置いてからこのスクリプトを回す
const SRC = path.join(__dirname, '..', 'assets', 'images', 'icon.png');
const OUT = path.join(__dirname, '..', 'assets', 'images') + path.sep;
const WEB = path.join(__dirname, '..', '..', 'public', 'icons') + path.sep;
const S = 1024;

function roundedMaskSvg(size, radius) {
  return Buffer.from(`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
}

(async () => {
  const base = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (base.info.width !== S || base.info.height !== S) throw new Error('source must be 1024');

  // 1) icon.png は元画像そのもの（不透明・純白地。検証は icon-center-check.js）。ここでは触らない

  // 2) splash-icon.png: 角丸タイル（iOS の角丸率 ≈ 22.37%）。角だけ透明にする
  const tile = await sharp(SRC).ensureAlpha()
    .composite([{ input: roundedMaskSvg(S, Math.round(S * 0.2237)), blend: 'dest-in' }])
    .png().toBuffer();
  fs.writeFileSync(OUT + 'splash-icon.png', tile);

  // 3) Android foreground: 円盤（bbox 幅 777px）を安全円（直径 676px・中央66%）に収める。
  //    影を含めて 0.76 倍 → 円盤 ≈ 590px、bbox ≈ 217..807（安全域 205..819 の内側）
  const scale = 0.76;
  const inner = Math.round(S * scale);
  const scaled = await sharp(SRC).removeAlpha().resize(inner, inner, { kernel: 'lanczos3' }).png().toBuffer();
  const off = Math.round((S - inner) / 2);
  await sharp({ create: { width: S, height: S, channels: 3, background: '#ffffff' } })
    .composite([{ input: scaled, left: off, top: off }])
    .png().toFile(OUT + 'android-icon-foreground.png');

  // 4) monochrome: シルエット = 円盤の円（中心 512,512・半径 388）∪ 赤い円弧。白1色・アルファ 0/255 の2値。
  //    foreground と同じ幾何（0.76 倍・中央）に置く
  // 実測（行 512 の走査）: 内側の盛り上がった円 r≈0..200、溝 r≈216..260、外側のリング r≈262..388、赤い円弧はリングに重なる。
  // シルエットは「リング（副要素・白60%）∪ 円弧（主要素・白100%）」。内側の円は抜く＝24px でも「リング＋濃い一区間」として読める
  //（塗りつぶしの丸1つだと「点」にしか見えない）。階調は 2 段だけ（HIG の Mono: 主 100% / 副 60〜65%）
  const { data } = base;
  const cx = 512, cy = 512, r = 388, ri = 262;
  const RING = 153, ARC = 255;
  const maskFull = Buffer.alloc(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const R = data[i], G = data[i + 1], B = data[i + 2];
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    const inRing = d2 <= r * r && d2 >= ri * ri;
    const isRed = R > 150 && G < 130 && B < 150 && R - G > 60;
    maskFull[y * S + x] = isRed ? ARC : inRing ? RING : 0;
  }
  // 円弧の縁の取りこぼし（アンチエイリアス）を 2px 膨張で埋める（値は最大を採る＝2段のまま）
  const dil = Buffer.alloc(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < S && xx >= 0 && xx < S && maskFull[yy * S + xx] > v) v = maskFull[yy * S + xx];
    }
    dil[y * S + x] = v;
  }
  // 0.76 倍・中央配置を自前の最近傍サンプリングで（sharp の raw 1ch resize はストライドが崩れたため）
  const mono = Buffer.alloc(S * S * 4, 0);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const sx = Math.round((x - off) / scale), sy = Math.round((y - off) / scale);
    const a = sx >= 0 && sy >= 0 && sx < S && sy < S ? dil[sy * S + sx] : 0;
    const j = (y * S + x) * 4;
    mono[j] = 255; mono[j + 1] = 255; mono[j + 2] = 255; mono[j + 3] = a;
  }
  await sharp(mono, { raw: { width: S, height: S, channels: 4 } }).png().toFile(OUT + 'android-icon-monochrome.png');

  // 5) favicon 48（不透明白地）
  await sharp(SRC).removeAlpha().resize(48, 48, { kernel: 'lanczos3' }).png().toFile(OUT + 'favicon.png');

  // 6) Web 招待ページ用 256 角丸タイル（透明角）
  await sharp(tile).resize(256, 256, { kernel: 'lanczos3' }).png().toFile(WEB + 'app-icon.png');

  // 7) 旧 Android 背景画像は廃止（backgroundColor の単色に一本化）
  if (fs.existsSync(OUT + 'android-icon-background.png')) fs.unlinkSync(OUT + 'android-icon-background.png');

  // 検証
  for (const f of ['icon.png', 'splash-icon.png', 'android-icon-foreground.png', 'android-icon-monochrome.png', 'favicon.png']) {
    const m = await sharp(OUT + f).metadata();
    console.log(f, m.width + 'x' + m.height, 'alpha=' + m.hasAlpha);
  }
  const mm = await sharp(OUT + 'android-icon-monochrome.png').raw().toBuffer({ resolveWithObject: true });
  let minX = S, maxX = 0, minY = S, maxY = 0, nMid = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = mm.data[(y * S + x) * 4 + 3];
    if (a !== 0 && a !== 255) nMid++;
    if (a === 255) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  console.log(`monochrome silhouette bbox x ${minX}..${maxX} y ${minY}..${maxY} (safe 205..819) midAlpha=${nMid}`);
  const wm = await sharp(WEB + 'app-icon.png').metadata();
  console.log('web app-icon', wm.width + 'x' + wm.height, 'alpha=' + wm.hasAlpha);
})().catch((e) => { console.error(e); process.exit(1); });
