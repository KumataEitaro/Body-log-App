// en.ts に追加辞書をマージし、重複キーを除去する（一時スクリプト）
const fs = require('fs');
const addPath = process.argv[2];
const target = 'src/content/i18n/en.ts';

const add = fs.readFileSync(addPath, 'utf8');
let s = fs.readFileSync(target, 'utf8');
s = s.replace(/\n};\s*$/, '\n' + add.trimEnd() + '\n};\n');

const KEYRE = new RegExp("^\\s*'((?:[^'\\\\]|\\\\.)*)':");
const seen = new Set();
let dup = 0;
const out = [];
for (const ln of s.split('\n')) {
  const m = ln.match(KEYRE);
  if (m) {
    if (seen.has(m[1])) { dup++; continue; }
    seen.add(m[1]);
  }
  out.push(ln);
}
fs.writeFileSync(target, out.join('\n'));
console.log(`重複除去: ${dup}件 / 登録キー: ${seen.size}件`);
