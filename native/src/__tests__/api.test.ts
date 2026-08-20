// API通信の安全弁: 応答が返らないときに必ず打ち切ること
// （タイムアウトが無いとローディング表示が永久に残り、操作できなくなる）
// jest.setup.js が @/lib/api を全体モックしているため、この検証だけ本物を使う
jest.unmock('@/lib/api');
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiPost } = jest.requireActual('@/lib/api') as typeof import('@/lib/api');

describe('apiPost', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; jest.useRealTimers(); });

  it('応答が返らないときは時間切れで打ち切り、failure=timeoutを返す', async () => {
    // signalのabortで拒否されるfetchを模す
    globalThis.fetch = jest.fn((_url: string, opts: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          const e = new Error('Aborted');
          e.name = 'AbortError';
          reject(e);
        });
      })) as unknown as typeof fetch;

    // 偽タイマーは非同期の解決順と噛み合わないため、短いタイムアウトを渡して実時間で確かめる
    const r = await apiPost('/api/parse-food', { text: 'ごはん' }, 30);

    expect(r.ok).toBe(false);
    expect(r.failure).toBe('timeout');
    expect(r.json).toBeNull();
  });

  it('通信自体が失敗したらfailure=offlineを返す（例外を外に投げない）', async () => {
    globalThis.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed'))) as unknown as typeof fetch;
    const r = await apiPost('/api/parse-food', { text: 'ごはん' });
    expect(r.ok).toBe(false);
    expect(r.failure).toBe('offline');
  });

  it('サーバーがエラーを返してもfailureは付かない（通信自体は成立している）', async () => {
    globalThis.fetch = jest.fn(() => Promise.resolve({
      ok: false, status: 500, json: async () => ({ ok: false, error: 'boom' }),
    })) as unknown as typeof fetch;
    const r = await apiPost<{ error: string }>('/api/parse-food', { text: 'x' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
    expect(r.failure).toBeUndefined();
    expect(r.json?.error).toBe('boom');
  });

  it('正常時は結果を返す', async () => {
    globalThis.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200, json: async () => ({ ok: true, result: { items: [] } }),
    })) as unknown as typeof fetch;
    const r = await apiPost<{ ok: boolean }>('/api/parse-food', { text: 'x' });
    expect(r.ok).toBe(true);
    expect(r.failure).toBeUndefined();
  });
});
