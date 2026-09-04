// ＋ボタンのシート（components/PlusSheet.tsx）の構成と遷移を固定する。
//
// 2026-09-04 の再設計で、シートは「食事だけ大きいカード＋残りはリスト行」になった。
// （2×2の大きなカードを並べる形は、アイコンとラベルを縦積みするため縦中央の計算が要り、
//   新アーキ×iOS の lineHeight 問題で文字が下に寄る事故を招いた。詳細は PlusSheet.tsx 冒頭）
// ここが壊れると記録が一切できなくなるので、①食事カードが1枚 ②運動・体の写真・体重・
// 「あとのカロリーで何を食べる？」がリスト行として在る ③食事は1タップで meal:text が閉じ切ってから届く
// ④2×2グリッドが無い ⑤体重は従来どおりシート内2段目、を検証する。
// 食事タブ本体（LogScreen）が＋ボタンと入力シートを持ってマウントできることも見る。
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text, View } from 'react-native';
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

// 押せる項目（accessibilityLabel＋onPress を持つ Pressable）を文言で探す
function item(tree: ReactTestRenderer, label: string) {
  const hits = tree.root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function');
  return hits[0];
}
// 押せる項目に当たっているスタイル（配列/関数の戻りをまとめて1つのオブジェクトに）
function styleOf(node: ReturnType<typeof item>): Record<string, unknown> {
  const raw = typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style;
  const flat = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.flatMap(flat)
    : v && typeof v === 'object' ? [v as Record<string, unknown>] : [];
  return Object.assign({}, ...flat(raw));
}
function hasText(tree: ReactTestRenderer, text: string): boolean {
  return tree.root.findAll((n) => n.type === Text && n.props.children === text).length > 0;
}

describe('＋シート（食事は大カード・他はリスト行）', () => {
  it('食事の大カードが1枚だけ・運動/体の写真/体重/あとのカロリーで何を食べる？はリスト行（段表示は出さない）', async () => {
    const tree = await mount(
      <PlusSheet visible onClose={() => {}} onAction={() => {}} onSaveWeight={async () => null} weightUnit="kg" weightPlaceholder="—" />,
    );

    // ① 食事は「食事を記録」の大カード1枚（testID plus-meal は1つだけ）
    const meal = item(tree, '食事を記録');
    expect(meal).toBeTruthy();
    // 大カードは1枚だけ（testIDはホスト側にも伝播するので、押せる要素に絞って数える）
    expect(tree.root.findAll((n) => n.props?.testID === 'plus-meal' && typeof n.props?.onPress === 'function')).toHaveLength(1);
    expect(styleOf(meal).height).toBe(76);
    // アイコンとラベルは必ず横並び（縦積みに戻したらここで落ちる）
    expect(styleOf(meal).flexDirection).toBe('row');

    // ② 残りはすべて高さ52のリスト行で、右端にシェブロンが付く
    for (const l of ['運動', '体の写真', '体重', 'あとのカロリーで何を食べる？']) {
      const row = item(tree, l);
      expect(row).toBeTruthy();
      expect(styleOf(row).height).toBe(52);
      expect(styleOf(row).flexDirection).toBe('row');
    }

    // ③ 2×2グリッド（flexWrap で折り返す枡・幅%指定・正方形に近い高さ）はもう無い
    const wrapped = tree.root.findAll((n) => n.type === View && (styleOf(n) as { flexWrap?: string }).flexWrap === 'wrap');
    expect(wrapped).toHaveLength(0);
    for (const l of ['食事を記録', '運動', '体の写真', '体重', 'あとのカロリーで何を食べる？']) {
      expect(styleOf(item(tree, l)).width).toBeUndefined();   // 旧タイルは width:'47.5%'
    }

    // ④ 文字が下へずれる事故の再発防止: lineHeight を書かない・adjustsFontSizeToFit を使わない
    const labels = tree.root.findAll((n) => n.type === Text);
    for (const n of labels) {
      const st = Object.assign({}, ...(Array.isArray(n.props.style) ? n.props.style : [n.props.style]).filter(Boolean));
      expect((st as { lineHeight?: number }).lineHeight).toBeUndefined();
      expect(n.props.adjustsFontSizeToFit).toBeFalsy();
    }

    // ⑤ 食事は直行なので「記録する」の下に段は無い（体重だけ2段）
    expect(hasText(tree, '1/2')).toBe(false);
    expect(hasText(tree, '2/2')).toBe(false);
    // 入力方法の選択画面（旧2段目）は廃止した＝入力シート側にマイ食品・写真アイコンが載っているため
    expect(item(tree, 'テキストで入力')).toBeUndefined();
    expect(item(tree, 'マイ食品')).toBeUndefined();
    expect(item(tree, '撮影する')).toBeUndefined();
    await act(async () => { tree.unmount(); });
  });

  it('食事を記録 → 2段目を挟まず onClose → 閉じ切ってから onAction（meal:text）が1回だけ届く', async () => {
    const onClose = jest.fn();
    const onAction = jest.fn();
    let visible = true;
    const el = () => (
      <PlusSheet visible={visible} onClose={onClose} onAction={onAction} onSaveWeight={async () => null} weightUnit="kg" weightPlaceholder="—" />
    );
    const tree = await mount(el());
    await act(async () => { item(tree, '食事を記録').props.onPress(); });
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

  it('リスト行の行動もそのまま外へ出る（運動・体の写真・あとのカロリーで何を食べる？）', async () => {
    for (const [label, action] of [['運動', 'exercise'], ['体の写真', 'bodyphoto'], ['あとのカロリーで何を食べる？', 'meal:whattoeat']] as const) {
      const onAction = jest.fn();
      let visible = true;
      const el = () => (
        <PlusSheet visible={visible} onClose={() => { visible = false; }} onAction={onAction} onSaveWeight={async () => null} weightUnit="kg" weightPlaceholder="—" />
      );
      const tree = await mount(el());
      await act(async () => { item(tree, label).props.onPress(); });
      await act(async () => { tree.update(el()); });
      await act(async () => { jest.advanceTimersByTime(1000); });
      expect(onAction).toHaveBeenCalledWith(action);
      await act(async () => { tree.unmount(); });
    }
  });

  it('体重 → シート内で数値を入れて保存（成功で閉じる／エラー文はシート内に出る）', async () => {
    const onClose = jest.fn();
    const onSaveWeight = jest.fn(async (v: string) => (v === '999' ? '体重の値を確認してください。' : null));
    const tree = await mount(
      <PlusSheet visible onClose={onClose} onAction={() => {}} onSaveWeight={onSaveWeight} weightUnit="kg" weightPlaceholder="70.0" />,
    );
    await act(async () => { item(tree, '体重').props.onPress(); });
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
    expect(item(tree, '食事を記録')).toBeTruthy();
    await act(async () => { tree.unmount(); });
  });
});
