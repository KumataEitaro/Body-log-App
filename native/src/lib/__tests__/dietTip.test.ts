// 食事の制約の案内（存在を知らせるスポットライト）の出現判定テスト。
//
// 守りたいのは2つ。
// ①「もう設定している人」に出さないこと（余計な案内は機能への信頼を削る）
// ②AI解析の回数の数え方（テキスト＋写真の累計・欠損は0扱い）が崩れないこと
import { isDietUnset, sumAiUses, hasEnoughAiUses, _internal } from '../dietTip';
import { EMPTY_DIET } from '../diet';

describe('isDietUnset', () => {
  it('未設定（modes空・custom空）なら対象', () => {
    expect(isDietUnset(EMPTY_DIET)).toBe(true);
    expect(isDietUnset(null)).toBe(true);
    expect(isDietUnset({ modes: [], custom: '   ', consentAt: null })).toBe(true);
  });

  it('プリセットが1つでも入っていれば対象外', () => {
    expect(isDietUnset({ modes: ['vegan'], custom: '', consentAt: null })).toBe(false);
  });

  it('自由記述だけでも対象外', () => {
    expect(isDietUnset({ modes: [], custom: 'えび・かに', consentAt: null })).toBe(false);
  });

  it('同意日時の有無では判定しない（同意済みでも未登録なら案内する）', () => {
    expect(isDietUnset({ modes: [], custom: '', consentAt: '2026-09-01T00:00:00Z' })).toBe(true);
  });
});

describe('sumAiUses', () => {
  it('テキストと写真を合算する', () => {
    expect(sumAiUses([{ text_count: 2, photo_count: 1 }, { text_count: 0, photo_count: 3 }])).toBe(6);
  });

  it('欠損・null・非数は0として扱う', () => {
    expect(sumAiUses([{ text_count: null }, {}, { photo_count: undefined }])).toBe(0);
    expect(sumAiUses(null)).toBe(0);
    expect(sumAiUses([])).toBe(0);
  });
});

describe('hasEnoughAiUses', () => {
  it('下限は3回（2回では出さない）', () => {
    expect(_internal.NEED_AI_USES).toBe(3);
    expect(hasEnoughAiUses(2)).toBe(false);
    expect(hasEnoughAiUses(3)).toBe(true);
    expect(hasEnoughAiUses(99)).toBe(true);
  });
});

describe('端末フラグのキー', () => {
  it('仕様どおりのキー名を使う（既存ユーザーの「二度と出さない」を壊さない）', () => {
    expect(_internal.SHOWN_KEY).toBe('bl-diet-tip-shown');
    expect(_internal.DECLINED_KEY).toBe('bl-diet-tip-declined');
  });
});
