// 「テストが、実機に載るのと同じプログラムを検証している」ことの見張り（2026-09-17）。
//
// 【何が起きたか】
// app.json の `experiments.reactCompiler: true` により、実機（Metro）は React Compiler で
// 変換されたコードを動かしていた。一方 jest-expo が babel へ渡す caller には
// `supportsReactCompiler` が無く、**テストだけコンパイラ無しで走っていた**。
//
// React Compiler は「引数なし・リアクティブな依存なし」の呼び出しを**一度きりの定数**に畳む。
// `themeGeneration()` がまさにそれで、TabHeader と ThemeRemount の `key={theme-${gen}}` が
// 初回の値で固定 → テーマの壁が一度も作り直されず、起動直後（ライト）の色が凍りついた。
// 熊田さんのスクリーンショット（ヘッダーだけ白い／カード内で色が混ざる）はこれ。
//
// 再発防止の要は「手口を塞ぐ」ことではなく **「変換をひとつにする」** こと。
// jest.config.js が app.json を読んで caller を決めるので、どちらへ倒しても食い違わない。
// このテストはその配線が外れていないかを見る。
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

declare const __BL_REACT_COMPILER__: boolean | undefined;

describe('テストの変換は app.json と一致している', () => {
  it('jest.config.js が app.json の experiments.reactCompiler を caller に写している', () => {
    const src = read('jest.config.js');
    expect(src).toContain("require('./app.json')");
    expect(src).toContain('supportsReactCompiler');
    // 設定ファイルを読み込んで、実際の値まで確かめる（コメントだけ残って配線が外れる事故を防ぐ）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require(path.join(ROOT, 'jest.config.js')) as { transform: Record<string, [string, { caller: { supportsReactCompiler?: boolean } }]> };
    const entry = Object.entries(cfg.transform).find(([re]) => re.includes('jt'));
    expect(entry).toBeTruthy();
    const app = JSON.parse(read('app.json')) as { expo: { experiments?: { reactCompiler?: boolean } } };
    // npm run test:rc（BL_REACT_COMPILER）は「戻したらどう壊れるか」を試すための明示的な上書き
    const expected = process.env.BL_REACT_COMPILER != null
      ? process.env.BL_REACT_COMPILER === '1'
      : app.expo.experiments?.reactCompiler === true;
    expect(entry![1][1].caller.supportsReactCompiler).toBe(expected);
  });

  it('いま走っている変換が app.json と一致している（グローバル経由の実測）', () => {
    const app = JSON.parse(read('app.json')) as { expo: { experiments?: { reactCompiler?: boolean } } };
    const expected = process.env.BL_REACT_COMPILER != null
      ? process.env.BL_REACT_COMPILER === '1'                 // npm run test:rc の強制上書き
      : app.expo.experiments?.reactCompiler === true;
    expect(typeof __BL_REACT_COMPILER__).toBe('boolean');
    expect(__BL_REACT_COMPILER__).toBe(expected);
  });

  // React Compiler を入れ直したくなったときの「通行条件」をここに書いておく。
  // 条件を満たさないまま true にすると、この下の themePalette / tabHeader / themeRemount /
  // themeRender が落ちる（＝気づかずに出荷できない）。
  it('React Compiler を有効に戻すなら、テーマがフック経由になっていること', () => {
    const app = JSON.parse(read('app.json')) as { expo: { experiments?: { reactCompiler?: boolean } } };
    if (app.expo.experiments?.reactCompiler !== true) return;   // いまは無効＝この条件は問われない

    // 有効にするなら、モジュールスコープの `const s = themed(...)` を直接読む書き方は使えない。
    // 色はフックの戻り値から来ていなければ、コンパイラがキャッシュに閉じ込める（docs/THEME.md）。
    const src = path.join(ROOT, 'src');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p, out); }
        else if (/\.tsx$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const offenders = walk(src)
      .filter((f) => /\bthemed\s*\(/.test(fs.readFileSync(f, 'utf8')))
      .filter((f) => !/useThemedSheet\(/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});

describe('コンパイラの罠そのものを覚えておく', () => {
  // 2026-09-17 に実際に踏んだ: `useMemo(() => ({...sheet}), [sheet, gen])` と書いたら、
  // React Compiler が「中で使っていない gen」を依存から**削除**し、世代が変わっても
  // 展開し直さなくなった。gen は引数として本当に使うこと。
  it('useThemedSheet は gen を「本当に使う」形で渡している（人工的な依存は削られる）', () => {
    const src = read('src/lib/ui.ts');
    expect(src).toMatch(/spreadForGeneration\(sheet, gen\)/);
    expect(src).not.toMatch(/useMemo\(\(\) => \(\{ \.\.\.sheet \}\), \[sheet, gen\]\)/);
  });
});
