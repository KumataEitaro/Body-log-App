// 画面遷移の一貫性を機械で見張る（2026-09-16・熊田さんの指摘から）。
//
// 2026-09-26 熊田さん: **戻るボタンはすべて「戻る」に統一**（「‹ 概要」のように行き先を名乗らない）。
//   2026-09-16 の「開く側が ?from= を渡し、開かれた側が名乗る」流儀は、概要タブの中の詳細ページや
//   from を渡し忘れた入口で「戻る」のままになり、2つの流儀がずっと同居していた（漏れる構造）。
//   いまの規則: 文言は lib/navHeader.ts の fromLabel / stackHeaderOptions が**常に「戻る」**を返す。
//   `?from=` は ts ノンスと筋トレ記録の戻り先判定にだけ使う（表示には使わない）。
//
// このテストは静的に3つの角度から見張る（実行時の角度は __tests__/navHeader.test.ts）:
//   (1) 戻るラベルの文言が「戻る」以外に決まる書き方が無い（行き先名・テンプレート・display mode）
//   (2) 全スタック画面のヘッダーが共通の options（stackHeaderOptions）か、fromLabel 経由である
//   (3) タブ内の自前の戻る行（概要の詳細ページ）も「戻る」である
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');

/** タブ外のスタック画面（= 戻るボタンを持つ画面） */
const STACK_SCREENS = [
  'app/settings.tsx',
  'app/achievements.tsx',
  'app/laws.tsx',
  'app/law-detail.tsx',
  'app/nutrient-rank.tsx',
  'app/weekly-review.tsx',
  'app/lift-session.tsx',
  'app/paywall.tsx',
];

/** そこへ push する側のファイル。`from` を渡す義務がある */
const PUSH_SITES = [
  'app/(tabs)/changes.tsx',
  'app/(tabs)/coach.tsx',
  'app/(tabs)/log.tsx',
  'app/(tabs)/training.tsx',
  'app/settings.tsx',
  'components/LeanBulkCard.tsx',
  'components/LiftingProgress.tsx',
  'components/RestTimerBar.tsx',     // レスト中の帯 → 筋トレ記録画面（いまいるタブを from にする）
  'components/PlusEntry.tsx',      // ＋シートの「筋トレ」→ 筋トレ記録画面（from は親タブが渡す）
  'components/StartChecklist.tsx',
  'components/StreakChip.tsx',
];

/**
 * 複数の画面から使われるため、行き先を1つに決められない部品。
 * `from` を渡さず「戻る」に落とす。増やすときは**理由を書くこと**。
 */
const NO_FROM_ALLOWED = [
  'components/ColumnReader.tsx',   // 相談タブと設定の両方から描かれる
];

const SCREEN_RE = '(settings|achievements|laws|law-detail|nutrient-rank|weekly-review|lift-session|paywall)';

