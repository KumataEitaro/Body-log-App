// 4タブ共通の＋（components/PlusEntry.tsx）の配置と振り分けを固定する（2026-09-10・feat/plus-everywhere）。
//
// 熊田さん「運動タブ、概要タブ、相談タブにもプラスボタンを。同じUIでね。相談タブだけ、テキストボックスに
// かぶらない位置に調整して。あとそのプラスボタンからマイ食品を登録できるようにして」
//
// ここが壊れると「＋が消えたタブ」「入力欄に重なった＋」「他タブから食事が記録できない」が起きる。
//   ① 4タブすべてが PlusEntry を1つだけ描く（タブごとに＋を作り直していない）
//   ② ガイド照射キー 'dock' の登録は食事タブの＋だけ（複数登録すると照射が画面外のボタンへずれる）
//   ③ 相談タブは実測した下端コンポーザーぶん持ち上がり、キーボード表示中は出ない
//   ④ 「マイ食品を登録」の行があり、＋シートが閉じ切ってから登録シートが開く（iOSのModal兄弟問題）
//   ⑤ 他タブの食事系は /log?open=… で食事タブへ、運動・体の写真はそのタブにいれば遷移せずその場で開く
//   ⑥ 食事タブは /log?open=… を受けて同じシートを開く
import fs from 'fs';
import path from 'path';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Modal } from 'react-native';
import PlusEntry from '../components/PlusEntry';
import PlusFab from '../components/PlusFab';
import PlusSheet from '../components/PlusSheet';
import AddFoodSheet from '../components/AddFoodSheet';
import ActivityLogSheet from '../components/ActivityLogSheet';
import BodyPhotosCard from '../components/BodyPhotosCard';
import WhatToEatSheet from '../components/WhatToEatSheet';
import EventPlanSheet from '../components/EventPlanSheet';
import LogScreen from '../app/(tabs)/log';
import TrainingScreen from '../app/(tabs)/training';
import ChangesScreen from '../app/(tabs)/changes';
import CoachScreen from '../app/(tabs)/coach';
import { GuideProvider } from '../components/GuideTour';

// 遷移先とURLパラメータをテストから差し替える（jest.setup.js の既定モックを上書き）
const mockNavigate = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
let mockKb = false;
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: () => () => {}, isFocused: () => true }),
  useRouter: () => ({ push: mockPush, navigate: mockNavigate, replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => { const React = require('react'); React.useEffect(() => cb(), []); },
  Redirect: () => null,
  Tabs: () => null,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('@/lib/useKeyboardVisible', () => ({ useKeyboardVisible: () => mockKb }));

jest.useFakeTimers();

async function mount(el: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = renderer.create(<GuideProvider>{el}</GuideProvider>); });
  await act(async () => { jest.advanceTimersByTime(2000); });
  return tree;
}
function item(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function')[0];
}
/** ＋を押して1段目を開き、行を選んで（シートが閉じ切るまで進めて）行動を届ける */
async function pickFromPlus(tree: ReactTestRenderer, label: string) {
  await act(async () => { item(tree, '記録を追加').props.onPress(); });
  await act(async () => { item(tree, label).props.onPress(); });
  await act(async () => { jest.advanceTimersByTime(1000); });
}

beforeEach(() => { mockNavigate.mockClear(); mockParams = {}; mockKb = false; });

