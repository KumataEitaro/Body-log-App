// 広告枠が「課金で消える」経路の結合テスト:
//   RC entitlement → gate（applyEntitlement / refreshGate）→ useGate 購読者（AdSlot）→ unmount
// 購入直後・復元直後・アプリ再起動の3ケースを、実コードの gate.ts を通して確認する。
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import AdSlot from '@/components/AdSlot';
import AdBanner from '@/components/AdBanner';
import { applyEntitlement, refreshGate, peekGatePlan, __resetGateForTest } from '@/lib/gate';

// 課金有効ビルド（RCキーあり）を装う。currentPlan はテストごとに差し替える
const mockCurrentPlan = jest.fn<Promise<string>, []>(async () => 'free');
jest.mock('@/lib/purchases', () => {
  const actual = jest.requireActual('@/lib/purchases');
  return {
    ...actual,
    purchasesAvailable: () => true,
    currentPlan: () => mockCurrentPlan(),
  };
});

// BannerAd はマウント直後に「読み込み完了」を返す（実SDKの onAdLoaded 相当）
jest.mock('react-native-google-mobile-ads', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => ({ initialize: jest.fn(async () => []) }),
    BannerAd: ({ onAdLoaded }: { onAdLoaded: () => void }) => {
      React.useEffect(() => { onAdLoaded(); }, [onAdLoaded]);
      return null;
    },
    BannerAdSize: { ANCHORED_ADAPTIVE_BANNER: 'ANCHORED_ADAPTIVE_BANNER' },
    TestIds: { ADAPTIVE_BANNER: 'test-unit' },
  };
});

jest.useFakeTimers();

async function mount(el: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = renderer.create(el); });
  await act(async () => { jest.advanceTimersByTime(500); });
  return tree;
}
const slots = (tree: ReactTestRenderer, placement: string) =>
  tree.root.findAll((n) => n.props?.testID === `ad-slot-${placement}` && typeof n.type === 'string').length;

beforeEach(() => { __resetGateForTest(); mockCurrentPlan.mockReset(); mockCurrentPlan.mockResolvedValue('free'); });

describe('AdSlot × gate（課金で全枠がきれいに消える）', () => {
  it('無料ユーザー: 枠がマウントされる（4タブぶん同時に）', async () => {
    const tree = await mount(
      <>
        <AdBanner />
        <AdSlot placement="training" />
        <AdSlot placement="coach" compact />
        <AdSlot placement="changes" />
      </>,
    );
    expect(peekGatePlan()).toBeNull();
    for (const p of ['log', 'training', 'coach', 'changes']) expect(slots(tree, p)).toBe(1);
    tree.unmount();
  });

  it('購入直後: applyEntitlement(standard) で全枠が同時に消える（webhook 未着でも）', async () => {
    const tree = await mount(
      <>
        <AdBanner />
        <AdSlot placement="training" />
        <AdSlot placement="coach" compact />
        <AdSlot placement="changes" />
      </>,
    );
    expect(slots(tree, 'training')).toBe(1);
    await act(async () => { applyEntitlement('standard'); });
    expect(peekGatePlan()).toBe('standard');
    await act(async () => { jest.advanceTimersByTime(500); });
    // サーバー（モック）は plan=null のまま＝webhook 未着。強い方（端末の standard）を採るので戻らない
    expect(peekGatePlan()).toBe('standard');
    for (const p of ['log', 'training', 'coach', 'changes']) expect(slots(tree, p)).toBe(0);
    tree.unmount();
  });

  it('復元直後: 復元結果が free なら何も変わらない（枠は残る）', async () => {
    const tree = await mount(<AdSlot placement="log" />);
    await act(async () => { applyEntitlement('free'); });
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(peekGatePlan()).toBeNull();
    expect(slots(tree, 'log')).toBe(1);
    tree.unmount();
  });

  it('アプリ再起動: 初回取得で端末の entitlement（premium）が読まれ、枠は最初から出ない', async () => {
    mockCurrentPlan.mockResolvedValue('premium');
    const tree = await mount(<AdSlot placement="changes" />);
    expect(peekGatePlan()).toBe('premium');
    expect(slots(tree, 'changes')).toBe(0);
    tree.unmount();
  });

  it('refreshGate（クーポン適用など）でも同じ経路で消える', async () => {
    const tree = await mount(<AdSlot placement="coach" compact />);
    expect(slots(tree, 'coach')).toBe(1);
    mockCurrentPlan.mockResolvedValue('standard');
    await act(async () => { await refreshGate(); });
    expect(slots(tree, 'coach')).toBe(0);
    tree.unmount();
  });

});
