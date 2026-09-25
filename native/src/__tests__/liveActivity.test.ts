// Live Activity（ダイナミックアイランドのレスト残り時間）の安全装置（2026-09-17・2026-09-25 既定ON）。
//
// この機能は**ビルドを落としうる**種類の変更を持ち込む:
//   ・Widget Extension ターゲットが増える（3つ目の Bundle ID・App Group・署名）
//   ・拡張ターゲットの pod リンク（expo/expo#44695。expo-widgets 57 の autolinking.rb は
//     expo / expo-widgets / @expo/ui 以外を除外するので BodyLog の AdMob / RevenueCat / HealthKit は入らない）
//
// 2026-09-25 から iOS ビルドの**既定で入る**（熊田さん「ダイナミックアイランドでの通知にして」）。
// だから固定するのは「既定で入っていること」と「退避スイッチ DISABLE_LIVE_ACTIVITY=true で
// app.json を1文字も変えずに返すこと」。退避が壊れると、落ちたときに戻る道が無くなる。
//
// 併せて「無い環境では静かに no-op」（Android・Expo Go・設定でオフ・拡張なしビルド）も固定する。
import fs from 'fs';
import path from 'path';
import { startRestActivity, endRestActivity, cleanupRestActivities } from '@/lib/restActivity';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

type Cfg = (a: { config: unknown }) => { plugins: unknown[]; ios: { infoPlist: Record<string, unknown> } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cfg = require(path.join(ROOT, 'app.config.js')) as Cfg;
const base = () => ({ plugins: ['expo-router'], ios: { infoPlist: { Existing: 1 } } });

afterEach(() => { delete process.env.DISABLE_LIVE_ACTIVITY; delete process.env.ENABLE_LIVE_ACTIVITY; });

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

describe('既定で入る／退避スイッチで元に戻る（ゲート）', () => {
  it('app.json の plugins に expo-widgets を書かない（ゲートは app.config.js に置く＝退避スイッチが効く）', () => {
    const app = JSON.parse(read('app.json')) as { expo: { plugins: unknown[] } };
    expect(JSON.stringify(app.expo.plugins)).not.toContain('expo-widgets');
  });

  it('DISABLE_LIVE_ACTIVITY が true 以外なら plugin と NSSupportsLiveActivities が足される（既定ON）', () => {
    for (const v of [undefined, 'false', '0', '', 'TRUE']) {
      delete process.env.DISABLE_LIVE_ACTIVITY;
      if (v !== undefined) process.env.DISABLE_LIVE_ACTIVITY = v;
      const b = base();
      const out = cfg({ config: b });
      expect(out).not.toBe(b);
      expect(out.ios.infoPlist.NSSupportsLiveActivities).toBe(true);
      expect(out.ios.infoPlist.Existing).toBe(1);               // 既存のキーを消さない
      expect(out.plugins[0]).toBe('expo-router');               // 既存の plugin を消さない
      const added = out.plugins[out.plugins.length - 1] as [string, Record<string, unknown>];
      expect(added[0]).toBe('expo-widgets');
      expect(added[1].bundleIdentifier).toBe('com.gotcha.bodylog.rn.liveactivity');
      expect(added[1].groupIdentifier).toBe('group.com.gotcha.bodylog.rn');   // ホームウィジェットと同じ App Group
      expect(added[1].enablePushNotifications).toBe(false);      // OS が数えるので更新のプッシュは要らない
      expect(added[1].widgets).toBeUndefined();                  // Live Activity は widgets[] に書かない（公式の明記事項）
      expect(added[1].enableAndroid).toBeUndefined();            // Android ビルドは無変更（既定 false）
    }
  });

  it('DISABLE_LIVE_ACTIVITY=true なら app.json をそのまま返す（退避＝導入前のビルドと同一）', () => {
    process.env.DISABLE_LIVE_ACTIVITY = 'true';
    const b = base();
    expect(cfg({ config: b })).toBe(b);   // 同一オブジェクト＝1文字も足していない
  });

  it('旧スイッチ ENABLE_LIVE_ACTIVITY はもう何もしない（付け忘れで島が消える事故を作らない）', () => {
    for (const v of ['true', 'false']) {
      process.env.ENABLE_LIVE_ACTIVITY = v;
      const out = cfg({ config: base() });
      expect(out.ios.infoPlist.NSSupportsLiveActivities).toBe(true);
    }
  });

  it('codemagic.yaml も同じ退避スイッチで止まる（app.config.js と yaml が食い違わない）', () => {
    const yaml = fs.readFileSync(path.join(ROOT, '..', 'codemagic.yaml'), 'utf8');
    expect(yaml).toContain('DISABLE_LIVE_ACTIVITY');
    expect(yaml).not.toContain('ENABLE_LIVE_ACTIVITY');
    // 退避スイッチは vars に書かない（書くと「普段のビルドが常に退避」になる）
    expect(yaml).not.toMatch(/^\s*DISABLE_LIVE_ACTIVITY:\s*"?true"?\s*$/m);
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

  it('終了後の表示は isStale（staleDate＝終了時刻）で切り替える＝アプリが止まっていても 0:00 が居座らない', () => {
    expect(src()).toContain('isStale');
    expect(src()).toContain('doneLabel');
    // アプリ側が staleDate と訳文を渡している
    const app = read('src/lib/restActivity.ts');
    expect(app).toContain('new Date(endsAtMs)');
    expect(app).toMatch(/doneLabel:\s*t\('レスト終了'\)/);
  });
});
