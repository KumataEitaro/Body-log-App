// プロフィール未設定の食事タブに「設定への導線」があることを固定する（QA 2026-09-10 P0-3 修正案4）。
//
// 事故の形: オンボーディングで「あとで設定」を押した人は profiles 行が無いまま食事タブへ着地する。
// ヒーロー（あと食べられる量）も週/月の収支カードも `&& profile` で消えるため、
// **画面に何も出ないのに理由も次の一手も示されない**状態だった。
// jest.setup の共通supabaseモックは profiles に null を返すので、ここは「行が無い人」の再現になっている。
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import LogScreen from '../app/(tabs)/log';
import { GuideProvider } from '../components/GuideTour';

jest.useFakeTimers();

/** ツリー内の全テキストを1本の文字列にする（表示文言の存在確認用） */
function allText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(allText).join(' ');
  const el = node as { children?: unknown };
  return allText(el.children);
}

describe('食事タブ: プロフィール未設定の空状態', () => {
  let tree!: ReactTestRenderer;
  beforeAll(async () => {
    await act(async () => { tree = renderer.create(<GuideProvider><LogScreen /></GuideProvider>); });
    await act(async () => { jest.advanceTimersByTime(2000); });
  });
  afterAll(async () => { await act(async () => { tree.unmount(); }); });

  it('「カロリー目標が出ない理由」と設定への導線が1つ以上ある', () => {
    const text = allText(tree.toJSON());
    expect(text).toContain('プロフィールを設定するとカロリー目標が出ます');
    expect(text).toContain('プロフィールを設定する');
  });
});
