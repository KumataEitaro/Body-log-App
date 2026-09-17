// 「まだら」を**症状そのもの**で捕まえる最後の網（2026-09-17）。
//
// これまでの再発防止は、原因の**手口**を1つずつ塞ぐ形だった
//   （themed の書き方 → 購読の有無 → memo/FlatList → ThemeRemount の壁）。
// 知っている手口しか塞げないので、新しい手口が現れるたびに再発した。5回目が
// 「React Compiler が themeGeneration() を定数へ畳む」だった（docs/THEME.md）。
//
// ここでは手口を問わない。**4タブを実際に描画して明暗を反転し、
// 画面のどこかに前のパレットの色が1つでも残っていたら落とす。**
// 原因が memo でも Animated でもコンパイラでも将来の何かでも、症状が出れば必ず捕まる。
//
// 走る変換は jest.config.js が app.json（experiments.reactCompiler）から決める＝
// **実機に載るのと同じプログラム**を検証している。
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { setTheme, paletteFor, darkPaletteFor, type ThemeMode } from '@/lib/theme';
import type { Palette } from '@/lib/ui';

// expo-router を差し替える（画面は遷移しない。plusEntry.test.tsx と同じ流儀）
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: () => () => {}, isFocused: () => true }),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  usePathname: () => '/log',
  useSegments: () => ['(tabs)', 'log'],
  useFocusEffect: (cb: () => void) => { const React = require('react'); React.useEffect(() => cb(), []); },
  Redirect: () => null,
  Tabs: () => null,
  Link: () => null,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

import LogScreen from '../app/(tabs)/log';
import TrainingScreen from '../app/(tabs)/training';
import CoachScreen from '../app/(tabs)/coach';
import ChangesScreen from '../app/(tabs)/changes';
// タブの外（スタック画面）は ThemeRemount の壁を持たない＝購読だけが頼り。ここも同じ網にかける
import SettingsScreen from '../app/settings';
import PaywallScreen from '../app/paywall';
import AchievementsScreen from '../app/achievements';
import LawsScreen from '../app/laws';
import NutrientRankScreen from '../app/nutrient-rank';
import LiftSessionScreen from '../app/lift-session';
import WeeklyReviewScreen from '../app/weekly-review';
import { GuideProvider } from '../components/GuideTour';

jest.useFakeTimers();

// 検査に使うアクセント。ライト側の値が「たまたま書かれた固定色」と衝突しにくい色相を選ぶ
const ACCENT = 'rose' as const;
const LIGHT = paletteFor(ACCENT, 'strong');
const DARK = darkPaletteFor(ACCENT);

/** 片方のパレットにしか出てこない色（＝見つかったら取り残し確定）。
 *  白・黒は「アクセント塗りの上の白文字」などで意図的に直書きされるので除く */
const GENERIC = new Set(['#ffffff', '#fff', '#000', '#000000', 'transparent', 'white', 'black']);
function onlyIn(a: Palette, b: Palette): Set<string> {
  const other = new Set(Object.values(b).map((v) => String(v).toLowerCase()));
  const out = new Set<string>();
  for (const v of Object.values(a)) {
    const s = String(v).toLowerCase();
    if (!other.has(s) && !GENERIC.has(s)) out.add(s);
  }
  return out;
}
const LIGHT_ONLY = onlyIn(LIGHT, DARK);
const DARK_ONLY = onlyIn(DARK, LIGHT);

/** 色が入りうる prop 名（style の中と、直接渡す色 prop の両方を見る） */
const COLOR_KEYS = new Set([
  'color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor',
  'borderLeftColor', 'borderRightColor', 'shadowColor', 'tintColor', 'placeholderTextColor',
  'fill', 'stroke', 'textDecorationColor',
]);

/**
 * ツリー全体から「いま実際に使われている色」を、**どこで使われているか**付きで集める。
 * 落ちたときに犯人のファイルへ一発でたどり着けるよう、testID と祖先の道筋を残す。
 */
