// 言語辞書の健全性: キーの重複・空値・プレースホルダの食い違いを検出する
// （プレースホルダが欠けると画面に {n} がそのまま出たり、数値が消えたりする）
import { DICTS } from '@/content/i18n';

const FILLED = ['en', 'ko', 'zh', 'es'] as const;

describe('言語辞書', () => {
  it('主要言語の辞書が空でない', () => {
    for (const code of FILLED) {
      expect(Object.keys(DICTS[code]).length).toBeGreaterThan(100);
    }
  });

  it('値が空文字のキーが無い', () => {
    for (const code of FILLED) {
      for (const [k, v] of Object.entries(DICTS[code])) {
        expect(typeof v).toBe('string');
        if (v === '') {
          // 意図的な空（曜日の接尾辞など）だけを許可する
          expect(['曜日']).toContain(k);
        }
      }
    }
  });

  it('原文のプレースホルダが訳文にも残っている', () => {
    const ph = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    for (const code of FILLED) {
      for (const [k, v] of Object.entries(DICTS[code])) {
        const want = ph(k);
        if (want.length === 0) continue;
        expect({ code, k, got: ph(v) }).toEqual({ code, k, got: want });
      }
    }
  });

  it('日本語がそのまま残っていない（未翻訳の取りこぼし検出）', () => {
    const JP = /[ぁ-んァ-ヶ一-龠]/;
    for (const code of FILLED) {
      for (const [k, v] of Object.entries(DICTS[code])) {
        if (code === 'zh') continue;  // 中国語は漢字を使うため対象外
        // 確認用に日本語の入力を求める箇所だけは原文のままでよい
        if (k.includes('確認のため')) continue;
        expect({ code, k, jp: JP.test(v) }).toEqual({ code, k, jp: false });
      }
    }
  });
});
