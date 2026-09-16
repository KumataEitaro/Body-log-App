// 画面遷移の一貫性を機械で見張る（2026-09-16・熊田さんの指摘から）。
//
// 指摘の中身:
//   「概要にあるもののうち『設定』だけ左上が『戻る』になっている。
//     ほかの『体の記録』とかほとんどは『＜概要』になっている」
//
// 実際に調べると、**タブ外のスタック画面は全部「戻る」**（設定・実績・法則図鑑・栄養ランキング・
// 週次レビュー・筋トレ記録・ペイウォール）で、**概要タブの中の詳細ページだけが「‹ 概要」**だった。
// 同じアプリの中に「行き先を名乗る」流儀と「汎用の戻る」の流儀が同居していた。
//
// iOS の作法では戻るボタンは前の画面の名前を出す。ところがスタック画面は複数のタブから開かれるので
// （実績は 概要・食事・設定・🔥チップの4か所）、固定文字では正しく名乗れない。
// **開く側が `?from=` を渡し、開かれた側がそれを表示する**形にした。
// このテストは「渡し忘れ」と「画面ごとのヘッダー設定の揺れ」を両方見張る。
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

describe('戻るボタンは「どこから来たか」を名乗る', () => {
  it.each(STACK_SCREENS)('%s は戻るラベルを固定文字で書いていない', (f) => {
    const src = read(f);
    // 旧実装の名残。これがあると、どこから来ても「戻る」になる
    expect(src).not.toMatch(/headerBackTitle: t\('戻る'\)/);
  });

  it.each(STACK_SCREENS)('%s は from からラベルを作っている', (f) => {
    const src = read(f);
    const usesShared = src.includes('useStackHeader()');
    const usesLabel = src.includes('fromLabel(backFrom)') && src.includes('useNavFromParam()');
    expect(usesShared || usesLabel).toBe(true);
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

  it('画面ごとに headerTintColor を手書きしていない（共通化から外れた画面を見つける）', () => {
    const offenders = STACK_SCREENS.filter((f) => {
      const src = read(f);
      // 共通の options を使っていれば手書きは不要。独自ヘッダーの3画面だけ例外
      const custom = ['app/settings.tsx', 'app/lift-session.tsx', 'app/weekly-review.tsx'].includes(f);
      return !custom && /headerTintColor/.test(src);
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

describe('概要タブの最上部ブロックは、見出しと中身が一致している', () => {
  const src = read('app/(tabs)/changes.tsx');

  it('見出しが「設定」ではない（中身は実績・通知・目標・設定の4つで、設定は1つだけ）', () => {
    const block = src.slice(src.indexOf('const settingsBlock'), src.indexOf('const headerJSX'));
    expect(block).not.toMatch(/sectionH}>\{t\('設定'\)\}/);
    expect(block).toMatch(/sectionH}>\{t\('あなたの記録と設定'\)\}/);
  });

  it('「設定」の行はブロックのいちばん最後（いちばん奥の階層）', () => {
    const block = src.slice(src.indexOf('const settingsBlock'), src.indexOf('const headerJSX'));
    const keys = [...block.matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
    expect(keys[keys.length - 1]).toBe('settings');
  });
});
