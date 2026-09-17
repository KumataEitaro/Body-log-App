// Live Activity（ダイナミックアイランドのレスト残り時間）の安全装置（2026-09-17）。
//
// この機能は**ビルドを落としうる**種類の変更を持ち込む:
//   ・Widget Extension ターゲットが増える（3つ目の Bundle ID・App Group・署名）
//   ・拡張ターゲットが全 pod を autolink する既知の問題（expo/expo#44695）。
//     BodyLog は AdMob / RevenueCat / HealthKit を抱えているので踏む可能性が実在する
//
// だから「既定のビルドは一切変わらない」ことを機械で固定する。
// ここが崩れると、Live Activity と無関係な普段のリリースまで巻き添えで落ちる。
//
// 併せて「無い環境では静かに no-op」（Android・Expo Go・設定でオフ・拡張なしビルド）も固定する。
import fs from 'fs';
import path from 'path';
import { startRestActivity, endRestActivity, cleanupRestActivities } from '@/lib/restActivity';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('無い環境では静かに no-op', () => {
  // jest には expo-widgets のネイティブが無い＝「拡張なしでビルドした iPhone」と同じ状況
  it('開始・終了・掃除のどれも例外を投げない', async () => {
    expect(() => startRestActivity(Date.now(), Date.now() + 90_000, '懸垂')).not.toThrow();
    await expect(endRestActivity()).resolves.toBeUndefined();
    await expect(cleanupRestActivities()).resolves.toBeUndefined();
  });

  it('一瞬で終わるレストには出さない（出しても邪魔なだけ）', () => {
    expect(() => startRestActivity(Date.now(), Date.now() + 500, '')).not.toThrow();
  });
});

describe('既定のビルドを変えない（ゲート）', () => {
  it('app.json の plugins に expo-widgets を書かない（書くと全ビルドに拡張が入る）', () => {
    const app = JSON.parse(read('app.json')) as { expo: { plugins: unknown[] } };
    const flat = JSON.stringify(app.expo.plugins);
    expect(flat).not.toContain('expo-widgets');
  });

  it('ENABLE_LIVE_ACTIVITY が立っていなければ app.config.js は app.json をそのまま返す', () => {
    const base = { plugins: ['expo-router'], ios: { infoPlist: { Existing: 1 } } };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require(path.join(ROOT, 'app.config.js')) as (a: { config: unknown }) => unknown;
    for (const v of [undefined, 'false', '1', 'TRUE']) {
      delete process.env.ENABLE_LIVE_ACTIVITY;
      if (v !== undefined) process.env.ENABLE_LIVE_ACTIVITY = v;
      expect(cfg({ config: base })).toBe(base);   // 同一オブジェクト＝1文字も足していない
    }
    delete process.env.ENABLE_LIVE_ACTIVITY;
  });

  it('ENABLE_LIVE_ACTIVITY=true のときだけ plugin と NSSupportsLiveActivities が足される', () => {
    const base = { plugins: ['expo-router'], ios: { infoPlist: { Existing: 1 } } };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require(path.join(ROOT, 'app.config.js')) as (a: { config: unknown }) => {
      plugins: unknown[]; ios: { infoPlist: Record<string, unknown> };
    };
    process.env.ENABLE_LIVE_ACTIVITY = 'true';
    const out = cfg({ config: base });
    delete process.env.ENABLE_LIVE_ACTIVITY;

    expect(out.ios.infoPlist.NSSupportsLiveActivities).toBe(true);
    expect(out.ios.infoPlist.Existing).toBe(1);               // 既存のキーを消さない
    expect(out.plugins[0]).toBe('expo-router');               // 既存の plugin を消さない
    const added = out.plugins[out.plugins.length - 1] as [string, Record<string, unknown>];
    expect(added[0]).toBe('expo-widgets');
    expect(added[1].bundleIdentifier).toBe('com.gotcha.bodylog.rn.liveactivity');
    expect(added[1].groupIdentifier).toBe('group.com.gotcha.bodylog.rn');   // ホームウィジェットと同じ App Group
    expect(added[1].enablePushNotifications).toBe(false);      // OS が数えるので更新のプッシュは要らない
    expect(added[1].widgets).toBeUndefined();                  // Live Activity は widgets[] に書かない（公式の明記事項）
  });

  it('@expo/ui は直接依存にせず overrides で1本に固定する（二重インストールで Podfile が壊れる）', () => {
    // expo-router は ^57.0.15、expo-widgets は ~57.0.18 を要求する。放っておくと
    // node_modules に2つ入り、expo/expo#44707（Invalid Podfile）と 2026-09-04 の
    // Android ネイティブ登録の不整合を同時に踏む
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>; overrides?: Record<string, string>;
    };
    expect(pkg.dependencies['@expo/ui']).toBeUndefined();
    expect(pkg.overrides?.['@expo/ui']).toBeTruthy();
  });
});

describe("'widget' 関数の制約（別ランタイムで走る）", () => {
  const src = () => read('src/liveactivity/RestActivity.tsx');

  it("'widget' ディレクティブがある（無いと拡張側のバンドルに入らない）", () => {
    expect(src()).toContain("'widget';");
  });

  it('hooks・state・async・t() を使わない（隔離ランタイムでは動かない）', () => {
    const body = src().slice(src().indexOf("'widget';"));
    expect(body).not.toMatch(/\buse[A-Z]\w*\(/);   // useState / useEffect / useMemo …
    expect(body).not.toMatch(/\basync\b|\bawait\b/);
    expect(body).not.toMatch(/\bt\(/);             // 文言はアプリ側で訳して props で渡す
  });

  it('カウントダウンは OS に数えさせる（timerInterval。毎秒の update を書かない）', () => {
    expect(src()).toContain('timerInterval');
    expect(src()).toContain('countsDown');
    expect(src()).not.toMatch(/setInterval|\.update\(/);
  });
});
