// TabHeader（タブ画面のスティッキーヘッダー）がテーマ変更で必ず塗り直されることの見張り。
//
// 背景: ダークモードで「上の帯だけ白いまま残る」報告が3回続いた（設定での切替・OSの自動ダーク）。
// この帯は RN の sticky header（Animated.View）で包まれ、「親が再描画したから子も塗り直される」
// という前提が最も崩れやすい。そこで TabHeader は自分で useTheme() を購読し、内側の View を
// テーマ世代の key で作り直す。ここでは **親を一切再描画せずに** テーマだけ変え、
// 背景色が新しい C.bg に切り替わることを確認する（親依存が復活したら落ちる）。
import renderer, { act, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { View } from 'react-native';
import TabHeader from '../components/TabHeader';
import { C, themeGeneration } from '../lib/ui';
import { setTheme } from '../lib/theme';

function bgOf(inst: ReactTestInstance): string | undefined {
  const st = inst.props.style as unknown;
  const list = (Array.isArray(st) ? (st as unknown[]).flat(Infinity) : [st]).filter(Boolean) as Record<string, unknown>[];
  const flat = Object.assign({}, ...list) as { backgroundColor?: string };
  return flat.backgroundColor;
}

describe('TabHeader: テーマ変更で必ず塗り直される', () => {
  afterEach(async () => {
    // 他のテストへ影響させない（明暗を system に戻す）
    await act(async () => { await setTheme({ mode: 'system' }); });
  });

  it('親を再描画しなくても、ダークへ切り替えると背景が新しい C.bg になる（自前購読＋世代キー）', async () => {
    await act(async () => { await setTheme({ mode: 'light' }); });
    let tree!: ReactTestRenderer;
    await act(async () => { tree = renderer.create(<TabHeader title="運動" />); });

    const root = () => tree.root.findByProps({ testID: 'tab-header' });
    const before = bgOf(root());
    expect(before).toBe(C.bg);
    const genBefore = themeGeneration();

    // 親（このテスト）は tree.update を呼ばない＝TabHeader 自身の購読だけで切り替わる必要がある
    await act(async () => { await setTheme({ mode: 'dark' }); });

    expect(themeGeneration()).toBeGreaterThan(genBefore);
    const after = bgOf(root());
    expect(after).toBe(C.bg);
    expect(after).not.toBe(before);
  });

  it('世代が変わると内側の View の key が変わる（＝ネイティブビューを作り直す）', async () => {
    await act(async () => { await setTheme({ mode: 'light' }); });
    let tree!: ReactTestRenderer;
    await act(async () => { tree = renderer.create(<TabHeader title="食事" />); });
    const keyOf = () => {
      // TabHeader 直下の View の key を読む（react-test-renderer は _fiber.key で見える）
      const inst = tree.root.findByProps({ testID: 'tab-header' }) as unknown as { _fiber?: { key?: string | null } };
      return inst._fiber?.key ?? null;
    };
    const k1 = keyOf();
    expect(k1).toMatch(/^theme-\d+$/);
    await act(async () => { await setTheme({ mode: 'dark' }); });
    const k2 = keyOf();
    expect(k2).toMatch(/^theme-\d+$/);
    expect(k2).not.toBe(k1);
  });

  it('findAllByType(View) の先頭が外枠（他のテストの前提を固定）', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => { tree = renderer.create(<TabHeader title="概要" />); });
    const first = tree.root.findAllByType(View)[0];
    expect(first.props.testID).toBe('tab-header');
  });
});
