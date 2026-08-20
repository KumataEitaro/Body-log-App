// 筋トレ種目の一覧とユーザー追加分の扱い。
// DBには canon（日本語固定）を書くため、canon が重複・欠落しないことが特に重要。
import { LIFTS, LIFT_PARTS, liftName, addCustomLift, removeCustomLift, getCustomLifts, loadCustomLifts } from '../lifts';

describe('基本種目', () => {
  it('canonが重複しない（履歴テキストの解析が種目名に依存するため）', () => {
    const canons = LIFTS.map((l) => l.canon);
    expect(new Set(canons).size).toBe(canons.length);
  });

  it('idが重複しない', () => {
    const ids = LIFTS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('すべての種目が定義済みの部位に属する', () => {
    const parts = new Set(LIFT_PARTS.map((p) => p.key));
    expect(LIFTS.filter((l) => !parts.has(l.part))).toEqual([]);
  });

  it('どの部位にも最低1種目ある（空の見出しを出さない）', () => {
    for (const p of LIFT_PARTS) {
      expect(LIFTS.some((l) => l.part === p.key)).toBe(true);
    }
  });

  it('全idに表示名がある（idがそのまま画面に出ない）', () => {
    for (const l of LIFTS) expect(liftName(l.id)).not.toBe(l.id);
  });
});

describe('ユーザーが追加した種目', () => {
  beforeEach(async () => {
    for (const n of [...getCustomLifts()]) await removeCustomLift(n);
  });

  it('追加できて一覧に入る', async () => {
    expect(await addCustomLift('ジャンプスクワット')).toBe(true);
    expect(getCustomLifts()).toContain('ジャンプスクワット');
  });

  it('前後の空白は落とす', async () => {
    await addCustomLift('  ヒップアブダクション  ');
    expect(getCustomLifts()).toContain('ヒップアブダクション');
  });

  it('空文字は追加しない', async () => {
    expect(await addCustomLift('   ')).toBe(false);
    expect(getCustomLifts()).toEqual([]);
  });

  it('基本種目と同じ名前は追加しない（一覧に二重で出さない）', async () => {
    expect(await addCustomLift('ベンチプレス')).toBe(false);
    expect(getCustomLifts()).toEqual([]);
  });

  it('同じ名前を二度追加しない', async () => {
    await addCustomLift('ヒップアブダクション');
    expect(await addCustomLift('ヒップアブダクション')).toBe(false);
    expect(getCustomLifts().filter((n) => n === 'ヒップアブダクション')).toHaveLength(1);
  });

  it('削除できる', async () => {
    await addCustomLift('ヒップアブダクション');
    await removeCustomLift('ヒップアブダクション');
    expect(getCustomLifts()).not.toContain('ヒップアブダクション');
  });

  it('保存した内容を読み直せる', async () => {
    await addCustomLift('ジャンプスクワット');
    await loadCustomLifts();
    expect(getCustomLifts()).toContain('ジャンプスクワット');
  });
});
