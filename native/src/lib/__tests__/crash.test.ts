// クラッシュ計測（QA P1-8）。
//
// 固定したいこと:
//  1. 未処理のPromise拒否が reportCrash に届く（以前は ErrorUtils だけで、
//     リリースビルドでは1件も観測できなかった）
//  2. Hermes と非Hermes（JSC）で入り口が違うので、両方の経路を選べている
//  3. 連投ガードが「同一 name+message だけ」を間引く（種類が違うクラッシュを取りこぼさない）
jest.mock('promise/setimmediate/rejection-tracking', () => ({ enable: jest.fn() }));

import { reportCrash, installRejectionTracker, __resetCrashThrottle } from '../crash';

type Tracker = { allRejections: boolean; onUnhandled: (id: number, e: unknown) => void };
type G = typeof globalThis & {
  __DEV__?: boolean;
  HermesInternal?: { hasPromise?: () => boolean; enablePromiseRejectionTracker?: (o: Tracker) => void };
  fetch: jest.Mock;
};
const g = globalThis as G;

const rejectionTracking = require('promise/setimmediate/rejection-tracking') as { enable: jest.Mock };

/** 送信はマイクロタスク経由（void reportCrash）なので、キューを1周させてから確かめる */
const flush = () => new Promise((r) => setTimeout(r, 0));

let devBefore: boolean | undefined;
let fetchBefore: unknown;

beforeEach(() => {
  devBefore = g.__DEV__;
  fetchBefore = g.fetch;
  // 本番ビルド相当。__DEV__ ではRNがLogBox用のトラッカーを入れているので意図的に何もしない
  g.__DEV__ = false;
  g.fetch = jest.fn(async () => ({ ok: true }) as unknown as Response);
  delete g.HermesInternal;
  rejectionTracking.enable.mockClear();
  __resetCrashThrottle();
});

afterEach(() => {
  g.__DEV__ = devBefore;
  g.fetch = fetchBefore as jest.Mock;
  delete g.HermesInternal;
});

/** 送信されたクラッシュ本文（新しい順ではなく呼ばれた順） */
function sentBodies(): { name: string; message: string; stack?: string }[] {
  return g.fetch.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body));
}

describe('未処理のPromise拒否', () => {
  it('Hermes版のトラッカー経由で reportCrash に届く', async () => {
    let captured: Tracker | null = null;
    g.HermesInternal = {
      hasPromise: () => true,
      enablePromiseRejectionTracker: (o: Tracker) => { captured = o; },
    };

    expect(installRejectionTracker()).toBe('hermes');
    const opts = captured as Tracker | null;
    expect(opts).not.toBeNull();
    expect(opts!.allRejections).toBe(true);

    opts!.onUnhandled(1, new Error('ネットワークが切れました'));
    await flush();

    expect(g.fetch).toHaveBeenCalledTimes(1);
    expect(sentBodies()[0]).toMatchObject({ name: 'Error', message: 'ネットワークが切れました' });
  });

  it('Hermesが無ければ promise ポリフィルの rejection-tracking を使う', async () => {
    expect(installRejectionTracker()).toBe('polyfill');
    expect(rejectionTracking.enable).toHaveBeenCalledTimes(1);
    const opts = rejectionTracking.enable.mock.calls[0][0] as Tracker;
    expect(opts.allRejections).toBe(true);

    opts.onUnhandled(2, new Error('boom'));
    await flush();
    expect(sentBodies()[0]).toMatchObject({ name: 'Error', message: 'boom' });
  });

  it('Hermesが Promise を持たないビルドではポリフィル側に落ちる', () => {
    g.HermesInternal = { hasPromise: () => false };
    expect(installRejectionTracker()).toBe('polyfill');
  });

  it('Errorでない値を投げられても落ちずに送る', async () => {
    expect(installRejectionTracker()).toBe('polyfill');
    const opts = rejectionTracking.enable.mock.calls[0][0] as Tracker;
    opts.onUnhandled(3, 'ただの文字列');
    opts.onUnhandled(4, { code: 42 });
    await flush();
    const bodies = sentBodies();
    expect(bodies[0]).toMatchObject({ name: 'UnhandledRejection', message: 'ただの文字列' });
    expect(bodies[1].message).toContain('42');
  });

  it('__DEV__ では入れない（RNのLogBox用トラッカーを上書きしない）', () => {
    g.__DEV__ = true;
    expect(installRejectionTracker()).toBe('skipped-dev');
    expect(rejectionTracking.enable).not.toHaveBeenCalled();
  });
});

describe('連投ガード', () => {
  it('同一の name+message は1分に1件に絞る', async () => {
    await reportCrash('TypeError', 'x is not a function');
    await reportCrash('TypeError', 'x is not a function');
    expect(g.fetch).toHaveBeenCalledTimes(1);
  });

  it('種類が違うクラッシュは通す（起動直後の別種を取りこぼさない）', async () => {
    // 以前は「1分1件」が内容に関係なく先に走り、最初の1件しか送られなかった（QA P1-8 の副次指摘）
    await reportCrash('TypeError', 'x is not a function');
    await reportCrash('RangeError', 'Maximum call stack size exceeded');
    await reportCrash('TypeError', '別のメッセージ');
    expect(g.fetch).toHaveBeenCalledTimes(3);
  });
});
