// 規約同意ゲートの判定を固定するテスト（QA 2026-09-10 P1-2 / P0-3 の再発防止）。
//
// 事故の形1（P1-2）: terms_version が null（＝登録した直後）の人まで「再同意」扱いにしていたため、
// 新規ユーザーの最初の画面が全画面の「利用規約を**更新**しました」＋「主な変更点」だった。
// 事故の形2（P0-3）: 同意の記録が `.update().eq('id', uid)` で、profiles 行が無い人は
// 0行更新・error=null＝「成功」に見えるのに terms_version は null のまま → 毎起動ゲートの無限ループ。
type ProfileRow = { terms_version?: string | null } | null;

const mockState = {
  uid: 'user-A' as string | null,
  profile: null as ProfileRow,
  selectError: null as { message: string } | null,
  writes: [] as { op: 'upsert' | 'update' | 'insert'; table: string; row: Record<string, unknown> }[],
  writeError: null as { message: string } | null,
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: mockState.uid ? { user: { id: mockState.uid } } : null } })),
    },
    from: jest.fn((table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: mockState.profile, error: mockState.selectError }) }),
      }),
      upsert: async (row: Record<string, unknown>) => {
        mockState.writes.push({ op: 'upsert', table, row });
        return { data: null, error: mockState.writeError };
      },
      update: (row: Record<string, unknown>) => ({
        eq: async () => {
          mockState.writes.push({ op: 'update', table, row });
          return { data: null, error: mockState.writeError };
        },
      }),
      insert: async (row: Record<string, unknown>) => {
        mockState.writes.push({ op: 'insert', table, row });
        return { data: null, error: null };
      },
    })),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { needsReconsent, recordConsent, TERMS_VERSION } from '../consent';

beforeEach(async () => {
  await AsyncStorage.clear();
  mockState.uid = 'user-A';
  mockState.profile = null;
  mockState.selectError = null;
  mockState.writes.length = 0;
  mockState.writeError = null;
});

describe('needsReconsent（初回同意と改定の再同意を分ける）', () => {
  it('登録直後（terms_version が null）は改定モードにならない＝初回として出す', async () => {
    mockState.profile = { terms_version: null };
    expect(await needsReconsent()).toBe('initial');   // 'update' では**ない**のが肝
  });

  it('profiles 行そのものが無い人も初回扱い', async () => {
    mockState.profile = null;
    expect(await needsReconsent()).toBe('initial');
  });

  it('古いバージョンに同意済みの人だけ改定モード', async () => {
    mockState.profile = { terms_version: '2020-01-01' };
    expect(await needsReconsent()).toBe('update');
  });

  it('現行バージョンに同意済みなら出さない', async () => {
    mockState.profile = { terms_version: TERMS_VERSION };
    expect(await needsReconsent()).toBe(false);
  });

  it('未ログインでは出さない（登録画面の同意表示に任せる）', async () => {
    mockState.uid = null;
    expect(await needsReconsent()).toBe(false);
  });

  it('列が無い/圏外で判定できないときは出さない（誤爆で全員を止めない）', async () => {
    mockState.selectError = { message: 'column profiles.terms_version does not exist' };
    expect(await needsReconsent()).toBe(false);
  });

  it('列が読めなくても、端末に古い同意記録があれば改定として出す', async () => {
    mockState.selectError = { message: 'column profiles.terms_version does not exist' };
    await AsyncStorage.setItem('bl-terms-version', '2020-01-01');
    expect(await needsReconsent()).toBe('update');
  });
});

describe('recordConsent（0行更新で「成功」にしない）', () => {
  it('profiles には upsert で書く（行が無い人でも terms_version が残る）', async () => {
    expect(await recordConsent('terms')).toBe(true);
    const profileWrite = mockState.writes.find((w) => w.table === 'profiles');
    expect(profileWrite?.op).toBe('upsert');                 // update だと0行更新で消える
    expect(profileWrite?.row.id).toBe('user-A');             // 行を作れるよう主キーを含む
    expect(profileWrite?.row.terms_version).toBe(TERMS_VERSION);
  });

  it('同意の証跡は consent_log に履歴として積む', async () => {
    await recordConsent('terms');
    const log = mockState.writes.find((w) => w.table === 'consent_log');
    expect(log?.op).toBe('insert');
    expect(log?.row).toMatchObject({ user_id: 'user-A', version: TERMS_VERSION, kind: 'terms' });
  });

  it('記録したあとは同じ端末で再同意を求めない（端末側の記録も残る）', async () => {
    await recordConsent('terms');
    expect(await AsyncStorage.getItem('bl-terms-version')).toBe(TERMS_VERSION);
    mockState.profile = { terms_version: TERMS_VERSION };
    expect(await needsReconsent()).toBe(false);
  });

  it('未ログインでは記録しない', async () => {
    mockState.uid = null;
    expect(await recordConsent('terms')).toBe(false);
    expect(mockState.writes).toEqual([]);
  });
});
