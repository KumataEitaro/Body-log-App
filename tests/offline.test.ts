import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cacheGet, cacheSet, cacheClearAll } from '@/lib/cache';
import { getQueue, enqueueLog, removeFromQueue, clearQueue } from '@/lib/offlineQueue';
import type { LogRow } from '@/lib/day';

// Node環境用のlocalStorageスタブ。
// 実物同様、保存キーが Object.keys(localStorage) で列挙できるようにする
// （cacheClearAll がこれに依存するため）。メソッドは非列挙で定義。
function stubLocalStorage(): Record<string, string> {
  const ls: Record<string, string> = {};
  Object.defineProperties(ls, {
    getItem: { value: (k: string) => (k in ls ? ls[k] : null) },
    setItem: { value: (k: string, v: string) => { ls[k] = String(v); } },
    removeItem: { value: (k: string) => { delete ls[k]; } },
  });
  vi.stubGlobal('localStorage', ls);
  return ls;
}

const log: LogRow = {
  items: [], kcal: 500, p: 30, f: 10, c: 60,
  weight: null, ex: null, adj: 0, mood: '', text: '牛丼', photo_urls: [],
};

describe('cache (stale-while-revalidate用の端末キャッシュ)', () => {
  let store: Record<string, string>;
  beforeEach(() => { store = stubLocalStorage(); });

  it('set→getで往復できる', () => {
    cacheSet('dash:u1', { a: 1, b: 'x' });
    expect(cacheGet('dash:u1')).toEqual({ a: 1, b: 'x' });
  });

  it('未保存キーはnull', () => {
    expect(cacheGet('nothing')).toBeNull();
  });

  it('壊れたJSONはnull（例外を出さない）', () => {
    store['blc:bad'] = '{oops';
    expect(cacheGet('bad')).toBeNull();
  });

  it('cacheClearAllはblc:とblq:だけ消し、他のキーは残す', () => {
    cacheSet('dash:u1', 1);
    enqueueLog('u1', '2026-07-21', log);
    store['bodylog-lang'] = 'ja';
    cacheClearAll();
    expect(cacheGet('dash:u1')).toBeNull();
    expect(getQueue('u1')).toEqual([]);
    expect(store['bodylog-lang']).toBe('ja');
  });

  it('localStorageが使えない環境でも例外を出さない', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => cacheSet('x', 1)).not.toThrow();
    expect(cacheGet('x')).toBeNull();
    expect(() => cacheClearAll()).not.toThrow();
  });
});

describe('offlineQueue (圏外時の記録キュー)', () => {
  beforeEach(() => { stubLocalStorage(); });

  it('enqueueでlocal-始まりのIDが振られ、getQueueで取り出せる', () => {
    const q = enqueueLog('u1', '2026-07-21', log);
    expect(q.localId.startsWith('local-')).toBe(true);
    expect(q.date).toBe('2026-07-21');
    const all = getQueue('u1');
    expect(all).toHaveLength(1);
    expect(all[0].log.kcal).toBe(500);
  });

  it('ユーザーごとにキューが分かれる', () => {
    enqueueLog('u1', '2026-07-21', log);
    enqueueLog('u2', '2026-07-21', log);
    expect(getQueue('u1')).toHaveLength(1);
    expect(getQueue('u2')).toHaveLength(1);
  });

  it('removeFromQueueで指定IDだけ消える', () => {
    const a = enqueueLog('u1', '2026-07-21', log);
    const b = enqueueLog('u1', '2026-07-22', log);
    removeFromQueue('u1', a.localId);
    const rest = getQueue('u1');
    expect(rest).toHaveLength(1);
    expect(rest[0].localId).toBe(b.localId);
  });

  it('clearQueueで全消去', () => {
    enqueueLog('u1', '2026-07-21', log);
    enqueueLog('u1', '2026-07-21', log);
    clearQueue('u1');
    expect(getQueue('u1')).toEqual([]);
  });

  it('壊れたキューは空扱い', () => {
    localStorage.setItem('blq:u1', 'not-json');
    expect(getQueue('u1')).toEqual([]);
  });
});
