// ソース中の t('...') を全部集めて、翻訳テーブルの雛形を出す
// 使い方:
//   node scripts/i18n-keys.js        → キー総数と「英語が未登録のもの」を一覧表示
//   node scripts/i18n-keys.js zh     → 中国語テーブルの雛形（値が空）を標準出力へ
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const RE = new RegExp("(?:^|[^A-Za-z0-9_$])t\\('((?:[^'\\\\]|\\\\.)*)'", 'g');
const keys = new Set();

(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (f !== '__tests__' && f !== 'i18n') walk(p);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(f)) continue;
    const s = fs.readFileSync(p, 'utf8');
    let m;
    RE.lastIndex = 0;
    while ((m = RE.exec(s)) !== null) keys.add(m[1]);
  }
})(SRC);

const sorted = [...keys].sort();
const target = process.argv[2];

if (!target) {
  const enPath = path.join(SRC, 'content', 'i18n', 'en.ts');
  const enSrc = fs.readFileSync(enPath, 'utf8');
  const have = new Set();
  const KEYRE = /^\s*'((?:[^'\\]|\\.)*)':/gm;
  let k;
  while ((k = KEYRE.exec(enSrc)) !== null) have.add(k[1]);
  const missing = sorted.filter((x) => !have.has(x));
  console.log(`t()で使用中のキー: ${sorted.length}件 / 英語辞書の登録: ${have.size}件`);
  console.log(`英語が未登録: ${missing.length}件（未登録は日本語のまま表示されます）`);
  missing.forEach((x) => console.log('  ' + x));
} else {
  console.log(`// ${target} 辞書の雛形。値を埋めるだけでこの言語になります。`);
  console.log(`export const ${target.toUpperCase()}: Record<string, string> = {`);
  sorted.forEach((x) => console.log(`  '${x.replace(/'/g, "\\'")}': '',`));
  console.log('};');
}
