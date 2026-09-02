// マイ食品の登録ロジック: 複数食材→1品への合算（純関数）と、items列が無いDBへの後退保存
type Row = Record<string, unknown>;
const mockCalls: { op: 'insert' | 'update'; row: Row }[] = [];
const mockState = { failWithItems: false };

// supabase をこのテスト用に差し替える（jest.setup の共通モックより後に登録されるので優先される）
jest.mock('@/lib/supabase', () => {
  const result = (row: Row) => {
    // migration-31 未適用のDBを模す: items を含む書き込みだけ PGRST204 を返す
    if (mockState.failWithItems && 'items' in row) return { data: null, error: { code: 'PGRST204', message: "Could not find the 'items' column of 'my_foods'" } };
    return { data: null, error: null };
  };
  const from = () => ({
    insert: (row: Row) => { mockCalls.push({ op: 'insert', row }); return Promise.resolve(result(row)); },
    update: (row: Row) => ({ eq: () => { mockCalls.push({ op: 'update', row }); return Promise.resolve(result(row)); } }),
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    delete: () => ({ eq: async () => ({ error: null }) }),
  });
  return { supabase: { from } };
});

import { composeMyFood, saveMyFood } from '@/lib/foods';
import type { FoodItem } from '@/lib/items';

const items: FoodItem[] = [
  { name: '鶏むね肉', qty: '100g', kcal: 108, p: 22.3, f: 1.5, c: 0 },
  { name: 'ブロッコリー', qty: '50g', kcal: 17, p: 2.2, f: 0.3, c: 2.6 },
  { name: '白米', qty: '150g', kcal: 252, p: 3.8, f: 0.5, c: 55.7 },
];

beforeEach(() => { mockCalls.length = 0; mockState.failWithItems = false; });

describe('composeMyFood（複数食材→1つのマイ食品）', () => {
  it('名前が空なら「先頭の食材＋セット」・合計kcal/PFC・内訳を持つセット（recipe）になる', () => {
    const r = composeMyFood('', items);
    expect(r.name).toBe('鶏むね肉セット');
    expect(r.unit).toBe('1セット');
    expect(r.kind).toBe('recipe');
    expect(r.kcal).toBe(377);
    expect(r.p).toBe(28.3);
    expect(r.f).toBe(2.3);
    expect(r.c).toBe(58.3);
    expect(r.items).toHaveLength(3);
  });

  it('名前を入れればそれが優先される', () => {
    expect(composeMyFood('  鶏むね定食 ', items).name).toBe('鶏むね定食');
  });

  it('1品だけならその品の量を1回分にした単品（food・内訳なし）になる', () => {
    const r = composeMyFood('', [items[0]]);
    expect(r.kind).toBe('food');
    expect(r.unit).toBe('100g');
    expect(r.items).toBeNull();
    expect(r.kcal).toBe(108);
  });
});

describe('saveMyFood（my_foods への書き込み）', () => {
  it('内訳つきのセットはそのまま1回のinsertで保存される', async () => {
    const r = await saveMyFood('u1', composeMyFood('定食', items));
    expect(r.ok).toBe(true);
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].op).toBe('insert');
    expect(mockCalls[0].row.name).toBe('定食');
    expect(mockCalls[0].row.kind).toBe('recipe');
    expect(Array.isArray(mockCalls[0].row.items)).toBe(true);
  });

  it('items列が無いDB（PGRST204）では内訳を落として合計だけで再登録する', async () => {
    mockState.failWithItems = true;
    const r = await saveMyFood('u1', composeMyFood('定食', items));
    expect(r.ok).toBe(true);
    expect(mockCalls).toHaveLength(2);
    expect('items' in mockCalls[0].row).toBe(true);
    expect('items' in mockCalls[1].row).toBe(false);
    expect(mockCalls[1].row.kcal).toBe(377);
  });

  it('上書きidを渡すと update になる', async () => {
    const r = await saveMyFood('u1', { name: 'オートミール', unit: '80g', kcal: 300, p: 10, f: 5, c: 50 }, 'id-1');
    expect(r.ok).toBe(true);
    expect(mockCalls[0].op).toBe('update');
    expect(mockCalls[0].row.kind).toBe('food');
    expect('items' in mockCalls[0].row).toBe(false);
  });

  it('名前なし・kcal 0 は保存せずエラー文言を返す', async () => {
    expect((await saveMyFood('u1', { name: '', unit: '', kcal: 100, p: 0, f: 0, c: 0 })).ok).toBe(false);
    expect((await saveMyFood('u1', { name: 'x', unit: '', kcal: 0, p: 0, f: 0, c: 0 })).ok).toBe(false);
    expect(mockCalls).toHaveLength(0);
  });
});