describe('＋ボタン（4タブ共通）', () => {
  it('食事・運動・概要・相談の4タブすべてが同じ＋（PlusEntry）を1つだけ持つ', async () => {
    for (const el of [<LogScreen key="log" />, <TrainingScreen key="tr" />, <ChangesScreen key="ch" />, <CoachScreen key="co" />]) {
      const tree = await mount(el);
      expect(tree.root.findAllByType(PlusEntry)).toHaveLength(1);
      await act(async () => { tree.unmount(); });
    }
  });

  it('ガイド照射キー dock を登録するのは食事タブの＋だけ（他タブは登録しない）', async () => {
    const guideKeys: (string | null | undefined)[] = [];
    for (const el of [<LogScreen key="log" />, <TrainingScreen key="tr" />, <ChangesScreen key="ch" />, <CoachScreen key="co" />]) {
      const tree = await mount(el);
      guideKeys.push(tree.root.findByType(PlusEntry).props.guideKey);
      await act(async () => { tree.unmount(); });
    }
    expect(guideKeys.filter((k) => k === 'dock')).toHaveLength(1);
    expect(guideKeys[0]).toBe('dock');   // 食事タブ

    // ソースでも1箇所だけ（貼り足しで2つ目の 'dock' が増えると照射が画面外のボタンへずれる）。
    // 解説コメントの中の 'dock' は数えないので、コメントを落としてから探す
    const dir = path.join(__dirname, '..');
    const files = ['app/(tabs)/log.tsx', 'app/(tabs)/training.tsx', 'app/(tabs)/changes.tsx', 'app/(tabs)/coach.tsx'];
    const hits = files.flatMap((f) => {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return (src.match(/guideKey\s*=\s*["']dock["']|useGuideTarget\(\s*['"]dock['"]\s*\)/g) ?? []).map(() => f);
    });
    expect(hits).toEqual(['app/(tabs)/log.tsx']);
  });

  it('相談タブの＋はコンポーザーの実測ぶん持ち上がり、キーボード表示中は出ない', async () => {
    const tree = await mount(<CoachScreen />);
    // 測る前は描かない（入力欄に重なった1フレームを見せない）
    expect(tree.root.findAllByType(PlusFab)).toHaveLength(0);
    const dock = tree.root.findAll((n) => n.props?.testID === 'coach-dock' && typeof n.props?.onLayout === 'function')[0];
    expect(dock).toBeTruthy();
    await act(async () => { dock.props.onLayout({ nativeEvent: { layout: { height: 120 } } }); });
    // ＋の下端 = insets.bottom + 12 + bottomOffset ／ コンポーザーの上端 = insets.bottom + 6 + 120
    expect(tree.root.findByType(PlusEntry).props.bottomOffset).toBe(122);
    expect(tree.root.findByType(PlusFab).props.bottomOffset).toBe(122);
    await act(async () => { tree.unmount(); });

    mockKb = true;
    const tree2 = await mount(<CoachScreen />);
    const dock2 = tree2.root.findAll((n) => n.props?.testID === 'coach-dock' && typeof n.props?.onLayout === 'function')[0];
    await act(async () => { dock2.props.onLayout({ nativeEvent: { layout: { height: 120 } } }); });
    expect(tree2.root.findByType(PlusEntry).props.hidden).toBe(true);
    expect(tree2.root.findAllByType(PlusFab)).toHaveLength(0);
    await act(async () => { tree2.unmount(); });
  });

  it('食事タブ以外は＋の位置が既定（右下・持ち上げなし）', async () => {
    for (const el of [<LogScreen key="log" />, <TrainingScreen key="tr" />, <ChangesScreen key="ch" />]) {
      const tree = await mount(el);
      expect(tree.root.findByType(PlusEntry).props.bottomOffset ?? 0).toBe(0);
      expect(tree.root.findAllByType(PlusFab)).toHaveLength(1);
      await act(async () => { tree.unmount(); });
    }
  });
});

describe('マイ食品を登録（どのタブからでも）', () => {
  it('＋シートに行があり、シートが閉じ切ってから登録シート（AddFoodSheet）が開く', async () => {
    const tree = await mount(<PlusEntry />);
    await act(async () => { item(tree, '記録を追加').props.onPress(); });
    expect(tree.root.findByType(PlusSheet).props.visible).toBe(true);
    const row = item(tree, 'マイ食品を登録');
    expect(row).toBeTruthy();
    await act(async () => { row.props.onPress(); });
    // 閉じ切る前に開くと iOS では表示中Modalの兄弟になり、何も出ない
    expect(tree.root.findByType(PlusSheet).props.visible).toBe(false);
    expect(tree.root.findByType(AddFoodSheet).props.visible).toBe(false);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(tree.root.findByType(AddFoodSheet).props.visible).toBe(true);
    expect(tree.root.findByType(AddFoodSheet).props.draft).toBeNull();   // 空のシート（AI計算が主導線）
    expect(mockNavigate).not.toHaveBeenCalled();                          // その場で開く＝タブを移らない
    await act(async () => { tree.unmount(); });
  });

  it('食事タブでは登録後にチップを読み直して案内を出す（onMyFoodSaved）', async () => {
    const tree = await mount(<LogScreen />);
    expect(typeof tree.root.findByType(PlusEntry).props.onMyFoodSaved).toBe('function');
    await act(async () => { tree.unmount(); });
  });
});

