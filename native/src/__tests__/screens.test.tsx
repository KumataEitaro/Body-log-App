// 全タブ画面のsmoke test: 「マウント時にクラッシュしない」ことを検証する
// （draggable-flatlist事故のような描画時クラッシュ＝リリースの白画面をビルド前に検出する）
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import LogScreen from '../app/(tabs)/log';
import TrainingScreen from '../app/(tabs)/training';
import ChangesScreen from '../app/(tabs)/changes';
import CoachScreen from '../app/(tabs)/coach';
import SettingsScreen from '../app/settings';
import PaywallScreen from '../app/paywall';
import AchievementsScreen from '../app/achievements';
import LawsScreen from '../app/laws';
import LoginScreen from '../app/login';
import InteractiveChart from '../components/InteractiveChart';
import GoalPanel from '../components/GoalPanel';
import { LiftKpiCard, LiftCalendarCard, LiftChartCard } from '../components/LiftingProgress';
import QuickLogFab from '../components/QuickLogFab';
import { GuideProvider } from '../components/GuideTour';
import BingeTriggerCard from '@/components/BingeTriggerCard';
import MenstrualCycleCard from '@/components/MenstrualCycleCard';

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
    ['ログイン画面', <LoginScreen key="login" />],
    ['プラン(ペイウォール)', <PaywallScreen key="paywall" />],
    ['実績', <AchievementsScreen key="ach" />],
    ['あなたの法則(図鑑)', <LawsScreen key="laws" />],
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
  it('GoalPanel(両モード)・筋トレ3カード・QuickLogFab がレンダリングできる', async () => {
    for (const el of [
      <GoalPanel key="w" mode="weight" />, <GoalPanel key="t" mode="training" />,
      <LiftKpiCard key="k" />, <LiftCalendarCard key="c" />, <LiftChartCard key="l" />,
      <QuickLogFab key="q" />,
    ]) {
      // データ空のときは仕様としてnullを返すカードがあるため、
      // ここでの検証は「例外なくマウント/レンダーできること」のみ
      const tree = await mount(el);
      expect(() => tree.toJSON()).not.toThrow();
      await act(async () => { tree.unmount(); });
    }
  });
  it('過食の引き金カードが例外なくマウントできる', () => {
    expect(() => renderer.create(<BingeTriggerCard />)).not.toThrow();
  });
  // 生理周期カード: cycle_logs未作成（モックsupabaseはdata:null）でも空状態で成立すること
  it('生理周期カードが記録ゼロでもレンダリングできる', async () => {
    const tree = await mount(<MenstrualCycleCard />);
    expect(tree.toJSON()).toBeTruthy();
    await act(async () => { tree.unmount(); });
  });
  // 帯（bands）を渡しても既存のグラフ描画が壊れないこと
  it('InteractiveChart が月経期間の帯つきでレンダリングできる', async () => {
    const points = Array.from({ length: 40 }, (_, i) => ({
      date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
      value: 60 + (i % 5) * 0.2,
    }));
    const tree = await mount(
      <InteractiveChart points={points} unit="kg" presetDays={30}
                        bands={[{ from: '2026-07-05', to: '2026-07-09' }, { from: '2026-07-28', to: '2026-08-01' }]} />
    );
    expect(tree.toJSON()).toBeTruthy();
    await act(async () => { tree.unmount(); });
  });
});
