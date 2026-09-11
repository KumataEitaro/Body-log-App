// i18n 辞書（native/src/content/i18n/*.ts）のマージ衝突を「両側を残す（union）」で解消し、重複キーが無いことを確認する。
// 並行ブランチはいつも辞書の末尾に追記するので、衝突マーカー3種を消せば両ブロックが並ぶ。CRLF/LF 両対応。
// 使い方: git merge で辞書だけ衝突したら `node scripts/resolve-i18n-conflicts.js` → `git add native/src/content/i18n && git commit`
const fs = require('fs');
const path = require('path');
const root = require("path").resolve(__dirname, "..");
const langs = ['de', 'en', 'es', 'fr', 'id', 'ko', 'pt', 'th', 'vi', 'zh'];
let bad = 0;
for (const l of langs) {
  const p = path.join(root, 'native/src/content/i18n', l + '.ts');
  let s = fs.readFileSync(p, 'utf8');
  const had = /^<<<<<<< /m.test(s);
  s = s
    .replace(/^<<<<<<< [^\r\n]*\r?\n/mg, '')
    .replace(/^=======\r?\n/mg, '')
    .replace(/^>>>>>>> [^\r\n]*\r?\n/mg, '');
  if (/^(<<<<<<<|=======|>>>>>>>)/m.test(s)) { console.error('マーカー残存', p); bad = 1; }
  // 重複キー検査（"key": または 'key': の行頭キー）
  const keys = new Map();
  const re = /^\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*:/mg;
  for (const m of s.matchAll(re)) keys.set(m[1], (keys.get(m[1]) || 0) + 1);
  const dup = [...keys].filter(([, n]) => n > 1).map(([k]) => k);
  if (dup.length) { console.error('重複キー', p, dup.slice(0, 5)); bad = 1; }
  fs.writeFileSync(p, s);
  console.log(l, had ? 'resolved' : 'no-conflict', 'keys=' + keys.size, 'dups=' + dup.length);
}
process.exit(bad);
