// 分析カード（2026-09-26・feat/analysis-cards）の smoke と要約行の固定。
// IntakeBarsCard / BodyPhotosCard は親（概要タブ）がマウントするまで screens.test の smoke に入らないので、
// ここで「データあり・空・読み込み失敗」の3通りがクラッシュせずに描けることを固定する。
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import IntakeBarsCard from '@/components/IntakeBarsCard';
import BodyPhotosCard from '@/components/BodyPhotosCard';
import BodyFatSheet from '@/components/BodyFatSheet';
import { BodyTable } from '@/components/DataTableCard';
import { todayJST } from '@/lib/calc';
import { addDaysIso } from '@/lib/intakeBars';

jest.useFakeTimers();

async function mount(el: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = renderer.create(el); });
  await act(async () => { jest.advanceTimersByTime(2000); });
  return tree;
}
const texts = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());

describe('IntakeBarsCard（摂取カロリーの棒グラフ）', () => {
  it('データありで描け、平均と凡例の日数が出る', async () => {
    const today = todayJST();
    const rows = Array.from({ length: 10 }, (_, i) => ({
      date: addDaysIso(today, -i), intake: i % 3 === 0 ? null : 1500 + i * 100, goal: 2000,
    }));
    const tree = await mount(<IntakeBarsCard rows={rows} />);
    expect(tree.root.findAll((n) => n.props?.testID === 'intake-bars-card').length).toBeGreaterThan(0);
    expect(tree.root.findAll((n) => n.props?.testID === 'intake-bars-avg').length).toBeGreaterThan(0);
    const s = texts(tree);
    expect(s).toContain('目標内');
    expect(s).toContain('超過');
    await act(async () => { tree.unmount(); });
  });

  it('記録が無い区間は空状態の文言（平均は出さない）', async () => {
    const tree = await mount(<IntakeBarsCard rows={[]} />);
    expect(texts(tree)).toContain('この期間には摂取の記録がありません');
    expect(tree.root.findAll((n) => n.props?.testID === 'intake-bars-avg')).toHaveLength(0);
    await act(async () => { tree.unmount(); });
  });
});

describe('BodyPhotosCard（体の写真）', () => {
  it('写真が無いときは＋からの入口を案内する（撮影ボタンは置かない）', async () => {
    const tree = await mount(<BodyPhotosCard />);
    const s = texts(tree);
    expect(s).toContain('体脂肪率（AIで推定）で写真つきで記録できます');
    expect(s).not.toContain('撮影する');
    await act(async () => { tree.unmount(); });
  });
});

describe('BodyFatSheet（写真も保存する）', () => {
  it('非公開の場所に保存される旨とスイッチがある。「写真は保存されません」は出さない', async () => {
    const tree = await mount(<BodyFatSheet visible onClose={() => {}} onSaved={() => {}} />);
    const s = texts(tree);
    expect(s).toContain('写真は自分だけが見られる非公開の場所に保存されます');
    expect(s).not.toContain('写真は保存されません');
    expect(tree.root.findAll((n) => n.props?.testID === 'bodyfat-save-photo-switch').length).toBeGreaterThan(0);
    await act(async () => { tree.unmount(); });
  });
});

describe('BodyTable（推移の詳細）の期間平均', () => {
  it('摂取kcal の表に「期間平均 …（n日・記録 m 日）」が出て、前回比の +XX も残る', async () => {
    const kcalRows = [
      { date: '2026-09-20', intake: 1600, burn: 2000 },
      { date: '2026-09-22', intake: 2000, burn: 2000 },
      { date: '2026-09-26', intake: 1800, burn: 2000 },
    ];
    const tree = await mount(<BodyTable visible onClose={() => {}} initialMetric="intake" kcalRows={kcalRows} />);
    expect(tree.root.findAll((n) => n.props?.testID === 'body-table-period-avg').length).toBeGreaterThan(0);
    const s = texts(tree);
    expect(s).toContain('期間平均');
    expect(s).toContain('1,800');                 // (1600+2000+1800)/3
    expect(s).toContain('（7日・記録 3 日）');     // 9/20〜9/26
    expect(s).toContain('+400');                  // 1600 → 2000 の前回比
    await act(async () => { tree.unmount(); });
  });
});
