/// <reference types="node" />
// UI規約の機械チェック（2026-09-02 自己監査 docs/SELF-AUDIT-1.1.md の再発防止）。
// themeConvention.test.ts が「色」を守るのと同じ流儀で、ここは
// 「文字サイズ・残骸ファイル・ヒーロー直下の調停・日付跨ぎ・確認語・Modalの重なり」を守る。
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__') sourceFiles(p, out); }
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const FILES = sourceFiles(SRC);
const rel = (p: string) => p.slice(SRC.length + 1).replace(/\\/g, '/');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('文字サイズの下限', () => {
  it('fontSize は 11 以上（画面に出る文字。写真に載せる共有ステッカーだけ例外）', () => {
    // 10px 以下は iOS の最小可読サイズを割る。ヒント・凡例・NEWピルで 9.5〜10.5 が散っていた
    const ALLOW = new Set(['components/ShareSticker.tsx']);   // 透過PNGとして描画され、IGで拡大表示される
    const offenders: string[] = [];
    for (const f of FILES) {
      if (ALLOW.has(rel(f))) continue;
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)\b/g)) {
        if (Number(m[1]) < 11) offenders.push(`${rel(f)}: fontSize ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('Expo テンプレートの残骸', () => {
  it('未使用のテンプレート部品が復活していない', () => {
    // create-expo-app の雛形。どこからも参照されず、themed() 規約にも乗っていない
    const GONE = [
      'components/themed-text.tsx', 'components/themed-view.tsx', 'components/hint-row.tsx',
      'components/ui/collapsible.tsx', 'components/app-tabs.web.tsx', 'components/external-link.tsx',
      'components/animated-icon.web.tsx', 'components/animated-icon.module.css', 'components/Placeholder.tsx',
      'constants/theme.ts', 'hooks/use-theme.ts', 'hooks/use-color-scheme.ts', 'hooks/use-color-scheme.web.ts',
      'global.css',
    ];
    expect(GONE.filter((p) => existsSync(join(SRC, p)))).toEqual([]);
  });
});

describe('食事タブのヒーロー直下は調停を通す', () => {
  it('注意喚起カード・帯の表示条件が attention.* を参照している（勝手に自分を出すカードを増やさない）', () => {
    const log = read('app/(tabs)/log.tsx');
    expect(log).toMatch(/arbitrateAttention\(/);
    for (const key of ['caution', 'backfill', 'checklist', 'mood', 'positive', 'badge', 'firstLaw', 'brief']) {
      expect(log).toMatch(new RegExp(`attention\\.${key}\\b`));
    }
  });
  it('食事タブ・運動タブは日付跨ぎの追従（useTodayRollover）を持つ', () => {
    for (const p of ['app/(tabs)/log.tsx', 'app/(tabs)/training.tsx']) {
      expect(read(p)).toMatch(/useTodayRollover\(viewDate, setViewDate\)/);
    }
  });
  it('「今日か」の判定は todayKey に統一（描画中に todayJST() を直接比較しない）', () => {
    // その日1回系（気分・穴埋め・過食リスク）が日付跨ぎで組み直されるのは todayKey を依存に持つから。
    // viewDate === todayJST() を直接書くと、0時をまたいだ瞬間に判定だけ先に変わって effect が追従しない
    const log = read('app/(tabs)/log.tsx');
    expect(log).not.toMatch(/viewDate === todayJST\(\)/);
  });
});

describe('アカウント削除の確認語', () => {
  it('原文「削除」との直接比較を画面に書かない（lib/guard.ts deleteConfirmMatches を通す）', () => {
    const settings = read('app/settings.tsx');
    expect(settings).not.toMatch(/delConfirm\s*!==\s*'削除'/);
    expect(settings).toMatch(/deleteConfirmMatches\(delConfirm\)/);
  });
});

describe('Modalの重なり（iOSは表示中のModalの兄弟に別のModalを出せない）', () => {
  it('入力シートは閉じ切ってから案内スポットライトを出す（onDismiss で流す）', () => {
    const log = read('app/(tabs)/log.tsx');
    expect(log).toMatch(/presentationStyle="pageSheet"[^>]*onDismiss=\{flushPendingTip\}/);
    // 保存直後の案内は setSuggest / setDietTip を直接呼ばず queueTip 経由
    expect(log).toMatch(/queueTip\(\(\) => setSuggest\(/);
    expect(log).toMatch(/queueTip\(\(\) => setDietTip\(true\)\)/);
  });
  it('＋シートの体重入力はキーボードに隠れない（KeyboardAvoidingView）', () => {
    expect(read('components/PlusSheet.tsx')).toMatch(/<KeyboardAvoidingView/);
  });
});

describe('翻訳の取りこぼし', () => {
  it('通知センターの文言（lib/todos.ts）は生成側で t() に通す（動的な文はキーとして辞書に載らないため）', () => {
    const todos = read('lib/todos.ts');
    // 行頭の title:/detail: の直後が文字列リテラル（' " `）なら生の日本語＝取りこぼし
    const raw = [...todos.matchAll(/^\s+(title|detail):\s*['"`].*$/gm)];
    expect(raw.map((m) => m[0].trim())).toEqual([]);
  });
});

describe('設定への導線（2026-09-04・右上の⚙を廃止）', () => {
  // 入口が概要タブの「設定」ブロック1つだけになったので、ここが壊れると
  // アプリを消して入れ直す以外に設定へ戻る手段が無くなる。
  const changes = read('app/(tabs)/changes.tsx');

  it('概要タブに設定ブロックの4行が存在する', () => {
    // 目標設定・実績・通知センター・設定。どれか1つでも消えたら気づけるようにする
    for (const label of ['目標設定', '実績', '通知センター', '設定']) {
      expect(changes).toContain(`label: t('${label}')`);
    }
    expect(changes).toContain("const settingsBlock = (");
  });

  it('設定ブロックは並べ替え・非表示の対象に入っていない', () => {
    // SECTION_DEFS / ALL_ORDER_DEFAULT に設定系のキーが混ざると、ユーザーが自分で
    // 入口を非表示にできてしまう（＝設定に二度と辿り着けない）。
    // 設定ブロックは headerJSX に固定で描くこと
    const orderLine = changes.match(/const ALL_ORDER_DEFAULT = \[[^\]]*\]/)?.[0] ?? '';
    const sectionDefs = changes.match(/const SECTION_DEFS[\s\S]*?\n\];/)?.[0] ?? '';
    expect(orderLine).not.toBe('');
    expect(sectionDefs).not.toBe('');
    for (const key of ['settings', 'goal', 'notice', 'achievements']) {
      expect(orderLine).not.toContain(`'${key}'`);
      expect(sectionDefs).not.toContain(`'${key}'`);
    }
  });

  it('HeaderGear はどこからも使われていない（復活したら落とす）', () => {
    // 復活させると「⚙とブロックの2つの入口」になり、どちらが正かが曖昧になる。
    // 戻すなら意図的に戻す（このテストごと直す）
    const users = FILES.filter((f) => /HeaderGear/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(users).toEqual([]);
  });

  it('概要タブのセクション名が現行の呼称になっている', () => {
    for (const title of ['からだの変化', '食事の傾向', '運動の傾向']) {
      expect(changes).toContain(`t('${title}')`);
    }
  });
});
