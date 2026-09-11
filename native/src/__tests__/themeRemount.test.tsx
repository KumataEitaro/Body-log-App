// ThemeRemount の保証: 「再描画を省く子」が中にいても、テーマ切替後に古い色が残らない。
//
// 対照実験として、同じ「省く子」を壁なしで描くと古い色が残ることも確認する
// （＝この壁が無いと起きる事故を、テストが再現して見せる）。
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { memo } from 'react';
import { View, Text } from 'react-native';
import { C, applyPalette, themed } from '@/lib/ui';
import { paletteFor, darkPaletteFor, setTheme } from '@/lib/theme';
import ThemeRemount from '@/components/ThemeRemount';

const s = themed(() => ({ title: { color: C.ink } }));

// わざと「再描画を省く子」: memo で包み、props も購読も無い（規約違反の典型）
const Stale = memo(function Stale() {
  return <Text testID="title" style={s.title}>x</Text>;
});

function colorOf(tree: ReactTestRenderer): string {
  const el = tree.root.findByProps({ testID: 'title' });
  const st = Array.isArray(el.props.style) ? Object.assign({}, ...el.props.style) : el.props.style;
  return st.color;
}

describe('ThemeRemount: 世代が変わったら子を作り直す', () => {
  const light = paletteFor('green', 'strong');
  const dark = darkPaletteFor('green');

  beforeEach(() => { applyPalette(light); });
  afterEach(async () => { await setTheme({ mode: 'system' }); });

  it('対照: 壁なしでは memo の子に古い色が残る（この事故を再現）', () => {
    let tree!: ReactTestRenderer;
    act(() => { tree = renderer.create(<View><Stale /></View>); });
    expect(colorOf(tree)).toBe(light.ink);
    act(() => { applyPalette(dark); tree.update(<View><Stale /></View>); });
    // 親は再描画されたが memo が省くので、色はライトのまま＝まだら
    expect(colorOf(tree)).toBe(light.ink);
  });

  it('壁あり: 同じ memo の子でもダークの色になる', () => {
    let tree!: ReactTestRenderer;
    act(() => { tree = renderer.create(<ThemeRemount><Stale /></ThemeRemount>); });
    expect(colorOf(tree)).toBe(light.ink);
    act(() => { applyPalette(dark); tree.update(<ThemeRemount><Stale /></ThemeRemount>); });
    expect(colorOf(tree)).toBe(dark.ink);
    // 戻しても追従する
    act(() => { applyPalette(light); tree.update(<ThemeRemount><Stale /></ThemeRemount>); });
    expect(colorOf(tree)).toBe(light.ink);
  });

  it('世代が変わらない再描画では子を作り直さない／変わったときだけ作り直す', () => {
    const mountLog: string[] = [];
    function Probe() {
      // マウントのたびに1回だけ記録する（useEffect の初回）
      // eslint-disable-next-line react-hooks/rules-of-hooks
      require('react').useEffect(() => { mountLog.push('mount'); }, []);
      return <Text testID="title" style={s.title}>x</Text>;
    }
    let tree!: ReactTestRenderer;
    act(() => { tree = renderer.create(<ThemeRemount><Probe /></ThemeRemount>); });
    act(() => { tree.update(<ThemeRemount><Probe /></ThemeRemount>); });
    act(() => { tree.update(<ThemeRemount><Probe /></ThemeRemount>); });
    expect(mountLog).toHaveLength(1);   // 親の再描画だけでは再マウントしない
    act(() => { applyPalette(dark); tree.update(<ThemeRemount><Probe /></ThemeRemount>); });
    expect(mountLog).toHaveLength(2);   // 世代が進んだので1回だけ作り直す
  });
});
