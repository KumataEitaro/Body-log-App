// 4タブ共通の＋（components/PlusEntry.tsx）の配置と振り分けを固定する（2026-09-10・feat/plus-everywhere）。
//
// 熊田さん「運動タブ、概要タブ、相談タブにもプラスボタンを。同じUIでね。相談タブだけ、テキストボックスに
// かぶらない位置に調整して。あとそのプラスボタンからマイ食品を登録できるようにして」
//
// ここが壊れると「＋が消えたタブ」「入力欄に重なった＋」「他タブから食事が記録できない」が起きる。
//   ① 4タブすべてが PlusEntry を1つだけ描く（タブごとに＋を作り直していない）
//   ② ガイド照射キー 'dock' の登録は食事タブの＋だけ（複数登録すると照射が画面外のボタンへずれる）
//   ③ 相談タブは実測した下端コンポーザーぶん持ち上がり、キーボード表示中は出ない
//   ④ 行動 'myfood:add' が届けば登録シート（AddFoodSheet）がその場で開く。＋シートの「マイ食品を登録」行は
//      2026-09-26 に廃止し、食事タブの入力シート「マイ食品を追加」が同じ AddFoodSheet を開く
//   ⑤ 他タブの食事系は /log?open=… で食事タブへ、目標設定は /settings?open=goal へ push、AIに相談は相談タブへ
//   ⑥ 食事タブは /log?open=… を受けて同じシートを開く
// 2026-09-26: ＋シートを5項目（食事・身体を記録・先の予定・目標設定・AIに相談）に絞った（熊田さん「項目が多すぎる」）。
//   運動・筋トレの行（→ 運動タブのタイル）と「あとのカロリーで何を食べる？」（→ 食事タブのヒーロー）のテストは
//   仕様変更に合わせて書き換えた。体脂肪率は「身体を記録」の段を挟む
import fs from 'fs';
import path from 'path';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Modal } from 'react-native';
import PlusEntry from '../components/PlusEntry';
import PlusFab from '../components/PlusFab';
import PlusSheet from '../components/PlusSheet';
import AddFoodSheet from '../components/AddFoodSheet';
import ActivityLogSheet from '../components/ActivityLogSheet';
import BodyFatSheet from '../components/BodyFatSheet';
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
/** ＋を押して1段目を開き、行を順に選んで（シートが閉じ切るまで進めて）行動を届ける。
 *  2段目を挟むものは ['身体を記録', '体脂肪率（AIで推定）'] のように順に渡す */
async function pickFromPlus(tree: ReactTestRenderer, ...labels: string[]) {
  await act(async () => { item(tree, '記録を追加').props.onPress(); });
  for (const label of labels) await act(async () => { item(tree, label).props.onPress(); });
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

describe('マイ食品の登録（myfood:add）', () => {
  // 2026-09-26: ＋シートの「マイ食品を登録」行は廃止（項目を5つに絞った）。行動 'myfood:add' と PlusEntry の
  // 共通処理（その場で AddFoodSheet）は残し、食事タブの入力シート「マイ食品を追加」が同じシートを開く
  it('＋シートに「マイ食品を登録」の行は無いが、myfood:add が届けばその場で登録シート（AddFoodSheet）が開く', async () => {
    const tree = await mount(<PlusEntry />);
    await act(async () => { item(tree, '記録を追加').props.onPress(); });
    expect(tree.root.findByType(PlusSheet).props.visible).toBe(true);
    expect(item(tree, 'マイ食品を登録')).toBeUndefined();
    expect(tree.root.findByType(AddFoodSheet).props.visible).toBe(false);
    // シートが閉じ切ってから届く行動（PlusSheet の onAction 契約）を直接流す
    await act(async () => { tree.root.findByType(PlusSheet).props.onAction('myfood:add'); });
    expect(tree.root.findByType(AddFoodSheet).props.visible).toBe(true);
    expect(tree.root.findByType(AddFoodSheet).props.draft).toBeNull();   // 空のシート（AI計算が主導線）
    expect(mockNavigate).not.toHaveBeenCalled();                          // その場で開く＝タブを移らない
    await act(async () => { tree.unmount(); });
  });

  it('食事タブの入力シートに「マイ食品を追加」があり（マイ食品0件でも出る）、シートの内側の AddFoodSheet を開く', async () => {
    mockParams = { open: 'text', ts: '1' };
    const tree = await mount(<LogScreen />);
    const btn = item(tree, 'マイ食品を追加');
    expect(btn).toBeTruthy();
    const openSheets = () => tree.root.findAllByType(AddFoodSheet).filter((n) => n.props.visible === true);
    expect(openSheets()).toHaveLength(0);
    await act(async () => { btn.props.onPress(); });
    expect(openSheets()).toHaveLength(1);
    expect(openSheets()[0].props.draft).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => { tree.unmount(); });
  });

  it('食事タブでは登録後にチップを読み直して案内を出す（onMyFoodSaved）', async () => {
    const tree = await mount(<LogScreen />);
    expect(typeof tree.root.findByType(PlusEntry).props.onMyFoodSaved).toBe('function');
    await act(async () => { tree.unmount(); });
  });
});

