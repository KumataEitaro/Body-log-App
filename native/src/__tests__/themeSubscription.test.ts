// テーマ追従の見張り（2026-09-04）。
//
// テーマは「ルートの Stack を再マウント」ではなく「各画面が世代を購読して再描画」で追従する。
// 再マウント方式は、開いている Modal（設定のテーマシート）まで破棄→即再表示になり、
// iOS で古いモーダルが残って「プレビューだけ色が古い」事故を起こした。
// このテストは (1) 全ルートが購読していること (2) Stack key に世代が戻っていないこと を機械的に保証する。
import fs from 'fs';
import path from 'path';

const APP = path.resolve(__dirname, '..', 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('themeSubscription: 全ルートがテーマを購読している', () => {
  it('export default function を持つ画面は useTheme() か useThemeRefresh() を呼ぶ', () => {
    const missing: string[] = [];
    for (const f of walk(APP)) {
      const src = fs.readFileSync(f, 'utf8');
      if (!/^export default function /m.test(src)) continue;
      if (!/\buseTheme\(\)|\buseThemeRefresh\(\)/.test(src)) missing.push(path.relative(APP, f));
    }
    expect(missing).toEqual([]);
  });

  it('_layout の Stack key にテーマ世代を含めない（再マウント方式へ戻さない）', () => {
    const src = fs.readFileSync(path.join(APP, '_layout.tsx'), 'utf8');
    const keyLine = src.split(/\r?\n/).find((l) => /<Stack key=/.test(l));
    expect(keyLine).toBeDefined();
    expect(keyLine).not.toMatch(/themeGeneration/);
    expect(keyLine).not.toMatch(/pfc/);
  });

  it('settings.tsx に再マウント前提の reopenSheet が残っていない', () => {
    const src = fs.readFileSync(path.join(APP, 'settings.tsx'), 'utf8');
    expect(src).not.toMatch(/reopenSheet/);
  });
});