describe('＋シートの行動の振り分け', () => {
  it('自前処理しないタブでは食事タブ・運動タブ・概要タブへ渡す', async () => {
    const cases: [string, string, Record<string, string>][] = [
      ['食事を記録', '/log', { open: 'text' }],
      ['あとのカロリーで何を食べる？', '/log', { open: 'whattoeat' }],
      ['先の予定を入れる', '/log', { open: 'plan' }],
      ['運動（歩く・走る・泳ぐ）', '/training', { open: 'activity' }],
      ['体の写真', '/changes', { open: 'photos', shoot: '1' }],
    ];
    for (const [label, pathname, params] of cases) {
      mockNavigate.mockClear();
      const tree = await mount(<PlusEntry />);
      await pickFromPlus(tree, label);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      const arg = mockNavigate.mock.calls[0][0] as { pathname: string; params: Record<string, string> };
      expect(arg.pathname).toBe(pathname);
      expect(arg.params).toEqual(expect.objectContaining(params));
      expect(arg.params.ts).toBeTruthy();   // 同じ行動を続けて選んでも開き直すためのノンス
      await act(async () => { tree.unmount(); });
    }
  });

  it('運動タブの「運動（歩く・走る・泳ぐ）」は遷移せずその場で「運動を記録する」シートを開く', async () => {
    const tree = await mount(<TrainingScreen />);
    await pickFromPlus(tree, '運動（歩く・走る・泳ぐ）');
    expect(tree.root.findByType(ActivityLogSheet).props.visible).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => { tree.unmount(); });
  });

  // 2026-09-17 熊田さん「プラスメニューから運動の記録をするときに、急に『運動の記録』に飛ぶので、
  // 『筋トレを記録』と選ばせてほしい」。有酸素（時間ダイアル）と筋トレ（重量×回数×セット）は
  // 入力がまったく違うので、＋シートの時点で行き先を割る
  it('「筋トレ」は有酸素とは別に、筋トレ記録画面へ直行する（戻るラベルと日付つき）', async () => {
    for (const [Screen, from] of [[TrainingScreen, 'training'], [LogScreen, 'log']] as const) {
      mockPush.mockClear(); mockNavigate.mockClear();
      const tree = await mount(<Screen />);
      await pickFromPlus(tree, '筋トレ');
      expect(mockNavigate).not.toHaveBeenCalled();        // 運動タブの有酸素シートへは行かない
      expect(mockPush).toHaveBeenCalledTimes(1);
      const arg = mockPush.mock.calls[0][0] as { pathname: string; params: Record<string, string> };
      expect(arg.pathname).toBe('/lift-session');
      expect(arg.params.from).toBe(from);                 // 戻るボタンが「‹ 運動」「‹ 食事」と名乗る
      expect(arg.params.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      await act(async () => { tree.unmount(); });
    }
  });

  it('概要タブの「体の写真」は遷移せずその場で体写真ページ＋撮影へ', async () => {
    const tree = await mount(<ChangesScreen />);
    expect(tree.root.findAllByType(BodyPhotosCard)).toHaveLength(0);
    await pickFromPlus(tree, '体の写真');
    const card = tree.root.findByType(BodyPhotosCard);
    expect(card.props.autoCaptureKey).toBeTruthy();   // カメラを即起動するノンス
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => { tree.unmount(); });
  });

  it('食事タブの食事系はその場で入力シートを開く（自分のタブへ遷移しない）', async () => {
    const tree = await mount(<LogScreen />);
    const onLocal = tree.root.findByType(PlusEntry).props.onLocal as (a: string) => boolean;
    const handled: Record<string, boolean> = {};
    await act(async () => {
      for (const a of ['meal:text', 'meal:myfood', 'meal:library', 'meal:camera', 'meal:whattoeat', 'plan',
        // 運動・筋トレ・体の写真・マイ食品の登録は共通処理（他タブへ／筋トレ記録画面へ／その場でAddFoodSheet）に任せる
        'exercise', 'lift', 'bodyphoto', 'myfood:add']) handled[a] = onLocal(a);
    });
    expect(handled).toEqual({
      'meal:text': true, 'meal:myfood': true, 'meal:library': true, 'meal:camera': true, 'meal:whattoeat': true, plan: true,
      exercise: false, lift: false, bodyphoto: false, 'myfood:add': false,
    });
    await act(async () => { tree.unmount(); });
  });
});

describe('食事タブが受ける /log?open=…', () => {
  it('open=whattoeat で「何を食べる？」シートが開く', async () => {
    mockParams = { open: 'whattoeat', ts: '1' };
    const tree = await mount(<LogScreen />);
    expect(tree.root.findByType(WhatToEatSheet).props.visible).toBe(true);
    await act(async () => { tree.unmount(); });
  });

  it('open=plan で先の予定のシートが開く', async () => {
    mockParams = { open: 'plan', ts: '1' };
    const tree = await mount(<LogScreen />);
    expect(tree.root.findByType(EventPlanSheet).props.visible).toBe(true);
    await act(async () => { tree.unmount(); });
  });

  it('open=text で入力シート（pageSheet）が開く', async () => {
    const closed = await mount(<LogScreen />);
    const openSheets = (tree: ReactTestRenderer) =>
      tree.root.findAllByType(Modal).filter((n) => n.props.presentationStyle === 'pageSheet' && n.props.visible === true).length;
    expect(openSheets(closed)).toBe(0);
    await act(async () => { closed.unmount(); });

    mockParams = { open: 'text', ts: '1' };
    const tree = await mount(<LogScreen />);
    expect(openSheets(tree)).toBe(1);
    await act(async () => { tree.unmount(); });
  });

  it('知らない open= は無視する（誤ったディープリンクで固まらない）', async () => {
    mockParams = { open: 'nope', ts: '1' };
    const tree = await mount(<LogScreen />);
    expect(tree.root.findByType(WhatToEatSheet).props.visible).toBe(false);
    expect(tree.root.findByType(EventPlanSheet).props.visible).toBe(false);
    await act(async () => { tree.unmount(); });
  });
});
