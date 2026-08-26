// i18n辞書の重複キーを除去する（先勝ち＝最初の定義を残す）。
// translate-loopの追記で同じキーが二重登録された時の修理用。
// 使い方: node scripts/dedup-dict.js
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'content', 'i18n');
for (const f of fs.readdirSync(DIR)) {
  if (!/^[a-z]{2}\.ts$/.test(f)) continue;
  const p = path.join(DIR, f);
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const seen = new Set();
  let removed = 0;
  const out = lines.filter((line) => {
    const m = line.match(/^\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'):\s*/);
    if (!m) return true;
    // キー文字列を正規化（クォート種を問わず中身で比較）
    let key;
    try { key = JSON.parse(m[1].startsWith("'") ? '"' + m[1].slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"' : m[1]); }
    catch { key = m[1]; }
    if (seen.has(key)) { removed++; return false; }
    seen.add(key);
    return true;
  });
  if (removed > 0) fs.writeFileSync(p, out.join('\n'));
  console.log(`${f}: 重複除去 ${removed}件`);
}
