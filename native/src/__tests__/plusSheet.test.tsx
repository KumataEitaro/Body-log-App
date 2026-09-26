// ＋ボタンのシート（components/PlusSheet.tsx）の構成と遷移を固定する。
//
// 2026-09-04 の再設計で、シートは「食事だけ大きいカード＋残りはリスト行」になった。
// （2×2の大きなカードを並べる形は、アイコンとラベルを縦積みするため縦中央の計算が要り、
//   新アーキ×iOS の lineHeight 問題で文字が下に寄る事故を招いた。詳細は PlusSheet.tsx 冒頭）
// ここが壊れると記録が一切できなくなるので、①食事カードが1枚 ②身体を記録・先の予定・目標設定・AIに相談が
// リスト行として在る ③食事は1タップで meal:text が閉じ切ってから届く ④2×2グリッドが無い
// ⑤体重・ウエストは「身体を記録」の下の段でシート内保存、を検証する。
// 食事タブ本体（LogScreen）が＋ボタンと入力シートを持ってマウントできることも見る。
//
// 2026-09-10: ＋は4タブ共通になり（components/PlusEntry.tsx）、区切り線の下に「マイ食品を登録」が増えた（486pt）。
// 2026-09-26: 熊田さん「項目が多すぎる。親指が届く高さに」→ 1段目を5項目（食事・身体・先の予定・目標設定・AIに相談）に
// 絞った（約390pt）。運動・筋トレ・マイ食品を登録・何を食べる？の行は廃止し、体重・ウエスト・体脂肪率は「身体を記録」の
// 2段目へ。テストの行リスト・並び・段の遷移はこの仕様に合わせて書き換えた。
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
  it('食事の大カードが1枚だけ・身体を記録/先の予定/目標設定/AIに相談の4行だけ（段表示は出さない）', async () => {
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

    // ② 残りはすべて高さ52のリスト行で、右端にシェブロンが付く（4行。親指が届く高さに収める）
    for (const l of ['身体を記録', '先の予定を入れる', '目標設定', 'AIに相談']) {
      const row = item(tree, l);
      expect(row).toBeTruthy();
      expect(styleOf(row).height).toBe(52);
      expect(styleOf(row).flexDirection).toBe('row');
    }

    // ②' 並びは固定: 食事 → 身体を記録 → 先の予定 → 目標設定 → AIに相談
    const order = tree.root
      .findAll((n) => typeof n.props?.testID === 'string' && n.props.testID.startsWith('plus-') && typeof n.props?.onPress === 'function')
      .map((n) => n.props.testID as string)
      // 同じ testID が Row と中の Pressable の両方に付く（＝連続して2回出る）ので畳む
      .filter((id, i, arr) => id !== arr[i - 1]);
    expect(order).toEqual(['plus-meal', 'plus-body', 'plus-plan', 'plus-goal', 'plus-coach']);

    // ②'' 2026-09-26 に外した行は1段目に無い。運動・筋トレ → 運動タブのタイル、マイ食品を登録 → 入力シートの
    //     「マイ食品を追加」、何を食べる？ → 食事タブのヒーロー。体の3つは「身体を記録」の下（別テスト）
    for (const l of ['運動（歩く・走る・泳ぐ）', '筋トレ', 'マイ食品を登録', 'あとのカロリーで何を食べる？', '体重', 'ウエスト', '体脂肪率（AIで推定）']) {
      expect(item(tree, l)).toBeUndefined();
    }

    // ③ 2×2グリッド（flexWrap で折り返す枡・幅%指定・正方形に近い高さ）はもう無い
    const wrapped = tree.root.findAll((n) => n.type === View && (styleOf(n) as { flexWrap?: string }).flexWrap === 'wrap');
    expect(wrapped).toHaveLength(0);
    for (const l of ['食事を記録', '身体を記録', '先の予定を入れる', '目標設定', 'AIに相談']) {
      expect(styleOf(item(tree, l)).width).toBeUndefined();   // 旧タイルは width:'47.5%'
    }

    // ④ 文字が下へずれる事故の再発防止: lineHeight を書かない・adjustsFontSizeToFit を使わない
    const labels = tree.root.findAll((n) => n.type === Text);
    for (const n of labels) {
      const st = Object.assign({}, ...(Array.isArray(n.props.style) ? n.props.style : [n.props.style]).filter(Boolean));
      expect((st as { lineHeight?: number }).lineHeight).toBeUndefined();
      expect(n.props.adjustsFontSizeToFit).toBeFalsy();
    }

    // ⑤ 段番号（1/2・2/2）は出さない。階層はパンくず（記録する › 身体を記録 › 体重）で見せる（2026-09-26）
    expect(hasText(tree, '1/2')).toBe(false);
    expect(hasText(tree, '2/2')).toBe(false);
    expect(hasText(tree, '2/3')).toBe(false);
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

  it('リスト行の行動もそのまま外へ出る（先の予定・目標設定・AIに相談、身体を記録 › 体脂肪率）', async () => {
    // [押す順番, 期待する行動]。体脂肪率だけ「身体を記録」の段を挟む
    for (const [path, action] of [
      [['先の予定を入れる'], 'plan'], [['目標設定'], 'goal'], [['AIに相談'], 'coach'],
      // 体脂肪率のシート（BodyFatSheet）も、＋シートが閉じ切ってから開く（iOSのModal兄弟問題）
      [['身体を記録', '体脂肪率（AIで推定）'], 'bodyfat'],
    ] as const) {
      const onAction = jest.fn();
      let visible = true;
      const el = () => (
        <PlusSheet visible={visible} onClose={() => { visible = false; }} onAction={onAction} onSaveWeight={async () => null} weightUnit="kg" weightPlaceholder="—" />
      );
      const tree = await mount(el());
      for (const label of path) await act(async () => { item(tree, label).props.onPress(); });
      await act(async () => { tree.update(el()); });
      await act(async () => { jest.advanceTimersByTime(1000); });
      expect(onAction).toHaveBeenCalledWith(action);
      await act(async () => { tree.unmount(); });
    }
  });

  // 2026-09-26: 体重・ウエスト・体脂肪率は1行「身体を記録」にまとめ、押すと次の段で3つから選ぶ
  it('身体を記録 → 2段目は 体重・ウエスト・体脂肪率（AIで推定）の3行。パンくずは「記録する › 身体を記録 › 体重」、戻るは1段ずつ', async () => {
    const tree = await mount(
      <PlusSheet visible onClose={() => {}} onAction={() => {}} onSaveWeight={async () => null} weightUnit="kg" weightPlaceholder="—" />,
    );
    expect(item(tree, '戻る')).toBeUndefined();   // 1段目に戻るは無い
    await act(async () => { item(tree, '身体を記録').props.onPress(); });
    expect(item(tree, '食事を記録')).toBeUndefined();   // 1段目は消える
    const order = tree.root
      .findAll((n) => typeof n.props?.testID === 'string' && n.props.testID.startsWith('plus-') && typeof n.props?.onPress === 'function')
      .map((n) => n.props.testID as string)
      .filter((id, i, arr) => id !== arr[i - 1]);
    expect(order).toEqual(['plus-weight', 'plus-waist', 'plus-bodyfat']);
    for (const l of ['体重', 'ウエスト', '体脂肪率（AIで推定）']) expect(styleOf(item(tree, l)).height).toBe(52);
    expect(hasText(tree, '記録する › ')).toBe(true);   // パンくずの前段

    // 体重 → 3段目（数値入力）。パンくずは「記録する › 身体を記録 › 体重」
    await act(async () => { item(tree, '体重').props.onPress(); });
    // 数値入力が出ている（TextInput はホスト側にも同じ props が伝播して2つ見つかるので個数は数えない）
    expect(tree.root.findAll((n) => n.props?.keyboardType === 'decimal-pad').length).toBeGreaterThan(0);
    expect(hasText(tree, '記録する › 身体を記録 › ')).toBe(true);
    // 戻るは身体の段へ（1段目まで戻さない）
    await act(async () => { item(tree, '戻る').props.onPress(); });
    expect(item(tree, 'ウエスト')).toBeTruthy();
    expect(item(tree, '食事を記録')).toBeUndefined();
    // もう一度戻ると1段目
    await act(async () => { item(tree, '戻る').props.onPress(); });
    expect(item(tree, '食事を記録')).toBeTruthy();
    expect(item(tree, '体重')).toBeUndefined();
    await act(async () => { tree.unmount(); });
  });

  it('体重 → シート内で数値を入れて保存（成功で閉じる／エラー文はシート内に出る）', async () => {
    const onClose = jest.fn();
    const onSaveWeight = jest.fn(async (v: string) => (v === '999' ? '体重の値を確認してください。' : null));
    const tree = await mount(
      <PlusSheet visible onClose={onClose} onAction={() => {}} onSaveWeight={onSaveWeight} weightUnit="kg" weightPlaceholder="70.0" />,
    );
    await act(async () => { item(tree, '身体を記録').props.onPress(); });   // 2026-09-26: 体重は「身体を記録」の下
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

  // 2026-09-18 熊田さん「ウエストの入力も体重などと同じように入力できるようにして」
  it('ウエスト → 体重と同じ2段目（数字＋単位＋保存）。成功で閉じる／エラー文はシート内', async () => {
    const onClose = jest.fn();
    const onSaveWaist = jest.fn(async (v: string) => (v === '999' ? 'ウエストの値を確認してください。' : null));
    const tree = await mount(
      <PlusSheet visible onClose={onClose} onAction={() => {}} onSaveWeight={async () => null} weightUnit="kg" weightPlaceholder="70.0"
                 onSaveWaist={onSaveWaist} waistUnit="cm" waistPlaceholder="80.0" />,
    );
    await act(async () => { item(tree, '身体を記録').props.onPress(); });   // 2026-09-26: ウエストは「身体を記録」の下
    await act(async () => { item(tree, 'ウエスト').props.onPress(); });
    const input = tree.root.findAll((n) => n.props?.keyboardType === 'decimal-pad')[0];
    expect(input).toBeTruthy();
    expect(hasText(tree, 'cm')).toBe(true);                 // 単位は cm（体重の kg ではない）
    await act(async () => { input.props.onChangeText('999'); });
    const save = tree.root.findAll((n) => n.props?.label === 'ウエストを記録' && typeof n.props?.onPress === 'function')[0];
    expect(save).toBeTruthy();
    await act(async () => { save.props.onPress(); });
    expect(onSaveWaist).toHaveBeenCalledWith('999');
    expect(hasText(tree, 'ウエストの値を確認してください。')).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { input.props.onChangeText('80.5'); });
    await act(async () => { save.props.onPress(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { tree.unmount(); });
  });

  it('initialStep=weight で開くと、いきなり体重の段（スタートチェックリストからの直行）', async () => {
    const tree = await mount(
      <PlusSheet visible onClose={() => {}} onAction={() => {}} onSaveWeight={async () => null} weightUnit="kg" weightPlaceholder="70.0" initialStep="weight" />,
    );
    expect(tree.root.findAll((n) => n.props?.keyboardType === 'decimal-pad').length).toBeGreaterThan(0);
    expect(item(tree, '食事を記録')).toBeUndefined();   // 1段目は出ていない
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
