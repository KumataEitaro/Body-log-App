// ＋ボタンのシート（components/PlusSheet.tsx）の2段遷移を固定する。
//
// 2026-09-02 の入力再設計で、食事タブの入力の入口は「右下の＋ → 何を記録するか（4タイル）→
// 食事なら入力方法（4タイル）」の2段になった。ここが壊れると記録が一切できなくなるので、
// 1段目の4タイル／2段目の4タイル（バーコードは無い）／‹ で戻る／選択が閉じ切ってから onAction に届く、を検証する。
// 食事タブ本体（LogScreen）が＋ボタンと入力シートを持ってマウントできることも見る。
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import PlusSheet from '../components/PlusSheet';
import PlusFab from '../components/PlusFab';
import LogScreen from '../app/(tabs)/log';
import { GuideProvider } from '../components/GuideTour';

jest.useFakeTimers();

async function mount(el: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = renderer.create(el); });
  await act(async () => { jest.advanceTimersByTime(2000); });
  return tree;
}

// タイル（accessibilityLabel＋onPress を持つ Pressable）を文言で探す
function tile(tree: ReactTestRenderer, label: string) {
  const hits = tree.root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function');
  return hits[0];
}
function hasText(tree: ReactTestRenderer, text: string): boolean {
  return tree.root.findAll((n) => n.type === Text && n.props.children === text).length > 0;
}
// 入れ子の <Text> や配列の children を平らにして部分一致で探す（見出し「記録する › 食事」のような合成文言用）
function textIncludes(tree: ReactTestRenderer, sub: string): boolean {
  const flat = (c: unknown): string => Array.isArray(c) ? c.map(flat).join('')
    : (c && typeof c === 'object' && 'props' in (c as object)) ? flat((c as { props: { children?: unknown } }).props.children)
    : c == null || typeof c === 'boolean' ? '' : String(c);
  return tree.root.findAll((n) => n.type === Text && flat(n.props.children).includes(sub)).length > 0;
}

describe('＋シート（食事は直行・体重だけ2段）', () => {
  it('1段目に食事・運動・体の写真・体重＋「何を食べる？」が出る（段表示は出さない）', async () => {
    const tree = await mount(
      <PlusSheet visible onClose={() => {}} onAction={() => {}} onSaveWeight={async () => null} weightUnit="kg" weightPlaceholder="—" />,
    );
    for (const l of ['食事', '運動', '体の写真', '体重', '何を食べる？']) expect(tile(tree, l)).toBeTruthy();
    // 食事は直行になったので「記録する」の下に段は無い（体重だけ2段）
    expect(hasText(tree, '1/2')).toBe(false);
    expect(hasText(tree, '2/2')).toBe(false);
    // 入力方法の選択画面（2段目）は廃止した＝入力シート側にマイ食品・写真アイコンが載っているため
    expect(tile(tree, 'テキストで入力')).toBeUndefined();
    expect(tile(tree, 'マイ食品')).toBeUndefined();
    expect(tile(tree, '撮影する')).toBeUndefined();
    await act(async () => { tree.unmount(); });
  });

  it('食事 → 2段目を挟まず onClose → 閉じ切ってから onAction（meal:text）が1回だけ届く', async () => {
    const onClose = jest.fn();
    const onAction = jest.fn();
    let visible = true;
    const el = () => (
      <PlusSheet visible={visible} onClose={onClose} onAction={onAction} onSaveWeight={async () => null} weightUnit="kg" weightPlaceholder="—" />
    );
    const tree = await mount(el());
    await act(async () => { tile(tree, '食事').props.onPress(); });
    // 1タップで確定する（旧: 食事 → テキストで入力 の2タップ）
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();      // 閉じる前には呼ばない（iOSのModal兄弟問題）
    visible = false;
    await act(async () => { tree.update(el()); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('meal:text');
    await act(async () => { tree.unmount(); });
  });

  it('体重 → シート内で数値を入れて保存（成功で閉じる／エラー文はシート内に出る）', async () => {
    const onClose = jest.fn();
    const onSaveWeight = jest.fn(async (v: string) => (v === '999' ? '体重の値を確認してください。' : null));
    const tree = await mount(
      <PlusSheet visible onClose={onClose} onAction={() => {}} onSaveWeight={onSaveWeight} weightUnit="kg" weightPlaceholder="70.0" />,
    );
    await act(async () => { tile(tree, '体重').props.onPress(); });
    const input = tree.root.findAll((n) => n.props?.keyboardType === 'decimal-pad')[0];
    expect(input).toBeTruthy();
    await act(async () => { input.props.onChangeText('999'); });
    const save = tree.root.findAll((n) => n.props?.label === '体重を記録' && typeof n.props?.onPress === 'function')[0];
    await act(async () => { save.props.onPress(); });
    expect(onSaveWeight).toHaveBeenCalledWith('999');
    expect(hasText(tree, '体重の値を確認してください。')).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { input.props.onChangeText('70.5'); });
    await act(async () => { save.props.onPress(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { tree.unmount(); });
  });

  it('食事タブは＋ボタンを持ち、閉じた入力シート（pageSheet）と＋シートを内包してマウントできる', async () => {
    const tree = await mount(<GuideProvider><LogScreen /></GuideProvider>);
    expect(tree.root.findAllByType(PlusFab)).toHaveLength(1);
    const sheet = tree.root.findByType(PlusSheet);
    expect(sheet.props.visible).toBe(false);
    // ＋を押すとシートが開く
    const fab = tree.root.findAll((n) => n.props?.accessibilityLabel === '記録を追加' && typeof n.props?.onPress === 'function')[0];
    await act(async () => { fab.props.onPress(); });
    expect(tree.root.findByType(PlusSheet).props.visible).toBe(true);
    expect(tile(tree, '食事')).toBeTruthy();
    await act(async () => { tree.unmount(); });
  });
});
