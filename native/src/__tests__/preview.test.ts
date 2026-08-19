// 保存前プレビューの計算: バーが枠を超えない・超過判定が正しいこと
import { previewFill, previewFillSplit } from '@/lib/preview';

describe('previewFill', () => {
  it('確定分と未保存分が積み上がる', () => {
    const r = previewFill(50, 25, 100);
    expect(r.basePct).toBe(50);
    expect(r.ghostPct).toBe(25);
    expect(r.over).toBe(false);
  });

  it('合計が目標を超えてもバーは100%を超えない', () => {
    const r = previewFill(80, 60, 100);
    expect(r.basePct).toBe(80);
    expect(r.basePct + r.ghostPct).toBe(100);  // 枠からはみ出さない
    expect(r.over).toBe(true);
  });

  it('すでに超えている場合はゴーストの幅が0になる', () => {
    const r = previewFill(120, 30, 100);
    expect(r.basePct).toBe(100);
    expect(r.ghostPct).toBe(0);
    expect(r.overNow).toBe(true);
  });

  it('未保存分が無ければゴーストは0', () => {
    expect(previewFill(40, 0, 100).ghostPct).toBe(0);
  });

  it('目標が0でもゼロ除算しない', () => {
    const r = previewFill(10, 5, 0);
    expect(Number.isFinite(r.basePct)).toBe(true);
    expect(r.basePct + r.ghostPct).toBeLessThanOrEqual(100);
  });

  it('負の入力を0として扱う', () => {
    const r = previewFill(-10, -5, 100);
    expect(r.basePct).toBe(0);
    expect(r.ghostPct).toBe(0);
  });
});

describe('previewFillSplit（トレイの1品を強調）', () => {
  it('確定・他の品・注目中の3つに分かれ、合計は100%以内', () => {
    const r = previewFillSplit(40, 20, 10, 100);
    expect(r.basePct).toBe(40);
    expect(r.othersPct).toBe(20);
    expect(r.focusPct).toBe(10);
    expect(r.over).toBe(false);
  });

  it('超過しても枠を超えない（注目分から先に削られる）', () => {
    const r = previewFillSplit(70, 40, 30, 100);
    expect(r.basePct + r.othersPct + r.focusPct).toBe(100);
    expect(r.focusPct).toBe(0);   // 他の品で埋まりきるので注目分は表示余地なし
    expect(r.over).toBe(true);
  });

  it('注目していないときは注目分が0', () => {
    expect(previewFillSplit(30, 25, 0, 100).focusPct).toBe(0);
  });

  it('注目中の品だけがある場合も正しく出る', () => {
    const r = previewFillSplit(0, 0, 25, 100);
    expect(r.basePct).toBe(0);
    expect(r.othersPct).toBe(0);
    expect(r.focusPct).toBe(25);
  });
});
