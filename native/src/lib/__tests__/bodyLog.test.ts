// ウエスト・体脂肪率の保存本体（lib/bodyLog.ts）。体重（weightLog.test.ts）と同じ流儀で、
// 「＋シートのどの入口から保存しても同じ規則で1行が入る」ことを固定する（2026-09-18）。
//
// 熊田さん「ウエストの入力も体重などと同じように」「AI で測定した体脂肪率の保存のみ（画像は保存しない）」
import { parseWaistInput, parseBodyfatInput, waistOnlyRow, bodyfatOnlyRow, saveWaistEntry, saveBodyfatEntry } from '@/lib/bodyLog';

const okDeps = {
  uid: 'u1', date: '2026-09-18',
  insert: async () => ({ error: null }),
  sync: async () => undefined,
};

describe('ウエストの入力を cm に直す', () => {
  it('cm はそのまま・小数1桁に丸める', () => {
    expect(parseWaistInput('80', 'cm')).toBe(80);
    expect(parseWaistInput(' 80.55 ', 'cm')).toBe(80.6);
  });
  it('ft 設定のときはインチとして受けて cm に換算する', () => {
    expect(parseWaistInput('31.5', 'ft')).toBe(80);
  });
  it('小数点にカンマを打っても読む', () => {
    expect(parseWaistInput('80,5', 'cm')).toBe(80.5);
  });
  it('数値でない・範囲外（40cm以下/200cm以上）は null', () => {
    for (const bad of ['', 'あ', '40', '0', '200', '1000']) expect(parseWaistInput(bad, 'cm')).toBeNull();
  });
});

describe('体脂肪率の入力', () => {
  it('3〜70% を受け付け、小数1桁に丸める', () => {
    expect(parseBodyfatInput('21.55')).toBe(21.6);
    expect(parseBodyfatInput('3')).toBe(3);
    expect(parseBodyfatInput('70')).toBe(70);
  });
  it('範囲外・数値でないものは null（「1234」でグラフが潰れない）', () => {
    for (const bad of ['', 'x', '2.9', '70.1', '1234']) expect(parseBodyfatInput(bad)).toBeNull();
  });
});

describe('logs に入れる行（数値だけの行・items 空・ex オフ）', () => {
  it('ウエストだけの行', () => {
    expect(waistOnlyRow('u1', '2026-09-18', 80.5)).toEqual({
      user_id: 'u1', date: '2026-09-18', items: [], kcal: null, p: null, f: null, c: null,
      weight: null, ex: 'オフ', adj: 0, mood: '', text: '', photo_urls: [], waist: 80.5,
    });
  });
  it('体脂肪率だけの行（写真の URL は持たない＝画像は保存しない）', () => {
    const row = bodyfatOnlyRow('u1', '2026-09-18', 21.5);
    expect(row.bodyfat).toBe(21.5);
    expect(row.photo_urls).toEqual([]);
    expect(row.weight).toBeNull();
    expect(row.kcal).toBeNull();
  });
});

describe('保存', () => {
  it('ウエスト: 成功すると cm を返し、同じ日付で entries を同期する', async () => {
    const insert = jest.fn(async () => ({ error: null }));
    const sync = jest.fn(async () => undefined);
    const r = await saveWaistEntry('80', 'cm', { ...okDeps, insert, sync });
    expect(r).toEqual({ ok: true, value: 80 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ waist: 80, date: '2026-09-18' }));
    expect(sync).toHaveBeenCalledWith('u1', '2026-09-18');
  });
  it('体脂肪率: 成功すると % を返し、同期する', async () => {
    const insert = jest.fn(async () => ({ error: null }));
    const sync = jest.fn(async () => undefined);
    const r = await saveBodyfatEntry('21.5', { ...okDeps, insert, sync });
    expect(r).toEqual({ ok: true, value: 21.5 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ bodyfat: 21.5 }));
    expect(sync).toHaveBeenCalledTimes(1);
  });
  it('値が読めない・未ログインは保存せずエラー文', async () => {
    expect(await saveWaistEntry('abc', 'cm', okDeps)).toEqual({ ok: false, msg: 'ウエストの値を確認してください。' });
    expect(await saveWaistEntry('80', 'cm', { ...okDeps, uid: null })).toEqual({ ok: false, msg: 'ウエストの値を確認してください。' });
    expect(await saveBodyfatEntry('99', okDeps)).toEqual({ ok: false, msg: '体脂肪率の値を確認してください。' });
  });
  it('insert が失敗したらエラー文（同期は呼ばない）', async () => {
    const sync = jest.fn(async () => undefined);
    const r = await saveWaistEntry('80', 'cm', { ...okDeps, insert: async () => ({ error: { message: 'boom' } }), sync });
    expect(r.ok).toBe(false);
    expect(sync).not.toHaveBeenCalled();
  });
  it('同期の失敗は保存の成否に含めない（次回の読込で追いつく）', async () => {
    const r = await saveBodyfatEntry('21.5', { ...okDeps, sync: async () => { throw new Error('offline'); } });
    expect(r).toEqual({ ok: true, value: 21.5 });
  });
});
