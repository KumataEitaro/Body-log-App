// supabase/*.sql の括弧・引用符の過不足を、実行する前に機械で潰す（2026-09-16）。
//
// 事故の形: seed-demo.sql の305行目に閉じ括弧が1つ多かった。779行の SQL を目視では追えず、
// Supabase の SQL Editor に貼って Run して初めて `syntax error at or near ")"` で判明した。
// SQL は CI でも実行できないので、**構文の一部だけでも静的に見る**価値が大きい。
//
// ⚠️ 最初に書いた検査は `$$ … $$` の中身を丸ごと読み飛ばしていて、**何も検出できなかった**。
// PL/pgSQL の本体こそが中身なので、ドル引用の内側を必ず見ること。ここは下のテストで固定する。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkSql } = require('../scripts/check-sql-parens.js') as {
  checkSql: (src: string, file: string) => { line: number; msg: string }[];
};

const SUPABASE = join(__dirname, '..', 'supabase');

describe('supabase の SQL に括弧・引用符の過不足がない', () => {
  const files = readdirSync(SUPABASE).filter((f) => f.endsWith('.sql'));

  it('検査対象が1本以上ある（パスを間違えて全部素通りしていないこと）', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s', (f) => {
    const problems = checkSql(readFileSync(join(SUPABASE, f), 'utf8'), f);
    expect(problems.map((p) => `${f}:${p.line} ${p.msg}`)).toEqual([]);
  });
});

describe('検査そのものが機能している（役に立たない検査を置かない）', () => {
  it('閉じ括弧が多いのを見つける', () => {
    expect(checkSql('select (1));', 'x').length).toBeGreaterThan(0);
  });

  it('閉じ忘れを見つける', () => {
    expect(checkSql('select ((1);', 'x').length).toBeGreaterThan(0);
  });

  it('**ドル引用の内側も見る**（ここを飛ばすと PL/pgSQL 本体が無検査になる）', () => {
    expect(checkSql('do $$ begin insert into t values ((1)); end $$;', 'x')).toEqual([]);
    expect(checkSql('do $$ begin insert into t values ((1))); end $$;', 'x').length).toBeGreaterThan(0);
  });

  it('名前つきのドル引用（$body$）も扱える', () => {
    expect(checkSql('create function f() returns void as $body$ begin perform (1); end $body$ language plpgsql;', 'x')).toEqual([]);
  });

  it('文字列の中の括弧は数えない', () => {
    expect(checkSql("select '((((' as x;", 'x')).toEqual([]);
    expect(checkSql("select 'it''s ((' as x;", 'x')).toEqual([]);
  });

  it('コメントの中の括弧は数えない', () => {
    expect(checkSql('-- ((((\nselect 1;', 'x')).toEqual([]);
    expect(checkSql('/* (((( */ select 1;', 'x')).toEqual([]);
  });

  it('閉じていない文字列を見つける', () => {
    expect(checkSql("select 'abc;", 'x').length).toBeGreaterThan(0);
  });
});
