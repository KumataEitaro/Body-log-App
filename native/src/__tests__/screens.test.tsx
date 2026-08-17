// 全タブ画面のsmoke test: 「マウント時にクラッシュしない」ことを検証する
// （draggable-flatlist事故のような描画時クラッシュ＝リリースの白画面をビルド前に検出する）
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import LogScreen from '../app/(tabs)/log';
import TrainingScreen from '../app/(tabs)/training';
import ChangesScreen from '../app/(tabs)/changes';
import CoachScreen from '../app/(tabs)/coach';
import SettingsScreen from '../app/(tabs)/settings';
import InteractiveChart from '../components/InteractiveChart';
import GoalPanel from '../components/GoalPanel';
import LiftingProgress from '../components/LiftingProgress';
import QuickLogFab from '../components/QuickLogFab';
import { GuideProvider } from '../components/GuideTour';

jest.useFakeTimers();

async function mount(el: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = renderer.create(el); });
  // マウント直後の非同期load（モックsupabase）とタイマーを消化
  await act(async () => { jest.advanceTimersByTime(2000); });
  return tree;
}

describe('screens smoke（マウント時クラッシュ検出）', () => {
  const cases: [string, React.ReactElement][] = [
    ['食事タブ', <LogScreen key="log" />],
    ['トレタブ', <TrainingScreen key="tr" />],
    ['概要タブ', <ChangesScreen key="ch" />],
    ['相談タブ', <CoachScreen key="co" />],
    ['マイページ(設定)', <SettingsScreen key="se" />],
  ];
  for (const [name, el] of cases) {
    it(`${name} がレンダリングできる`, async () => {
      const tree = await mount(<GuideProvider>{el}</GuideProvider>);
      expect(tree.toJSON()).toBeTruthy();
      await act(async () => { tree.unmount(); });
    });
  }
});

describe('components smoke', () => {
  it('InteractiveChart がデータ付きでレンダリングできる', async () => {
    const points = Array.from({ length: 60 }, (_, i) => ({
      date: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`,
      value: 80 + Math.sin(i / 5) * 3,
    }));
    const tree = await mount(<InteractiveChart points={points} unit="kg" planValue={78} presetDays={30} />);
    expect(tree.toJSON()).toBeTruthy();
    await act(async () => { tree.unmount(); });
  });
  it('InteractiveChart が空データでもレンダリングできる', async () => {
    const tree = await mount(<InteractiveChart points={[]} />);
    expect(tree.toJSON()).toBeTruthy();
    await act(async () => { tree.unmount(); });
  });
  it('GoalPanel(両モード)・LiftingProgress・QuickLogFab がレンダリングできる', async () => {
    for (const el of [<GoalPanel key="w" mode="weight" />, <GoalPanel key="t" mode="training" />, <LiftingProgress key="l" />, <QuickLogFab key="q" />]) {
      const tree = await mount(el);
      expect(tree.toJSON()).toBeTruthy();
      await act(async () => { tree.unmount(); });
    }
  });
});
