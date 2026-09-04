// 食事の制約バッジは「何の対象か」を名指しする（2026-09-04 指摘: 「対象の可能性」だけでは分からない）
import { dietBadgeLabel } from '../components/DietNotes';

describe('dietBadgeLabel: どのプリセットの対象かを名指しする', () => {
  it('辞書で当たったプリセットがあればそれを出す（本人の設定より優先）', () => {
    expect(dietBadgeLabel('high', ['vegan'], ['vegan', 'gluten_free'])).toBe('ビーガンの対象を含む可能性が高い');
    expect(dietBadgeLabel('maybe', ['gluten_free'], ['vegan', 'gluten_free'])).toBe('グルテンフリーの対象を含む可能性');
  });

  it('AI判定だけ（当たったプリセットが不明）なら、本人が設定しているプリセットを全部名指しする', () => {
    expect(dietBadgeLabel('maybe', [], ['vegan'])).toBe('ビーガンの対象を含む可能性');
    expect(dietBadgeLabel('high', [], ['vegan', 'gluten_free'])).toBe('ビーガン・グルテンフリーの対象を含む可能性が高い');
  });

  it('複数当たっても重複は畳む', () => {
    expect(dietBadgeLabel('high', ['vegan', 'vegan', 'halal'], ['vegan'])).toBe('ビーガン・ハラールの対象を含む可能性が高い');
  });

  it('プリセットが分からないときは従来どおり「対象」だけで言う（空文字にしない）', () => {
    expect(dietBadgeLabel('high', [], [])).toBe('対象を含む可能性が高い');
    expect(dietBadgeLabel('maybe', [], [])).toBe('対象を含む可能性');
  });

  it('断定語・絵文字を含まない（§6: 肯定的断定を作らない・煽らない）', () => {
    for (const s of [dietBadgeLabel('high', ['vegan'], []), dietBadgeLabel('maybe', [], ['halal'])]) {
      expect(s).not.toMatch(/⚠|❌|✅|安全|食べられます|OK/);
      expect(s).toMatch(/可能性/);
    }
  });
});