describe('戻るボタンは常に「戻る」（2026-09-26・行き先を名乗らない）', () => {
  it('lib/navHeader.ts の fromLabel は引数を見ずに t(\'戻る\') を返す（switch で行き先名を返す旧実装が無い）', () => {
    const src = read('lib/navHeader.ts');
    const fn = src.slice(src.indexOf('export function fromLabel'), src.indexOf('export function stackHeaderOptions'));
    expect(fn).toMatch(/return t\('戻る'\);/);
    expect(fn).not.toMatch(/switch \(/);
    expect(fn).not.toMatch(/case '/);
    // stackHeaderOptions は引数を取らない＝画面ごとに戻るラベルを変えられない
    expect(src).toMatch(/export function stackHeaderOptions\(\) \{/);
    expect(src).toMatch(/headerBackTitle: t\('戻る'\)/);
    // iOS が横幅不足でラベルを省くのを許さない（'minimal' 禁止）
    expect(src).toMatch(/headerBackButtonDisplayMode: 'default'/);
  });

  it.each(STACK_SCREENS)('%s のヘッダーは共通 options か fromLabel 経由で、戻るラベルを別の文字にしていない', (f) => {
    const src = read(f);
    const usesShared = src.includes('useStackHeader()');
    const usesLabel = src.includes('headerBackTitle: fromLabel(');
    expect(usesShared || usesLabel).toBe(true);
    // 「‹ 概要」「{name}へ戻る」のような行き先名を作る書き方が残っていない
    expect(src).not.toMatch(/headerBackTitle: t\('(?!戻る')/);
    expect(src).not.toMatch(/へ戻る/);
    expect(src).not.toMatch(/headerBackTitleVisible: false/);
    expect(src).not.toMatch(/headerBackButtonDisplayMode: 'minimal'/);
    expect(src).not.toMatch(/headerBackVisible: false/);
  });

  it('タブ内の自前の戻る行（概要タブの詳細ページ）も「戻る」', () => {
    const src = read('app/(tabs)/changes.tsx');
    const back = src.slice(src.indexOf('<Pressable style={s.backRow}'), src.indexOf('</Pressable>', src.indexOf('<Pressable style={s.backRow}')));
    expect(back).toMatch(/\{t\('戻る'\)\}/);
    expect(back).not.toMatch(/t\('概要'\)/);
  });

  it('ソース全体に「‹ 概要」「＜概要」式の戻る文言が無い（JSX 文字列・辞書キー）', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(rel); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        const src = read(rel);
        // 「‹ 概要」「< 食事」のように山括弧＋タブ名/画面名を文字列で書いている箇所
        if (/['"`][‹＜<]\s?(概要|食事|運動|相談|設定|実績)['"`]/.test(src)) offenders.push(rel);
        if (/t\('\{name\}へ戻る'\)/.test(src)) offenders.push(rel);
      }
    };
    walk('app'); walk('components'); walk('lib');
    expect(offenders).toEqual([]);
  });
});

describe('スタック画面へ push するときは from を渡す', () => {
  it.each(PUSH_SITES)('%s の push はすべて navFrom を伴う', (f) => {
    const src = read(f);
    // `'/xxx' as never` のような params 無しの push が残っていないか
    const bare = [...src.matchAll(new RegExp(`push\\('/${SCREEN_RE}'`, 'g'))].map((m) => m[0]);
    expect(bare).toEqual([]);
    // pathname 形式の push は navFrom を使っているか
    const withPath = [...src.matchAll(new RegExp(`pathname: '/${SCREEN_RE}', params: (\\w+)`, 'g'))];
    for (const m of withPath) expect(m[2]).toBe('navFrom');
  });

  it('from を渡さない部品は、理由つきで許可リストに載っているものだけ', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(rel); continue; }
        if (!/\.tsx$/.test(e.name)) continue;
        const src = read(rel);
        if (!new RegExp(`push\\(\\{? ?(pathname: )?'/${SCREEN_RE}'`).test(src)) continue;
        const known = PUSH_SITES.includes(rel) || NO_FROM_ALLOWED.includes(rel);
        if (!known) offenders.push(rel);
      }
    };
    walk('app');
    walk('components');
    // 新しく push を足したファイルは、PUSH_SITES か NO_FROM_ALLOWED のどちらかに必ず載せる
    expect(offenders).toEqual([]);
  });
});

describe('ヘッダーの見た目は1か所で決める', () => {
  it('lib/navHeader.ts が共通の options を持つ', () => {
    const src = read('lib/navHeader.ts');
    expect(src).toMatch(/export function stackHeaderOptions/);
    expect(src).toMatch(/headerTintColor: C\.teal/);
  });

  it('画面ごとに headerTintColor / headerLargeStyle を手書きしていない（共通化から外れた画面を見つける）', () => {
    const offenders = STACK_SCREENS.filter((f) => {
      const src = read(f);
      // 共通の options を使っていれば手書きは不要。独自ヘッダーの2画面だけ例外。
      // 設定は 2026-09-26 まで例外だった（不透明ヘッダー＋headerLargeStyle）。iOS 26+ ではそれが
      // 「戻る」の下の空白帯と、薄く二重に見える本文タイトルの原因だったので、共通化して例外から外した
      const custom = ['app/lift-session.tsx', 'app/weekly-review.tsx'].includes(f);
      return !custom && /headerTintColor:|headerLargeStyle:|headerLargeTitleStyle:/.test(src);   // コロン付き＝実際の prop 指定だけ（コメントの語は拾わない）
    });
    expect(offenders).toEqual([]);
  });
});

