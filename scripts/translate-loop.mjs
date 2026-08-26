// 辞書の欠けを本番の /api/translate-qa で埋めるハーネス。
// 使い方: node scripts/translate-loop.mjs <QA_SECRETファイル> <言語コード...>
//   例: node scripts/translate-loop.mjs secret.txt fr de pt id th vi
// 手順: t()で使用中のキーを集計 → 各言語辞書の欠けを抽出 → 40件ずつ翻訳 → 辞書へ追記。
// プレースホルダ({n}等)が訳で壊れていたらその訳を捨てて日本語フォールバックに任せる。
import fs from 'fs';
import path from 'path';

const SECRET = fs.readFileSync(process.argv[2], 'utf8').trim();
const TARGETS = process.argv.slice(3);
const URL_QA = 'https://bodylog-orcin.vercel.app/api/translate-qa';
const I18N_DIR = 'native/src/content/i18n';
const LANG_NAME = { en: 'English', ko: 'Korean', zh: 'Simplified Chinese', es: 'Spanish', fr: 'French', de: 'German', pt: 'Brazilian Portuguese', id: 'Indonesian', th: 'Thai', vi: 'Vietnamese' };

// ---- t('...')で使用中のキーを集める（native/scripts/i18n-keys.jsと同じ考え方） ----
function usedKeys() {
  const keys = new Set();
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|__tests__|content[\\/]i18n/.test(p)) walk(p); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      const s = fs.readFileSync(p, 'utf8');
      for (const m of s.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)+)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
      for (const m of s.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)+)"/g)) keys.add(m[1].replace(/\\"/g, '"'));
    }
  })('native/src');
  return [...keys];
}

function readDict(code) {
  const p = `${I18N_DIR}/${code}.ts`;
  const s = fs.readFileSync(p, 'utf8');
  const map = new Map();
  for (const m of s.matchAll(/^\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'):\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'),\s*$/gm)) {
    try { map.set(JSON.parse(m[1].replace(/^'|'$/g, '"')), JSON.parse(m[2].replace(/^'|'$/g, '"'))); }
    catch { /* シングルクォート行はスキップ（追記はJSONで書くので新規分は必ず読める） */ }
  }
  return map;
}

function appendDict(code, pairs) {
  const p = `${I18N_DIR}/${code}.ts`;
  let s = fs.readFileSync(p, 'utf8');
  const lines = pairs.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
  if (!/\n};\s*$/.test(s)) throw new Error(`${code}.ts の末尾が想定外`);
  s = s.replace(/\n};\s*$/, '\n' + lines + '\n};\n');
  fs.writeFileSync(p, s);
}

const placeholders = (s) => (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort().join(',');

const KEYS = usedKeys();
const EN = readDict('en');
console.log(`使用中キー: ${KEYS.length}件`);

for (const code of TARGETS) {
  const dict = readDict(code);
  const missing = KEYS.filter((k) => !dict.has(k));
  console.log(`\n===== ${code}: 欠け ${missing.length}件 =====`);
  let ok = 0, bad = 0;
  for (let i = 0; i < missing.length; i += 40) {
    const batch = missing.slice(i, i + 40);
    const res = await fetch(URL_QA, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ target: LANG_NAME[code] ?? code, entries: batch.map((ja) => ({ ja, en: EN.get(ja) })) }),
    });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) { console.log(`  batch ${i / 40 + 1}: 失敗 ${j.error ?? res.status}（このバッチは飛ばす）`); bad += batch.length; continue; }
    const pairs = [];
    batch.forEach((ja, idx) => {
      const v = String(j.t[idx] ?? '').trim();
      // プレースホルダが壊れた訳は採用しない（日本語フォールバックのほうがマシ）
      if (v && placeholders(v) === placeholders(ja)) pairs.push([ja, v]);
      else bad++;
    });
    appendDict(code, pairs);
    ok += pairs.length;
    process.stdout.write(`  ${Math.min(i + 40, missing.length)}/${missing.length}\r`);
  }
  console.log(`  追記 ${ok}件 / 不採用 ${bad}件`);
}
console.log('\n完了。native側で node scripts/i18n-keys.js とアプリの表示確認を。');