function colorsInTree(tree: ReactTestRenderer): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const at = (where: string, key: string, val: unknown) => {
    if (typeof val !== 'string' || !COLOR_KEYS.has(key)) return;
    const c = val.toLowerCase();
    const list = found.get(c) ?? [];
    if (list.length < 3 && !list.includes(`${where}.${key}`)) list.push(`${where}.${key}`);
    found.set(c, list);
  };
  const walkStyle = (where: string, st: unknown) => {
    if (!st) return;
    if (Array.isArray(st)) { for (const x of st) walkStyle(where, x); return; }
    if (typeof st !== 'object') return;
    for (const [k, v] of Object.entries(st as Record<string, unknown>)) at(where, k, v);
  };
  const walk = (node: unknown, trail: string) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, trail); return; }
    const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] };
    const id = typeof n.props?.testID === 'string' ? `#${n.props.testID}`
      : typeof n.props?.accessibilityLabel === 'string' ? `@${n.props.accessibilityLabel}` : '';
    // 直近4段だけ残す（全部つなぐと読めない）
    const where = [...trail.split('>').filter(Boolean), `${n.type ?? '?'}${id}`].slice(-4).join('>');
    if (n.props) {
      walkStyle(where, n.props.style);
      for (const [k, v] of Object.entries(n.props)) at(where, k, v);
    }
    // テキストは中身も手がかりになる（「26日連続で記録できています」等）
    const text = (n.children ?? []).filter((c) => typeof c === 'string').join('').slice(0, 14);
    const label = text ? `${where}("${text}")` : where;
    if (n.props) walkStyle(label, n.props.style);
    if (n.children) for (const c of n.children) walk(c, where);
  };
  walk(tree.toJSON() as unknown, '');
  return found;
}

/** 取り残しを「色 → 使われている場所」の形で返す（失敗メッセージがそのまま調査メモになる） */
function leftoversOf(tree: ReactTestRenderer, banned: Set<string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [c, where] of colorsInTree(tree)) if (banned.has(c)) out[c] = where;
  return out;
}

async function mount(el: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = renderer.create(<GuideProvider>{el}</GuideProvider>); });
  await act(async () => { jest.advanceTimersByTime(2000); });
  return tree;
}
async function switchTo(mode: ThemeMode) {
  await act(async () => { await setTheme({ accent: ACCENT, bg: 'strong', mode }); });
  await act(async () => { jest.advanceTimersByTime(500); });
}

const TABS: [string, () => React.ReactElement][] = [
  ['食事', () => <LogScreen />],
  ['運動', () => <TrainingScreen />],
  ['相談', () => <CoachScreen />],
  ['概要', () => <ChangesScreen />],
  ['設定', () => <SettingsScreen />],
  ['料金表', () => <PaywallScreen />],
  ['実績', () => <AchievementsScreen />],
  ['あなたの法則', () => <LawsScreen />],
  ['栄養ランキング', () => <NutrientRankScreen />],
  ['筋トレ記録', () => <LiftSessionScreen />],
  ['週のふりかえり', () => <WeeklyReviewScreen />],
];

describe('明暗を反転しても、前のパレットの色が1つも残らない', () => {
  afterAll(async () => { await act(async () => { await setTheme({ mode: 'system' }); }); });

  it.each(TABS)('%s タブ: ライト → ダーク', async (_name, make) => {
    await switchTo('light');
    const tree = await mount(make());
    // 反転前にライト固有の色が実際に使われている（＝この検査が空振りしていない）
    expect(Object.keys(leftoversOf(tree, LIGHT_ONLY)).length).toBeGreaterThan(0);

    await switchTo('dark');
    expect(leftoversOf(tree, LIGHT_ONLY)).toEqual({});
    await act(async () => { tree.unmount(); });
  });

  it.each(TABS)('%s タブ: ダーク → ライト', async (_name, make) => {
    await switchTo('dark');
    const tree = await mount(make());
    expect(Object.keys(leftoversOf(tree, DARK_ONLY)).length).toBeGreaterThan(0);

    await switchTo('light');
    expect(leftoversOf(tree, DARK_ONLY)).toEqual({});
    await act(async () => { tree.unmount(); });
  });
});
