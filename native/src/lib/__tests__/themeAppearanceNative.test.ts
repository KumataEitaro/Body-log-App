// Android 起動クラッシュ（2026-09-07・GitHub Actions android-smoke #13 の logcat で確定）の再発防止。
//
//   FATAL EXCEPTION: mqt_v_native
//   java.lang.NullPointerException: Parameter specified as non-null is null:
//     method com.facebook.react.modules.appearance.AppearanceModule.setColorScheme, parameter style
//
// theme.ts が mode=system（全員の初期値）のときに RNAppearance.setColorScheme(null) を呼んでいた。
// Android の実装は Kotlin の非 null String 引数なので、null を受けた瞬間に別スレッドで落ちる。
// JS の try/catch では捕まらない（呼び出しは非同期にネイティブ側へ渡る）。iOS は null を黙って受けるので
// iOS だけ動いていた。OS 追従は RN の正規の値 'unspecified' で表す。
//
// ここでは (1) 実際に渡る値を spy で見る、(2) ソースに null を渡す書き方が復活していないことを見る。
import fs from 'fs';
import path from 'path';
import { Appearance } from 'react-native';
import { setTheme } from '../theme';

const VALID = new Set(['light', 'dark', 'unspecified']);

describe('theme: RNAppearance.setColorScheme に渡す値（Android は null で即死する）', () => {
  afterEach(async () => {
    jest.restoreAllMocks();
    await setTheme({ mode: 'system' });
  });

  it('mode=system → "unspecified"、mode=dark → "dark"、mode=light → "light"。null / undefined は一度も渡らない', async () => {
    const spy = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    await setTheme({ mode: 'dark' });
    await setTheme({ mode: 'system' });
    await setTheme({ mode: 'light' });
    await setTheme({ mode: 'system' });

    const passed = spy.mock.calls.map((c) => c[0]);
    expect(passed.length).toBeGreaterThan(0);
    for (const v of passed) {
      expect(v).not.toBeNull();
      expect(v).not.toBeUndefined();
      expect(VALID.has(v as string)).toBe(true);
    }
    expect(passed).toContain('dark');
    expect(passed).toContain('light');
    expect(passed).toContain('unspecified');
  });

  it('ソースに「setColorScheme(null)」や「? null : prefs.mode」の書き方が復活していない', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'theme.ts'), 'utf8');
    // OS 追従を null で表す書き方（旧コード）を禁止
    expect(src).not.toMatch(/prefs\.mode === 'system' \? null/);
    // 型を騙して null を通すキャストを禁止
    expect(src).not.toMatch(/setColorScheme\([^)]*as unknown as/);
    // 正規の値で OS 追従に戻していること
    expect(src).toMatch(/prefs\.mode === 'system' \? 'unspecified' : prefs\.mode/);
  });
});
