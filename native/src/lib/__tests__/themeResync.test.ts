// OS の外観（自動ダークモード）がアプリの背景中に切り替わったケースの再同期。
//
// 背景: 19:12 のスクリーンショットで「上の帯だけ白い」。iOS の自動ダークは日没で切り替わり、
// アプリが背景にいる間は JS の Appearance リスナーが走らない／順序が崩れることがある。
// theme.ts は AppState が active に戻った瞬間に「いま効いている明暗」と「OS の明暗」を比べ、
// ずれていれば applyCurrent()+emit() する（resyncSchemeFromOS）。ここではその判定を直接叩く。
import { Appearance } from 'react-native';
import { resyncSchemeFromOS, setTheme, currentScheme } from '../theme';
import { C, themeGeneration } from '../ui';

describe('theme: AppState 復帰時の OS 明暗との再同期', () => {
  afterEach(async () => {
    jest.restoreAllMocks();
    await setTheme({ mode: 'system' });
  });

  it('mode=system で OS がダークに変わっていたら、再同期でパレットの世代が進み C.bg が変わる', async () => {
    await setTheme({ mode: 'system' });
    const spy = jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light');
    // まず light に揃える（appliedScheme を確定させる）
    resyncSchemeFromOS();
    const g0 = themeGeneration();
    const bg0 = C.bg;

    spy.mockReturnValue('dark');
    expect(currentScheme()).toBe('dark');
    expect(resyncSchemeFromOS()).toBe(true);
    expect(themeGeneration()).toBe(g0 + 1);
    expect(C.bg).not.toBe(bg0);

    // 差分が無ければ何もしない（無駄な再描画を起こさない）
    expect(resyncSchemeFromOS()).toBe(false);
    expect(themeGeneration()).toBe(g0 + 1);

    // 戻ったら戻る
    spy.mockReturnValue('light');
    expect(resyncSchemeFromOS()).toBe(true);
    expect(C.bg).toBe(bg0);
  });

  it('mode が light/dark に固定されているときは OS の変化を無視する', async () => {
    await setTheme({ mode: 'light' });
    const spy = jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    const g0 = themeGeneration();
    expect(resyncSchemeFromOS()).toBe(false);
    expect(themeGeneration()).toBe(g0);
    spy.mockRestore();
  });
});
