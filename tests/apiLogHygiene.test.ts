// API ルートのログに秘密や個人情報を書かない（QA C-2 の再発防止・2026-09-21）。
//
// クーポンコードは「持参人式のクレデンシャル」、メールアドレスは個人情報、token/secret は言うまでもない。
// ログ閲覧権限があれば読めてしまうので、console.* の引数に**その値そのもの**が現れたら落とす。
// `code.slice(0, 2)` / `code.length` のように値を伏せた派生は許す（redeem-coupon の書き方）。
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

const API_DIR = join(__dirname, '..', 'app', 'api');
const SENSITIVE = /\b(code|email|token|secret|password|authorization|api_?key)\b(?!\s*\.\s*(length|slice)\b)/i;

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** `console.xxx(` から対応する `)` までを切り出す（改行をまたいでも良い） */
function consoleCalls(src: string): string[] {
  const out: string[] = [];
  const re = /console\.(log|info|warn|error|debug)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    let q: string | null = null;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (q) {
        if (ch === '\\') i++;
        else if (ch === q) q = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') q = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

/** 文字列リテラルの中身は捨て、`${ ... }` の式と生の引数だけを残す（メッセージ文中の "email" 等の語は数えない） */
function codeOnly(args: string): string {
  let out = '';
  let i = 0;
  while (i < args.length) {
    const ch = args[i];
    if (ch === "'" || ch === '"') {
      i++;
      while (i < args.length && args[i] !== ch) {
        if (args[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '`') {
      i++;
      while (i < args.length && args[i] !== '`') {
        if (args[i] === '\\') { i += 2; continue; }
        if (args[i] === '$' && args[i + 1] === '{') {
          let d = 1;
          i += 2;
          const s = i;
          while (i < args.length && d > 0) {
            if (args[i] === '{') d++;
            else if (args[i] === '}') d--;
            i++;
          }
          out += ' ' + args.slice(s, i - 1) + ' ';
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

describe('API ルートのログ衛生（QA C-2）', () => {
  it('console.* の引数に code / email / token / secret / password の値をそのまま渡していない', () => {
    const offenders: string[] = [];
    const root = join(__dirname, '..');
    for (const f of routeFiles(API_DIR)) {
      const src = readFileSync(f, 'utf8');
      for (const call of consoleCalls(src)) {
        if (SENSITIVE.test(codeOnly(call))) {
          offenders.push(`${relative(root, f).replace(/\\/g, '/')}: console(${call.trim().slice(0, 90)})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('伏せた派生（slice / length）は許し、値そのものは落とす（検査自体のテスト）', () => {
    const ok = codeOnly('`[x] code=${code.slice(0, 2)}…(${code.length}) uid=${user.id}`');
    const ng1 = codeOnly('`[x] code=${code}`');
    const ng2 = codeOnly('"[x] failed", user.email');
    const ng3 = codeOnly('`[x] ${body.token} plan=${coupon.plan}`');
    const msgOnly = codeOnly("'[x] email が未入力です'");
    expect(SENSITIVE.test(ok)).toBe(false);
    expect(SENSITIVE.test(ng1)).toBe(true);
    expect(SENSITIVE.test(ng2)).toBe(true);
    expect(SENSITIVE.test(ng3)).toBe(true);
    expect(SENSITIVE.test(msgOnly)).toBe(false);
  });

  it('console の呼び出しを改行・入れ子の括弧ごしに切り出せる（検査自体のテスト）', () => {
    const src = "console.log(\n  `[a] uid=${user.id} n=${items.filter((x) => x.ok).length}`,\n);\nconsole.error('[b]', e instanceof Error ? e.message : String(e));";
    const calls = consoleCalls(src);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('items.filter((x) => x.ok).length');
    expect(SENSITIVE.test(codeOnly(calls[0]))).toBe(false);
    expect(SENSITIVE.test(codeOnly(calls[1]))).toBe(false);
  });
});
