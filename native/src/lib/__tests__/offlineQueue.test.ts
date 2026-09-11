// オフラインキューの「送らない・捨てない」の線引きを固定するテスト（QA 2026-09-10 P0-2 の再発防止）。
//
// 事故の形: 圏外でユーザーAが筋トレを記録 → 同期されないまま別アカウントBでログイン →
// flush() が B のセッションから A の user_id を insert → RLS 違反 → 「再送しても直らない行」として
// 破棄。A の記録が、どちらのアカウントにも残らず、エラーも出ないまま消えた。
//
// このファイルが落ちる＝また誰かの記録が黙って消える状態に戻っている。
type Row = { user_id: string; date: string } & Record<string, unknown>;

const mockState = {
  uid: 'user-A' as string | null,
  inserts: [] as Row[],
  // insert のたびに先頭から取り出す応答（null = 成功）
  errors: [] as ({ message: string } | null)[],
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: mockState.uid ? { user: { id: mockState.uid } } : null } })),
    },
    from: jest.fn(() => ({
      insert: jest.fn(async (row: Row) => {
        mockState.inserts.push(row);
        return { data: null, error: mockState.errors.shift() ?? null };
      }),
    })),
  },
}));

// 日次サマリーの再計算は別モジュールの責務。ここでは呼ばれても何もしない
const syncCalls: string[] = [];
jest.mock('@/lib/sync', () => ({
  syncEntriesForDate: jest.fn(async (uid: string, date: string) => { syncCalls.push(`${uid}/${date}`); }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueue, flush, pendingCount, isNetworkError, isPermissionError, takeDroppedNotice } from '../offlineQueue';

const row = (over: Partial<Row> = {}): Row => ({ user_id: 'user-A', date: '2026-09-10', kcal: 300, ...over });

beforeEach(async () => {
  await AsyncStorage.clear();
  mockState.uid = 'user-A';
  mockState.inserts.length = 0;
  mockState.errors.length = 0;
  syncCalls.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('エラーの種類の見分け', () => {
  it('圏外・タイムアウトはネットワークエラー', () => {
    expect(isNetworkError({ message: 'Network request failed' })).toBe(true);
    expect(isNetworkError({ message: 'TypeError: fetch failed' })).toBe(true);
    expect(isNetworkError({ message: 'request timed out' })).toBe(true);
  });

  it('RLS・権限エラーはネットワークではなく「権限」（捨てない側）に分類される', () => {
    const rls = { message: 'new row violates row-level security policy for table "logs"' };
    expect(isNetworkError(rls)).toBe(false);
    expect(isPermissionError(rls)).toBe(true);
    expect(isPermissionError({ message: 'permission denied for table logs' })).toBe(true);
    expect(isPermissionError({ code: '42501', message: 'insufficient_privilege' })).toBe(true);
  });

  it('列違反など「本当に再送しても直らない」エラーはどちらでもない', () => {
    const col = { message: `Could not find the 'foo' column of 'logs'` };
    expect(isNetworkError(col)).toBe(false);
    expect(isPermissionError(col)).toBe(false);
  });
});

describe('flush（別アカウントの行を送らない）', () => {
  it('キューの user_id が現在のセッションと違うとき insert を呼ばない', async () => {
    await enqueue(row({ user_id: 'user-A' }));
    mockState.uid = 'user-B';                 // 別アカウントでログインし直した
    const r = await flush();
    expect(mockState.inserts).toEqual([]);    // 1件も送らない
    expect(r.sent).toBe(0);
    expect(r.left).toBe(1);
    expect(await pendingCount()).toBe(1);     // Aの記録は残っている
  });

  it('自分の行だけ送り、別アカウントの行は残す（混在キュー）', async () => {
    await enqueue(row({ user_id: 'user-A', date: '2026-09-09' }));
    await enqueue(row({ user_id: 'user-B', date: '2026-09-10' }));
    mockState.uid = 'user-B';
    const r = await flush();
    expect(mockState.inserts.map((i) => i.user_id)).toEqual(['user-B']);
    expect(r.sent).toBe(1);
    expect(r.left).toBe(1);
    const left = JSON.parse((await AsyncStorage.getItem('bl-offline-logs')) ?? '[]');
    expect(left.map((it: { row: Row }) => it.row.user_id)).toEqual(['user-A']);
  });

  it('未ログイン中は1件も送らない（誰の行か判定できないため）', async () => {
    await enqueue(row());
    mockState.uid = null;
    const r = await flush();
    expect(mockState.inserts).toEqual([]);
    expect(r).toEqual({ sent: 0, left: 1 });
  });
});

describe('flush（エラー別のふるまい）', () => {
  it('RLSエラーで行を捨てない（保持する）', async () => {
    await enqueue(row());
    mockState.errors.push({ message: 'new row violates row-level security policy for table "logs"' });
    const r = await flush();
    expect(mockState.inserts).toHaveLength(1);   // 送りはした
    expect(r.sent).toBe(0);
    expect(r.left).toBe(1);
    expect(await pendingCount()).toBe(1);        // が、捨てていない
    expect(await takeDroppedNotice()).toBe(0);   // 「破棄した」とも数えない
  });

  it('ネットワークエラーでその場で止める（後続を送らない）', async () => {
    await enqueue(row({ date: '2026-09-08' }));
    await enqueue(row({ date: '2026-09-09' }));
    mockState.errors.push({ message: 'Network request failed' });
    const r = await flush();
    expect(mockState.inserts).toHaveLength(1);   // 2件目は試さない
    expect(r).toEqual({ sent: 0, left: 2 });
    expect(await pendingCount()).toBe(2);
  });

  it('成功した行だけキューから消え、日次サマリーの再計算が日付ごとに1回走る', async () => {
    await enqueue(row({ date: '2026-09-09' }));
    await enqueue(row({ date: '2026-09-09' }));
    await enqueue(row({ date: '2026-09-10' }));
    const r = await flush();
    expect(r).toEqual({ sent: 3, left: 0 });
    expect(await pendingCount()).toBe(0);
    expect(syncCalls.sort()).toEqual(['user-A/2026-09-09', 'user-A/2026-09-10']);
  });

  it('本当に再送しても直らない行だけ落とし、件数を控えて次回1度だけ知らせる', async () => {
    await enqueue(row({ date: '2026-09-09' }));
    await enqueue(row({ date: '2026-09-10' }));
    // 1件目: 列違反（フォールバック側でも同じエラー）→ 破棄。2件目: 成功
    mockState.errors.push({ message: 'invalid input syntax for type numeric' });
    const r = await flush();
    expect(r).toEqual({ sent: 1, left: 0 });
    expect(await takeDroppedNotice()).toBe(1);
    expect(await takeDroppedNotice()).toBe(0);   // 一度読んだら消える（毎起動で言わない）
  });
});
