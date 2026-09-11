// 体重の保存本体（lib/weightLog.ts）。＋シートの「体重」は4タブすべてから呼ばれるようになったので、
// 「どのタブから保存しても同じ規則で1行が入る」ことをここで固定する。
// 副作用（Supabase・Alert）は deps で差し替えられるので、ここでは純粋なロジックとして検証する。
import { parseWeightInput, weightOnlyRow, saveWeightEntry } from '@/lib/weightLog';

const okDeps = {
  uid: 'u1', date: '2026-09-10', unit: 'kg' as const, latestWeight: 70,
  confirm: async () => true,
  insert: async () => ({ error: null }),
  sync: async () => undefined,
};

describe('体重の入力を kg に直す', () => {
  it('kg はそのまま・小数1桁に丸める', () => {
    expect(parseWeightInput('70', 'kg')).toBe(70);
    expect(parseWeightInput(' 70.55 ', 'kg')).toBe(70.6);
  });
  it('lb は kg に換算する', () => {
    expect(parseWeightInput('154.3', 'lb')).toBe(70);
  });
  it('小数点にカンマを打っても読む（フリック入力・欧州式の取りこぼし防止）', () => {
    expect(parseWeightInput('70,5', 'kg')).toBe(70.5);
  });
  it('数値でない・範囲外（20kg以下/300kg以上）は null', () => {
    for (const bad of ['', 'あ', '20', '0', '300', '1000']) expect(parseWeightInput(bad, 'kg')).toBeNull();
  });
});

describe('logs に入れる行', () => {
  it('体重だけの行（items 空・ex オフ・kcal は null）', () => {
    expect(weightOnlyRow('u1', '2026-09-10', 70.5)).toEqual({
      user_id: 'u1', date: '2026-09-10', items: [], kcal: null, p: null, f: null, c: null,
      weight: 70.5, ex: 'オフ', adj: 0, mood: '', text: '', photo_urls: [],
    });
  });
});

describe('保存', () => {
  it('成功すると kg を返し、同じ日付で entries を同期する', async () => {
    const insert = jest.fn(async () => ({ error: null }));
    const sync = jest.fn(async () => undefined);
    const r = await saveWeightEntry('70.5', { ...okDeps, insert, sync });
    expect(r).toEqual({ ok: true, kg: 70.5 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ weight: 70.5, date: '2026-09-10', user_id: 'u1' }));
    expect(sync).toHaveBeenCalledWith('u1', '2026-09-10');
  });

  it('未ログイン・値が変なときは書き込まずにエラー文を返す', async () => {
    const insert = jest.fn(async () => ({ error: null }));
    expect(await saveWeightEntry('70', { ...okDeps, uid: null, insert })).toEqual({ ok: false, msg: '体重の値を確認してください。' });
    expect(await saveWeightEntry('999', { ...okDeps, insert })).toEqual({ ok: false, msg: '体重の値を確認してください。' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('外れ値の確認で「入力し直す」を選んだら、書き込まず・メッセージも出さない（msg は空文字）', async () => {
    const insert = jest.fn(async () => ({ error: null }));
    const r = await saveWeightEntry('90', { ...okDeps, confirm: async () => false, insert });
    expect(r).toEqual({ ok: false, msg: '' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('書き込みに失敗したらエラー文を返す', async () => {
    const r = await saveWeightEntry('70.5', { ...okDeps, insert: async () => ({ error: { message: 'ng' } }) });
    expect(r).toEqual({ ok: false, msg: '保存に失敗しました。もう一度お試しください。' });
  });

  it('同期の失敗は保存の成否に含めない（次回の読込で追いつく）', async () => {
    const r = await saveWeightEntry('70.5', { ...okDeps, sync: async () => { throw new Error('offline'); } });
    expect(r).toEqual({ ok: true, kg: 70.5 });
  });
});
