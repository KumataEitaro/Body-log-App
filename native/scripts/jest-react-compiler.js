// 「React Compiler を有効にしたら、いまのコードはどう壊れるか」を確かめるための実行口。
//   npm run test:rc
//
// 普段のテスト（npm test）は app.json の experiments.reactCompiler をそのまま写す（jest.config.js）。
// このスクリプトはそれを **強制的に有効**にして走らせる。将来コンパイラを入れ直したくなったら、
// まずこれを緑にすること。落ちる場所が「テーマがコンパイラの前提を破っている箇所」そのもの。
//
// 背景: 2026-09-17 の「ヘッダーだけ白い／カード内で色が混ざる」は、
// コンパイラが themeGeneration() を一度きりの定数に畳んだことが原因だった（docs/THEME.md）。
process.env.BL_REACT_COMPILER = '1';
const { run } = require('jest');
run(['--silent', ...process.argv.slice(2)]);
