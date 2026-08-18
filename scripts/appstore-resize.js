// 実機スクリーンショット（iPhone 16 Pro: 1206×2622）を
// App Storeの6.5インチ枠（1242×2688）へ変換する。
// アスペクト比がほぼ同じ（0.4600 vs 0.4620）なので、cover で中央を使い端をわずかに詰める。
// 実行: node scripts/appstore-resize.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const W = 1242, H = 2688;
const SRC_DIR = 'C:/Users/hashi/Downloads';
const OUT_DIR = path.join(__dirname, '..', 'appstore');

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(SRC_DIR).filter((f) => /^IMG_\d+\.PNG$/i.test(f));

fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  for (const name of targets) {
    const src = path.join(SRC_DIR, name);
    const out = path.join(OUT_DIR, name.replace(/\.PNG$/i, `-${W}x${H}.png`));
    const meta = await sharp(src).metadata();
    const info = await sharp(src)
      .resize(W, H, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
      .png()
      .toFile(out);
    console.log(`${name}  ${meta.width}x${meta.height}  →  ${info.width}x${info.height}  ${path.basename(out)}`);
    if (info.width !== W || info.height !== H) throw new Error('寸法が違います: ' + name);
  }
  console.log(`\n出力先: ${OUT_DIR}`);
})().catch((e) => { console.error('失敗:', e.message); process.exit(1); });
