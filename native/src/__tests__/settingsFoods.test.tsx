// 設定＞マイ食品の管理＞「＋ 食品を追加」が実際に追加シートを開くことを固定する。
//
// 2026-09-02 の不具合: 追加フォームの <Modal> が「マイ食品の管理」ではなく別のシート
// （アイコン選択）の内側に置かれていた。foodFormOpen は true になるのに、親のシートが
// visible=false で描かれていないため子のフォームもマウントされず、ボタンが無反応に見えた。
// RNのjest用 Modal モックは visible=false のとき子を描かないので、ここで同じ現象を再現できる。
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import SettingsScreen from '../app/settings';
import AddFoodSheet from '../components/AddFoodSheet';
import { GuideProvider } from '../components/GuideTour';

jest.useFakeTimers();

async function mount(el: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = renderer.create(el); });
  await act(async () => { jest.advanceTimersByTime(2000); });   // マウント直後のload（モックsupabase）を消化
  return tree;
}

// label プロパティ＋onPress を持つ要素（設定の Row / OptionButton）を文言で探す
function byLabel(tree: ReactTestRenderer, label: string) {
  const hits = tree.root.findAll((n) => n.props?.label === label && typeof n.props?.onPress === 'function');
  return hits[0];
}

describe('マイ食品の管理 → 食品を追加', () => {
  it('「＋ 食品を追加」を押すと追加シートが開く（シートは管理モーダルの内側で描かれる）', async () => {
    const tree = await mount(<GuideProvider><SettingsScreen /></GuideProvider>);

    // 管理シートを開く前: 追加シートはどこにも描かれていない（他のシートの内側に紛れていないこと）
    expect(tree.root.findAllByType(AddFoodSheet)).toHaveLength(0);

    // 設定の「マイ食品の管理」行 → 管理シートが開く
    const row = byLabel(tree, 'マイ食品の管理');
    expect(row).toBeTruthy();
    await act(async () => { row.props.onPress(); });

    // 管理シートの内側に追加シート（閉じた状態）が描かれている＝ボタンが効く前提が揃っている
    const sheet = tree.root.findByType(AddFoodSheet);
    expect(sheet.props.visible).toBe(false);

    // 「＋ 食品を追加」を押す → 追加シートが visible になり、中身（タイトル）が描かれる
    const addBtn = byLabel(tree, '＋ 食品を追加');
    expect(addBtn).toBeTruthy();
    await act(async () => { addBtn.props.onPress(); });
    expect(tree.root.findByType(AddFoodSheet).props.visible).toBe(true);
    const titles = tree.root.findAll((n) => n.type === Text && n.props.children === 'マイ食品を追加');
    expect(titles.length).toBeGreaterThan(0);

    // 追加シートの主導線（AIで計算）と、AIを使わない人向けの折り畳みが両方ある
    expect(byLabel(tree, '✦ AIで計算')).toBeTruthy();
    const fold = tree.root.findAll((n) => n.type === Text && n.props.children === '手動で入力する（AIを使わない）');
    expect(fold.length).toBeGreaterThan(0);

    await act(async () => { tree.unmount(); });
  });

  it('登録0件のとき空状態の案内が出る', async () => {
    const tree = await mount(<GuideProvider><SettingsScreen /></GuideProvider>);
    await act(async () => { byLabel(tree, 'マイ食品の管理').props.onPress(); });
    const empty = tree.root.findAll((n) => n.type === Text && n.props.children === 'よく食べるものを登録すると1タップで記録できます');
    expect(empty.length).toBeGreaterThan(0);
    await act(async () => { tree.unmount(); });
  });
});
