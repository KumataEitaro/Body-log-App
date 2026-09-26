// 戻るボタンの文言は**どこから来ても「戻る」**（2026-09-26 熊田さん）。静的な見張りは navConsistency.test.ts。
// こちらは実行時の角度: 実際に関数を呼んで、どんな from を渡しても「戻る」しか返らないことを確かめる
import { fromLabel, stackHeaderOptions, useStackHeader, navFrom, type NavFrom } from '../lib/navHeader';

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ from: 'changes' }) }));

describe('lib/navHeader: 戻るラベルは常に「戻る」', () => {
  const froms: (NavFrom | string | undefined)[] = [
    'log', 'training', 'coach', 'changes', 'settings', 'achievements', 'laws', 'nutrient', 'weekly',
    undefined, '', 'unknown', '概要',
  ];
  it.each(froms.map((x) => [x]))('fromLabel(%p) → 戻る', (from) => {
    expect(fromLabel(from as string | undefined)).toBe('戻る');
  });

  it('stackHeaderOptions は headerBackTitle=「戻る」・display mode は default（minimal ではない）', () => {
    const o = stackHeaderOptions() as Record<string, unknown>;
    expect(o.headerBackTitle).toBe('戻る');
    expect(o.headerBackButtonDisplayMode).toBe('default');
    expect(o.title).toBe('');
    expect(o.headerShown).toBe(true);
  });

  it('useStackHeader は ?from= が渡っていても「戻る」（from は文言に影響しない）', () => {
    const o = useStackHeader() as Record<string, unknown>;
    expect(o.headerBackTitle).toBe('戻る');
  });

  it('navFrom は from と ts ノンスを載せる（戻り先の判定・同じ画面の再オープン用。表示には使わない）', () => {
    const p = navFrom('changes', { open: 'goal' }) as Record<string, string | undefined>;
    expect(p.from).toBe('changes');
    expect(p.open).toBe('goal');
    expect(typeof p.ts).toBe('string');
    expect(navFrom(undefined).from).toBeUndefined();
  });
});
