// PFCアドバイス: どんな入力でも「具体的な行動」を返すことを保証する
import { pfcAdvice } from '@/lib/pfcAdvice';

describe('pfcAdvice', () => {
  it('カロリー超過なら責めずに立て直しを促す', () => {
    const t = pfcAdvice({ p: -5, f: -2, c: -50, kcal: -387 });
    expect(t).toContain('1日では体脂肪になりません');
  });

  it('脂質・炭水化物が尽きてたんぱく質が残るなら低脂質・高たんぱくを提案', () => {
    const t = pfcAdvice({ p: 51, f: 2, c: -50, kcal: 45 });
    expect(t).toContain('低脂質・高たんぱく');
    expect(t).toContain('鶏むね肉');
  });

  it('炭水化物が大きく残るならエネルギー源を提案', () => {
    const t = pfcAdvice({ p: 10, f: 30, c: 120, kcal: 700 });
    expect(t).toContain('炭水化物');
  });

  it('どの入力でも空文字を返さない', () => {
    const cases = [
      { p: 0, f: 0, c: 0, kcal: 0 },
      { p: 168, f: 76, c: 101, kcal: 1759 },
      { p: -30, f: -30, c: -30, kcal: -1000 },
      { p: 5, f: 10, c: 20, kcal: 200 },
      { p: 30, f: 25, c: 50, kcal: 600 },
    ];
    for (const c of cases) expect(pfcAdvice(c).length).toBeGreaterThan(10);
  });
});
