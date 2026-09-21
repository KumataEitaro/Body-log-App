// 共有シークレットの比較（lib/secretEq.ts・QA C-4）
import { describe, expect, it } from 'vitest';
import { bearerMatches, secretEquals } from '@/lib/secretEq';

describe('secretEquals', () => {
  it('同じ文字列なら true、違えば false', () => {
    expect(secretEquals('abc123', 'abc123')).toBe(true);
    expect(secretEquals('abc123', 'abc124')).toBe(false);
  });
  it('長さが違っても throw せず false', () => {
    expect(secretEquals('abc', 'abcd')).toBe(false);
    expect(secretEquals('abcd', 'abc')).toBe(false);
  });
  it('空・null・undefined は常に false（未設定のシークレットで開かない）', () => {
    expect(secretEquals('', '')).toBe(false);
    expect(secretEquals(null, 'x')).toBe(false);
    expect(secretEquals('x', undefined)).toBe(false);
    expect(secretEquals(undefined, undefined)).toBe(false);
  });
  it('マルチバイトでも比較できる', () => {
    expect(secretEquals('鍵かぎ', '鍵かぎ')).toBe(true);
    expect(secretEquals('鍵かぎ', '鍵かき')).toBe(false);
  });
});

describe('bearerMatches', () => {
  it('Bearer <secret> で一致する', () => {
    expect(bearerMatches('Bearer s3cret', 's3cret')).toBe(true);
    expect(bearerMatches('Bearer other', 's3cret')).toBe(false);
    expect(bearerMatches('bearer s3cret', 's3cret')).toBe(false);   // 接頭辞は大文字小文字を区別
  });
  it('素の値は allowBare のときだけ通す（cron の互換）', () => {
    expect(bearerMatches('s3cret', 's3cret')).toBe(false);
    expect(bearerMatches('s3cret', 's3cret', true)).toBe(true);
  });
  it('シークレット未設定なら何を送っても false（ルートが閉じる）', () => {
    expect(bearerMatches('Bearer ', undefined)).toBe(false);
    expect(bearerMatches('Bearer undefined', undefined)).toBe(false);
    expect(bearerMatches(null, '')).toBe(false);
  });
});
