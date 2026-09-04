// テーマ追従の「取りこぼしクラス」を機械的に見張る（2026-09-04・ダーク上部白帯の再発防止）。
//
// themed() は「再描画されたコンポーネント」には必ず新しい色を渡せるが、
// **再描画されない要素**には届かない。再描画されない典型:
//   1) React.memo で包んだコンポーネント（props が同じなら描き直さない）
//   2) FlatList / SectionList の行（extraData が変わらないと描き直さない）
//   3) 親の再描画に頼っている sticky header（Animated.View に包まれる）
// ここではその3つが、コードレビュー無しで復活しないことを保証する。
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(SRC);
const read = (f: string) => fs.readFileSync(f, 'utf8');
const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, '/');

describe('themeSafety: 再描画されない要素にテーマが届く', () => {
  it('memo() で包んだコンポーネントを持つファイルは、テーマを購読している（useThemeRefresh / useTheme）', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = read(f);
      if (!/\bmemo\(\s*function|React\.memo\(/.test(src)) continue;
      if (!/useThemeRefresh\(\)|useTheme\(\)/.test(src)) offenders.push(rel(f));
    }
    expect(offenders).toEqual([]);
  });

  it('仮想リスト（FlatList / SectionList / FlashList）は extraData にテーマ世代を渡す', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = read(f).split(/\r?\n/);
      lines.forEach((l, i) => {
        if (!/<(Animated\.)?(FlatList|SectionList|FlashList)\b/.test(l)) return;
        const window = lines.slice(i, i + 30).join('\n');
        if (!/extraData=/.test(window)) offenders.push(`${rel(f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('TabHeader は自分でテーマを購読し、世代の key でネイティブビューを作り直す', () => {
    const src = read(path.join(SRC, 'components', 'TabHeader.tsx'));
    expect(src).toMatch(/useTheme\(\)/);
    expect(src).toMatch(/key=\{`theme-\$\{gen\}`\}/);
    expect(src).toMatch(/themeGeneration\(\)/);
  });

  it('theme.ts は AppState 復帰時に OS の明暗と再同期する（背景中の自動ダークを取りこぼさない）', () => {
    const src = read(path.join(SRC, 'lib', 'theme.ts'));
    expect(src).toMatch(/AppState\.addEventListener\('change'/);
    expect(src).toMatch(/export function resyncSchemeFromOS/);
  });

  it('タブ画面（TabHeader を使う画面）は useThemeRefresh を呼ぶ（二重の保険）', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = read(f);
      if (!src.includes('<TabHeader')) continue;
      if (!/useThemeRefresh\(\)|useTheme\(\)/.test(src)) offenders.push(rel(f));
    }
    expect(offenders).toEqual([]);
  });
});
