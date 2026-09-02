// テーマ切替が「実際に描画された要素の色」まで届くことの検証。
//
// 単体テスト（theme.test.ts）はスタイル定義の値が変わることを見ているが、
// まだらバグの本質は「値は変わっているのに画面に届かない」だった。
// ここでは react-test-renderer で本物のツリーを作り、描画結果の style を見る。
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { View, Text } from 'react-native';
import { C, applyPalette, themed, rgba } from '@/lib/ui';
import { PALETTES, paletteFor, darkPaletteFor } from '@/lib/theme';

// 実アプリと同じ書き方（モジュールスコープで themed を1度だけ呼ぶ）
const s = themed(() => ({
  card: { backgroundColor: C.panel, borderColor: C.hairline },
  title: { color: C.ink },
  glow: { borderColor: rgba(C.teal, 0.3) },
}));

function Card() {
  return (
    <View testID="card" style={s.card}>
      <Text testID="title" style={s.title}>text</Text>
      <View testID="glow" style={s.glow} />
    </View>
  );
}

/** 描画されたツリーから testID の style を1つのオブジェクトへ潰して取り出す */
function styleOf(tree: ReactTestRenderer, id: string): Record<string, unknown> {
  const props = tree.root.findByProps({ testID: id }).props as { style: unknown };
  const flat = Array.isArray(props.style) ? Object.assign({}, ...props.style) : props.style;
  return flat as Record<string, unknown>;
}

function mount(el: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => { tree = renderer.create(el); });
  return tree;
}

describe('テーマ切替が描画へ届く', () => {
  beforeEach(() => { applyPalette(PALETTES.green); });

  it('マウント済みのツリーを描き直すと新しいテーマの色になる', () => {
    const tree = mount(<Card />);
    expect(styleOf(tree, 'card').backgroundColor).toBe(PALETTES.green.panel);

    applyPalette(darkPaletteFor('green'));
    act(() => { tree.update(<Card />); });

    const dark = darkPaletteFor('green');
    expect(styleOf(tree, 'card').backgroundColor).toBe(dark.panel);
    expect(styleOf(tree, 'card').borderColor).toBe(dark.hairline);
    expect(styleOf(tree, 'title').color).toBe(dark.ink);
    expect(styleOf(tree, 'glow').borderColor).toBe(rgba(dark.teal, 0.3)); // 加工色も追従
    act(() => { tree.unmount(); });
  });

  it('テーマを変えたあとに初めてマウントした画面も正しい色で出る（まだらの主犯）', () => {
    applyPalette(paletteFor('indigo', 'strong'));
    const tree = mount(<Card />);          // 切替のあとで初めて描画される画面のつもり
    const pal = paletteFor('indigo', 'strong');
    expect(styleOf(tree, 'card').backgroundColor).toBe(pal.panel);
    expect(styleOf(tree, 'glow').borderColor).toBe(rgba(pal.teal, 0.3));
    act(() => { tree.unmount(); });
  });

  it('ライト⇄ダークを往復しても色が取り残されない', () => {
    const tree = mount(<Card />);
    for (const pal of [darkPaletteFor('blue'), paletteFor('blue', 'soft'), darkPaletteFor('rose'), PALETTES.green]) {
      applyPalette(pal);
      act(() => { tree.update(<Card />); });
      expect(styleOf(tree, 'card').backgroundColor).toBe(pal.panel);
      expect(styleOf(tree, 'title').color).toBe(pal.ink);
    }
    act(() => { tree.unmount(); });
  });
});
