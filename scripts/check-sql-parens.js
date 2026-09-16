// SQL の括弧・引用符の釣り合いを検査する（2026-09-16）。
//
// なぜ要るか: seed-demo.sql の305行目に閉じ括弧が1つ多く、Supabase の SQL Editor に貼って
// はじめて `syntax error at or near ")"` で判明した。779行の SQL を目視で追うのは無理で、
// 実行して初めて分かるのでは遅い。この種の誤りは機械で先に潰す。
//
// ⚠️ 最初に書いた検査は `$$ … $$` の中身を丸ごと読み飛ばしていて、**何も見つけられなかった**。
// PL/pgSQL の本体こそが中身なので、**ドル引用の内側も必ず検査する**。ここが肝。
//
// 使い方:
//   node scripts/check-sql-parens.js                 # supabase/*.sql を全部
//   node scripts/check-sql-parens.js path/to.sql     # 1本だけ
//
// これは完全な PostgreSQL パーサではない。捕まえるのは
// 「括弧の過不足」「閉じていない文字列」だけ。それでも実行前に潰せる価値は大きい。
const fs = require('fs');
const path = require('path');

/** ドル引用のタグ（$$ や $body$）を読み飛ばさずに、括弧の深さだけを追う */
function checkSql(src, file) {
  const problems = [];
  const lines = src.split(/\r?\n/);
  let depth = 0;
  let line = 1;
  let openedAt = [];            // 括弧を開いた行の履歴（過不足の報告に使う）
  let inStr = false, strLine = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;         // '$$' や '$body$'。中身も検査するので深さは持ち越す

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];

    if (c === '\n') { line++; inLineComment = false; continue; }
    if (inLineComment) continue;

    if (inBlockComment) { if (c === '*' && n === '/') { inBlockComment = false; i++; } continue; }

    if (inStr) {
      if (c === "'") { if (n === "'") i++; else inStr = false; }   // '' はエスケープ
      continue;
    }

    // ドル引用のタグを見つけたら、開始/終了を切り替えるだけ。**中身は読み飛ばさない**
    if (c === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(src.slice(i));
      if (m) {
        const tag = m[0];
        if (dollarTag === null) dollarTag = tag;
        else if (dollarTag === tag) dollarTag = null;
        i += tag.length - 1;
        continue;
      }
    }

    if (c === '-' && n === '-') { inLineComment = true; i++; continue; }
    if (c === '/' && n === '*') { inBlockComment = true; i++; continue; }
    if (c === "'") { inStr = true; strLine = line; continue; }

    if (c === '(') { depth++; openedAt.push(line); continue; }
    if (c === ')') {
      depth--;
      openedAt.pop();
      if (depth < 0) {
        problems.push({ line, msg: '閉じ括弧が多い', hint: (lines[line - 1] || '').trim().slice(0, 100) });
        depth = 0; openedAt = [];   // 以降も検査を続けるためリセット
      }
      continue;
    }

    // ドル引用の外で ; が来たら文の区切り。そこで括弧が残っていたら閉じ忘れ
    if (c === ';' && dollarTag === null && depth !== 0) {
      problems.push({
        line, msg: `文の終わりで括弧が ${depth} 個閉じていない`,
        hint: `最初に開いたのは ${openedAt[0]} 行目`,
      });
      depth = 0; openedAt = [];
    }
  }

  if (dollarTag !== null) problems.push({ line, msg: `ドル引用 ${dollarTag} が閉じていない`, hint: '' });
  if (inStr) problems.push({ line: strLine, msg: '文字列リテラルが閉じていない', hint: '' });
  if (depth !== 0) problems.push({ line, msg: `ファイル末尾で括弧が ${depth} 個閉じていない`, hint: `最初に開いたのは ${openedAt[0]} 行目` });

  return problems.map((p) => ({ ...p, file }));
}

/** supabase/ の全 SQL（または引数のファイル）を検査して、問題の件数を返す */
function checkAll(args = []) {
  const root = path.resolve(__dirname, '..');
  const files = args.length
    ? args
    : fs.readdirSync(path.join(root, 'supabase'))
        .filter((f) => f.endsWith('.sql'))
        .map((f) => path.join('supabase', f));

  let bad = 0;
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    const problems = checkSql(fs.readFileSync(abs, 'utf8'), f);
    if (problems.length === 0) continue;
    bad += problems.length;
    for (const p of problems) {
      console.log(`❌ ${p.file}:${p.line}  ${p.msg}${p.hint ? `  — ${p.hint}` : ''}`);
    }
  }
  if (bad === 0) console.log(`✅ ${files.length} 本の SQL に括弧・引用符の過不足なし`);
  return bad;
}

// require されたときは何も実行しない（テストから checkSql を使うため）
if (require.main === module) process.exit(checkAll(process.argv.slice(2)) === 0 ? 0 : 1);

module.exports = { checkSql, checkAll };
