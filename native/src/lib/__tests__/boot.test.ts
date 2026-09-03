// safeBoot と起動時エラー記録の固定。
//
// 「1つの初期化がコケても他とレンダリングを止めない」がこの仕組みの全部なので、
// 同期throw・Promise拒否・thenableの3経路すべてで飲み込むことをここで固定する。
import {
  safeBoot, describeBootError, appendBootError, parseBootErrors,
  formatBootErrors, unsentBootErrors, markBootErrorsSent,
  BOOT_ERRORS_MAX, type BootError,
} from '../boot';

// console.warn は recordBootError が必ず呼ぶ（logcatに出す）。テスト出力を汚さないよう黙らせる
beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); });

const E = (name: string, message: string, at = '2026-09-03T00:00:00.000Z'): BootError =>
  ({ name, message, at, count: 1 });

describe('safeBoot（1つの失敗で他を止めない）', () => {
  it('成功時は戻り値をそのまま返す', () => {
    expect(safeBoot('ok', () => 42)).toBe(42);
  });

  it('同期throwを飲み込んでundefinedを返す（呼び出し側は落ちない）', () => {
    expect(safeBoot('boom', () => { throw new Error('sync'); })).toBeUndefined();
  });

  it('後始末関数をそのまま返す（useEffectのcleanupに使える）', () => {
    const cleanup = () => {};
    expect(safeBoot('sub', () => cleanup)).toBe(cleanup);
  });

  it('拒否されたPromiseを未処理拒否にしない', async () => {
    const p = safeBoot('reject', () => Promise.reject(new Error('async')));
    expect(p).toBeInstanceOf(Promise);
    // safeBootが拒否ハンドラを付けているので、awaitしなくても未処理拒否にならない。
    // ここでは「元のPromiseは拒否のまま」＝呼び出し側の挙動を変えないことを確認する
    await expect(p).rejects.toThrow('async');
  });

  it('await前にthrowするasync関数も拾う（同期に化けても拒否でも同じ扱い）', async () => {
    const fn = async () => { throw new Error('before await'); };
    const p = safeBoot('asyncThrow', fn);
    await expect(p).rejects.toThrow('before await');
  });

  it('catchを持たないthenableでも拒否ハンドラを付けられる', () => {
    let handler: ((e: unknown) => void) | undefined;
    const thenable = { then: (_ok: undefined, bad: (e: unknown) => void) => { handler = bad; } };
    safeBoot('thenable', () => thenable);
    expect(typeof handler).toBe('function');
    expect(() => handler?.(new Error('x'))).not.toThrow();
  });

  it('nullやundefinedを返す初期化でもthenを覗きに行かない', () => {
    expect(safeBoot('nul', () => null)).toBeNull();
    expect(safeBoot('undef', () => undefined)).toBeUndefined();
  });
});

describe('describeBootError（何がthrowされても文字列になる）', () => {
  it('Errorはname: message', () => {
    expect(describeBootError(new TypeError('nope'))).toBe('TypeError: nope');
  });

  it('文字列のthrowもそのまま読める', () => {
    expect(describeBootError('just a string')).toBe('just a string');
  });

  it('Errorではないがmessageを持つオブジェクト（ネイティブ側の拒否）も拾う', () => {
    expect(describeBootError({ name: 'NativeError', message: 'module missing' }))
      .toBe('NativeError: module missing');
  });

  it('null・undefinedでも壊れない', () => {
    expect(describeBootError(null)).toBe('unknown error');
    expect(describeBootError(undefined)).toBe('unknown error');
  });

  it('長すぎるメッセージは400文字に切る（端末を圧迫しない）', () => {
    expect(describeBootError('x'.repeat(1000))).toHaveLength(400);
  });
});