describe('＋シートの行動の振り分け', () => {
  it('自前処理しないタブでは食事タブへ渡す（食事を記録・先の予定）', async () => {
    const cases: [string, string, Record<string, string>][] = [
      ['食事を記録', '/log', { open: 'text' }],
      ['先の予定を入れる', '/log', { open: 'plan' }],
      // 「体の写真」（/changes?open=photos）は 2026-09-18 に廃止。体脂肪率はその場のシートで AI 推定する（下のテスト）
      // 「あとのカロリーで何を食べる？」（/log?open=whattoeat）と「運動」（/training?open=activity）の行は 2026-09-26 に廃止
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

  // 2026-09-26: ＋シートから「運動」「筋トレ」の行を外した（項目を5つに）。入口は運動タブの2枚のタイルに残っている
  it('運動・筋トレの入口は運動タブのタイル（＋シートには無い）。運動タイルはその場で「運動を記録する」シートを開く', async () => {
    const tree = await mount(<TrainingScreen />);
    await act(async () => { item(tree, '記録を追加').props.onPress(); });
    expect(item(tree, '運動（歩く・走る・泳ぐ）')).toBeUndefined();
    expect(item(tree, '筋トレ')).toBeUndefined();
    await act(async () => { item(tree, '閉じる').props.onPress(); });
    const tile = (id: string) => tree.root.findAll((n) => n.props?.testID === id && typeof n.props?.onPress === 'function')[0];
    expect(tile('tile-lift')).toBeTruthy();                // 筋トレ → /lift-session（training.tsx openLiftSession）
    expect(tree.root.findByType(ActivityLogSheet).props.visible).toBe(false);
    await act(async () => { tile('tile-activity').props.onPress(); });
    expect(tree.root.findByType(ActivityLogSheet).props.visible).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => { tree.unmount(); });
  });

  it('「目標設定」は設定画面の目標シートへ push（/settings?open=goal・from は親タブ）', async () => {
    for (const [Screen, from] of [[TrainingScreen, 'training'], [LogScreen, 'log']] as const) {
      mockPush.mockClear(); mockNavigate.mockClear();
      const tree = await mount(<Screen />);
      await pickFromPlus(tree, '目標設定');
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledTimes(1);
      const arg = mockPush.mock.calls[0][0] as { pathname: string; params: Record<string, string> };
      expect(arg.pathname).toBe('/settings');
      expect(arg.params.open).toBe('goal');               // settings.tsx が受けて目標シートを直接開く
      expect(arg.params.from).toBe(from);                 // 戻るボタンが「‹ 運動」「‹ 食事」と名乗る
      await act(async () => { tree.unmount(); });
    }
  });

  it('「AIに相談」は相談タブへ切り替える（router.navigate）', async () => {
    mockPush.mockClear();
    const tree = await mount(<PlusEntry />);
    await pickFromPlus(tree, 'AIに相談');
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/coach');
    await act(async () => { tree.unmount(); });
  });

  // 2026-09-18 熊田さん「体の写真保存はエラーが出るのであきらめる。機能として消して。
  // 代わりに AI で測定した体脂肪率の保存のみ出来るようにして（画像の保存はできませんと明示して）」
  it('「体脂肪率（AIで推定）」はどのタブでも遷移せず、その場で BodyFatSheet が開く（写真は保存しないと明示）', async () => {
    for (const Screen of [ChangesScreen, LogScreen]) {
      mockNavigate.mockClear();
      const tree = await mount(<Screen />);
      expect(tree.root.findByType(BodyFatSheet).props.visible).toBe(false);
      await pickFromPlus(tree, '身体を記録', '体脂肪率（AIで推定）');   // 2026-09-26: 「身体を記録」の段を挟む
      expect(tree.root.findByType(BodyFatSheet).props.visible).toBe(true);
      expect(mockNavigate).not.toHaveBeenCalled();
      // 「写真は保存されません」の明示がシートにある
      expect(tree.root.findAll((n) => n.props?.testID === 'bodyfat-no-photo-notice').length).toBeGreaterThan(0);
      await act(async () => { tree.unmount(); });
    }
  });

  it('「体の写真」の行は無い（写真の保存機能は 2026-09-18 に廃止）', async () => {
    const tree = await mount(<PlusEntry />);
    await act(async () => { item(tree, '記録を追加').props.onPress(); });
    expect(item(tree, '体の写真')).toBeUndefined();
    await act(async () => { tree.unmount(); });
  });

  it('食事タブの食事系はその場で入力シートを開く（自分のタブへ遷移しない）', async () => {
    const tree = await mount(<LogScreen />);
    const onLocal = tree.root.findByType(PlusEntry).props.onLocal as (a: string) => boolean;
    const handled: Record<string, boolean> = {};
    await act(async () => {
      for (const a of ['meal:text', 'meal:myfood', 'meal:library', 'meal:camera', 'plan',
        // 体脂肪率・目標設定・AIに相談・マイ食品の登録は共通処理（その場で BodyFatSheet／設定へ push／相談タブへ／AddFoodSheet）に任せる
        'bodyfat', 'goal', 'coach', 'myfood:add']) handled[a] = onLocal(a);
    });
    expect(handled).toEqual({
      'meal:text': true, 'meal:myfood': true, 'meal:library': true, 'meal:camera': true, plan: true,
      bodyfat: false, goal: false, coach: false, 'myfood:add': false,
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
