// Jest の設定。**app.json と同じ変換でテストを走らせる**ことが、この設定の一番の仕事（2026-09-17）。
//
// 【なぜファイルに出したか】
// 以前は package.json の "jest" キーに書いていた。JSON なので条件分岐が書けず、
// babel の caller は jest-expo が渡す `{ name, bundler, platform }` のままだった。
// 一方 Metro（実機）は app.json の `experiments.reactCompiler` を見て
// `supportsReactCompiler: true` を渡す。つまり:
//
//   **テストは、実機に載るのとは別のプログラムを検証していた。**
//
// 実害（熊田さんのスクリーンショット 2026-09-17・ヘッダーが白い／カード内で色が混ざる）:
//   React Compiler は「引数なし・非リアクティブ」な呼び出しを**一度だけ評価して永久にキャッシュ**する。
//   `themeGeneration()` がまさにそれで、TabHeader と ThemeRemount の `key={theme-${gen}}` が
//   初回の値で固定 → **テーマの壁が一度も作り直されない**。スタイルの読み取り（`s.wrap`）も
//   周りの依存が変わらない限り初回（＝起動直後のライト）のまま凍る。
//   ところが tabHeader / themeRemount / themeRender の各テストは素の変換では**合格する**ので、
//   3回作った再発防止テストがすべて素通りしていた。
//
// これ以降、変換は app.json ただ1つを情報源にする。誰かが reactCompiler を true に戻せば、
// テストも同じ変換になり、テーマ系のテストが即座に落ちる＝気づかずに出荷できない。
// 逆に「戻したらどう壊れるか」を試したいときは BL_REACT_COMPILER=1 を付けて走らせる。
const preset = require('jest-expo/jest-preset.js');
const app = require('./app.json');

/** 実機（Metro）が React Compiler を使うか。app.json が唯一の情報源 */
const appUsesReactCompiler = app.expo?.experiments?.reactCompiler === true;
/** 検証用の強制上書き（BL_REACT_COMPILER=1 で「有効にしたらどうなるか」を試す） */
const forced = process.env.BL_REACT_COMPILER;
const supportsReactCompiler = forced != null ? forced === '1' : appUsesReactCompiler;

const JS_RE = '\\.[jt]sx?$';
const [transformer, options] = preset.transform[JS_RE];

module.exports = {
  preset: 'jest-expo',
  setupFiles: ['./jest.setup.js'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testPathIgnorePatterns: ['/node_modules/'],
  testTimeout: 60000,
  // 変換が2種類あるので、キャッシュも分ける（同じファイルの別バージョンを取り違えない）
  cacheDirectory: `<rootDir>/node_modules/.cache/jest-${supportsReactCompiler ? 'rc' : 'plain'}`,
  transform: {
    ...preset.transform,
    [JS_RE]: [transformer, { ...options, caller: { ...options.caller, supportsReactCompiler } }],
  },
  // テストから参照できるようにしておく（__tests__/themeTransform.test.ts が見張る）
  globals: { __BL_REACT_COMPILER__: supportsReactCompiler },
};