describe('appendBootError（新しい順・上限つき・同一は回数で畳む）', () => {
  it('新しいものが先頭に来る', () => {
    const list = appendBootError(appendBootError([], E('a', 'A')), E('b', 'B'));
    expect(list.map((x) => x.name)).toEqual(['b', 'a']);
  });

  it('同じname×messageは行を増やさず回数を足して先頭へ繰り上げる', () => {
    let list = appendBootError([], E('a', 'A'));
    list = appendBootError(list, E('b', 'B'));
    list = appendBootError(list, E('a', 'A', '2026-09-04T00:00:00.000Z'));
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ name: 'a', count: 2, at: '2026-09-04T00:00:00.000Z' });
  });

  it('再発したら送信済みの印が落ちる（また起きたことは送る価値がある）', () => {
    const list = appendBootError([{ ...E('a', 'A'), sent: true }], E('a', 'A'));
    expect(list[0].sent).toBeUndefined();
  });

  it('上限を超えたら古いものから捨てる', () => {
    let list: BootError[] = [];
    for (let i = 0; i < BOOT_ERRORS_MAX + 5; i++) list = appendBootError(list, E(`n${i}`, `m${i}`));
    expect(list).toHaveLength(BOOT_ERRORS_MAX);
    expect(list[0].name).toBe(`n${BOOT_ERRORS_MAX + 4}`);
  });

  it('元のリストを書き換えない（純関数）', () => {
    const src = [E('a', 'A')];
    appendBootError(src, E('b', 'B'));
    expect(src).toHaveLength(1);
  });
});

describe('parseBootErrors（壊れた保存値でもthrowしない）', () => {
  it('正常なJSONを読める', () => {
    expect(parseBootErrors(JSON.stringify([E('a', 'A')]))).toEqual([
      { name: 'a', message: 'A', at: '2026-09-03T00:00:00.000Z' },
    ]);
  });

  it('null・空文字・壊れたJSON・配列でないJSONは空配列', () => {
    expect(parseBootErrors(null)).toEqual([]);
    expect(parseBootErrors('')).toEqual([]);
    expect(parseBootErrors('{oops')).toEqual([]);
    expect(parseBootErrors('{"a":1}')).toEqual([]);
  });

  it('name/messageが無い行は捨てて、読める行だけ返す', () => {
    const raw = JSON.stringify([{ foo: 1 }, null, 'str', E('ok', 'OK')]);
    expect(parseBootErrors(raw).map((x) => x.name)).toEqual(['ok']);
  });

  it('count・sentは意味のある値だけ引き継ぐ', () => {
    const raw = JSON.stringify([{ name: 'a', message: 'A', at: 'x', count: 3, sent: true }]);
    expect(parseBootErrors(raw)[0]).toEqual({ name: 'a', message: 'A', at: 'x', count: 3, sent: true });
  });
});

describe('送信の印（同じものを毎回送らない）', () => {
  it('unsentBootErrorsは未送信だけ返す', () => {
    const list = [{ ...E('a', 'A'), sent: true }, E('b', 'B')];
    expect(unsentBootErrors(list).map((x) => x.name)).toEqual(['b']);
  });

  it('markBootErrorsSentは全行に印を付ける（中身は消さない）', () => {
    const marked = markBootErrorsSent([E('a', 'A'), E('b', 'B')]);
    expect(marked.every((x) => x.sent === true)).toBe(true);
    expect(marked).toHaveLength(2);
  });
});

describe('formatBootErrors（設定画面の表示・コピー用）', () => {
  it('1件1行で時刻・名前・メッセージを並べる', () => {
    expect(formatBootErrors([E('loadTheme', 'TypeError: x')]))
      .toBe('2026-09-03T00:00:00.000Z  [loadTheme] TypeError: x');
  });

  it('2回以上起きたものは回数を添える', () => {
    expect(formatBootErrors([{ ...E('a', 'A'), count: 3 }])).toContain('(x3)');
  });

  it('空なら空文字', () => {
    expect(formatBootErrors([])).toBe('');
  });
});
