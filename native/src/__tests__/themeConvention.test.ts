/// <reference types="node" />
// ソースを読んで規約違反を探すテストなのでNodeのfs/pathを使う。
// tsconfigの types は ["jest"] に絞ってあるため、このファイルだけ node の型を足す。
//
// スタイル定義の書き方の規約を機械的に守らせるテスト（再発防止）。
//
// テーマのまだらバグは「1ファイルでも古い書き方が混ざると、その部分だけ色が変わらない」
// という形で再発する。目視レビューでは必ず取りこぼすので、ここで落とす。
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__') sourceFiles(p, out); }
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const FILES = sourceFiles(SRC);
const rel = (p: string) => p.slice(SRC.length + 1).replace(/\\/g, '/');

describe('スタイル定義の規約', () => {
  it('StyleSheet.create を直接呼ぶファイルは lib/ui.ts だけ（他は themed を使う）', () => {
    // StyleSheet.create はモジュール評価時に1度しか走らないため、そこに色を書くと
    // その色はテーマ変更後も作られた時点のまま固定される
    const offenders = FILES.filter((f) => rel(f) !== 'lib/ui.ts')
      .filter((f) => /StyleSheet\.create\s*\(/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('themed の中身は必ず関数（() => ({ ... }) の形）で渡している', () => {
    // themed(obj) と書いてしまうと評価が1度きりになり、旧方式と同じ穴が開く
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bthemed\s*\(\s*(.)/g)) {
        if (m[1] !== '(') offenders.push(`${rel(f)}: themed(${m[1]}...`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ヘアラインと影は生のリテラルではなくトークンで書く', () => {
    // 'rgba(14,17,22,0.08)' / '#0e1116' はライトのink由来の固定値で、
    // ダークでは面と同化して縁取りが消える。C.hairline / C.shadow を使う
    const offenders: string[] = [];
    for (const f of FILES) {
      if (rel(f) === 'lib/theme.ts' || rel(f) === 'lib/ui.ts') continue; // パレット定義そのものは除く
      const src = readFileSync(f, 'utf8');
      if (/rgba\(14,17,22,0\.08\)/.test(src)) offenders.push(`${rel(f)}: rgba(14,17,22,0.08) → C.hairline`);
      if (/shadowColor:\s*'#0e1116'/.test(src)) offenders.push(`${rel(f)}: shadowColor '#0e1116' → C.shadow`);
    }
    expect(offenders).toEqual([]);
  });

  it('パレットのトークンを一覧に載せ忘れていない（Palette型と実体の一致）', () => {
    // 新しいトークンを型にだけ足して既定パレットに足し忘れると、
    // そのトークンだけ undefined になり「一部だけ色がつかない」形で再発する
    const ui = readFileSync(join(SRC, 'lib/ui.ts'), 'utf8');
    const typeBody = /export type Palette = \{([\s\S]*?)\n\};/.exec(ui);
    const constBody = /export const C: Palette = \{([\s\S]*?)\n\};/.exec(ui);
    expect(typeBody).not.toBeNull();
    expect(constBody).not.toBeNull();
    const typeKeys = [...typeBody![1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();
    const constKeys = [...constBody![1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();
    expect(constKeys).toEqual(typeKeys);
  });
});