describe('バッジのカテゴリ順は 体重 → 運動 → 記録 → 継続', () => {
  it('CATS の並びが指定どおり（2026-09-16・熊田さん指定）', () => {
    const src = read('app/achievements.tsx');
    const m = src.match(/const CATS: BadgeCat\[\] = \[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const order = m![1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(order).toEqual(['body', 'move', 'action', 'streak']);
  });
});

describe('概要タブは4大項目（2026-09-26 熊田さん: 設定 → 食事の分析 → からだの分析 → 運動の分析。実績は末尾）', () => {
  const src = read('app/(tabs)/changes.tsx');

  it('最上部ブロックは「設定」の1行だけ（通知センター・目標設定の行は概要に出さない）', () => {
    const block = src.slice(src.indexOf('const settingsBlock'), src.indexOf('const headerJSX'));
    const keys = [...block.matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
    expect(keys).toEqual(['settings']);
    expect(src).not.toMatch(/key: 'notice'/);
    expect(src).not.toMatch(/key: 'goal', icon/);
    // 小見出し（あなたの記録と設定／からだの変化…）は廃止
    expect(block).not.toMatch(/sectionH/);
  });

  it('分析の3ページが 食事 → からだ → 運動 の順で、旧12行はページの中に積まれている', () => {
    expect(src).toMatch(/const ALL_ORDER_DEFAULT = \['food', 'body', 'training'\];/);
    const stacks = src.slice(src.indexOf('const DETAIL_STACKS'), src.indexOf('};', src.indexOf('const DETAIL_STACKS')));
    for (const k of ['slots', 'weekmap', 'trends', 'binge', 'digest', 'calendar', 'nutrientsLink']) expect(stacks).toMatch(new RegExp(`food: \\[[^\\]]*'${k}'`));
    for (const k of ['goal', 'kpi', 'chart', 'table', 'vitals', 'bulkguard', 'cycles', 'lawsLink', 'cycle']) expect(stacks).toMatch(new RegExp(`body: \\[[^\\]]*'${k}'`));
    for (const k of ['tkpi', 'tcal', 'tbal', 'tpart', 'tchart', 'tpr', 'tgoal', 'lifthist', 'health']) expect(stacks).toMatch(new RegExp(`training: \\[[^\\]]*'${k}'`));
  });

  it('生理周期はからだの分析ページの末尾に畳んで置く（パッと見せない）', () => {
    const stacks = src.slice(src.indexOf('const DETAIL_STACKS'), src.indexOf('};', src.indexOf('const DETAIL_STACKS')));
    expect(stacks).toMatch(/body: \[[^\]]*'cycle'\]/);   // 配列の末尾
    expect(src).toMatch(/const \[cycleOpen, setCycleOpen\] = useState\(false\)/);
    expect(src).toMatch(/\{cycleOpen && <MenstrualCycleCard/);
  });

  it('旧キーのディープリンク（open=strength / week / eating…）は3ページへ写像される', () => {
    const map = src.slice(src.indexOf('const PAGE_OF'), src.indexOf('};', src.indexOf('const PAGE_OF')));
    for (const [k, v] of [['eating', 'food'], ['week', 'food'], ['strength', 'training'], ['volume', 'training'], ['health', 'training'], ['vitals', 'body'], ['cycle', 'body']]) {
      expect(map).toMatch(new RegExp(`${k}: '${v}'`));
    }
  });

  it('実績の行は概要のいちばん下（メニュー行の並びのあと）に1本だけ出る', () => {
    const list = src.slice(src.indexOf('{visibleOrder.map((k) => <View key={k}>{menuRow(k)}</View>)}'), src.indexOf('</ScrollView>', src.indexOf('{visibleOrder.map((k) => <View key={k}>{menuRow(k)}</View>)}')));
    expect(list).toMatch(/\{achievementsRow\}/);
    expect((src.match(/key: 'achievements'/g) ?? []).length).toBe(1);
  });
});
