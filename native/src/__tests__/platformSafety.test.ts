// プラットフォーム安全性の見張り（2026-09-04・Android 起動クラッシュの再発防止）。
//
// 症状: iOS は正常・Android は「一瞬で落ちる」。
// 構造: iOS のために入れた部品（HealthKit＝Nitro Modules 製）の依存 C++ ライブラリが、
//       使い手ゼロのまま Android のネイティブにリンクされ、さらに JS 側も Android で評価されていた。
//       safeBoot は _layout の effect しか守れないので、モジュール評価時・ネイティブ初期化時の失敗は素通りする。
//
// このテストは「同じ形の事故」が **コードレビュー無しで再発しない**ことを機械的に保証する。
// 新しく iOS 専用ライブラリを入れるときは、ここに登録して Android から外す。
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

/** iOS 専用ライブラリ。Android の autolink から外し、JS でも Platform で先に切ること */
const IOS_ONLY_NATIVE = ['@kingstinct/react-native-healthkit', 'react-native-nitro-modules'];

/** 直接依存として持たないもの。
 *  - expo-glass-effect / expo-symbols: アプリで一切使っていない iOS 専用モジュール
 *  - @expo/ui: expo-router（ネイティブタブ）の依存として入る。直接依存に書くと SDK 更新のたびに
 *    バージョンがずれ、Android のネイティブ登録時に不整合を起こす（2026-09-04 に 57.0.11 と 57.0.15 が同居していた）。
 *    expo-router に任せ、アプリ側の package.json には書かない */
const BANNED_DEPS = ['@expo/ui', 'expo-glass-effect', 'expo-symbols'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

describe('platformSafety: iOS 専用ネイティブが Android に漏れない', () => {
  const cfgPath = path.join(ROOT, 'react-native.config.js');

  it('react-native.config.js が存在し、iOS 専用ライブラリを Android の autolink から外している', () => {
    expect(fs.existsSync(cfgPath)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require(cfgPath) as { dependencies?: Record<string, { platforms?: { android?: unknown } }> };
    for (const name of IOS_ONLY_NATIVE) {
      const d = cfg.dependencies?.[name];
      expect(d && d.platforms && 'android' in d.platforms).toBe(true);
      expect(d!.platforms!.android).toBeNull();
    }
  });

  it('iOS 専用ライブラリをモジュールスコープで import しているファイルが無い（require は Platform で切ってから）', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const src = fs.readFileSync(f, 'utf8');
      for (const name of IOS_ONLY_NATIVE) {
        // 静的 import はバンドル評価時に必ず実行される＝Android で逃げ道が無い
        if (new RegExp(`^import[^\\n]*from ['"]${name.replace(/[/\\]/g, '\\$&')}['"]`, 'm').test(src)) {
          offenders.push(path.relative(ROOT, f) + ' → ' + name);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('health.ts は Android で HealthKit の JS を評価しない（require の前に Platform.OS !== "ios" で return）', () => {
    const src = fs.readFileSync(path.join(SRC, 'lib', 'health.ts'), 'utf8');
    const i = src.indexOf("require('@kingstinct/react-native-healthkit')");
    expect(i).toBeGreaterThan(0);
    const before = src.slice(Math.max(0, i - 400), i);
    expect(before).toMatch(/Platform\.OS !== 'ios'\) return null/);
  });
});

describe('platformSafety: 使っていない・Android 実装が不安定な依存を持たない', () => {
  it('dependencies に禁止パッケージが無い', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require(path.join(ROOT, 'package.json')) as { dependencies?: Record<string, string> };
    const present = BANNED_DEPS.filter((n) => pkg.dependencies && n in pkg.dependencies);
    expect(present).toEqual([]);
  });

  it('禁止パッケージをアプリのコードから直接 import しているファイルが無い（@expo/ui は expo-router 経由でのみ使う）', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const src = fs.readFileSync(f, 'utf8');
      for (const name of BANNED_DEPS) {
        if (src.includes(`'${name}'`) || src.includes(`"${name}"`)) offenders.push(path.relative(ROOT, f) + ' → ' + name);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('platformSafety: app.json', () => {
  it('旧 top-level splash を持たない（expo-splash-screen plugin に一本化・expo-doctor のスキーマ違反を防ぐ）', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const app = require(path.join(ROOT, 'app.json')) as { expo: Record<string, unknown> };
    expect('splash' in app.expo).toBe(false);
    const plugins = app.expo.plugins as unknown[];
    expect(plugins.some((p) => Array.isArray(p) && p[0] === 'expo-splash-screen')).toBe(true);
  });
});
