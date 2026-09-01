import { describe, it, expect } from 'vitest';
import { sanitizeInviteFrom, INVITE_FROM_MAX } from '../lib/invite';

// /invite?from= は「リンクを配る人が自由に書ける外部入力」。
// ここが素通しだと、共有リンクを踏んだ人の画面に任意の文章を出せてしまう
// （＝招待ページを騙りの土台に使われる）ため、表示前の丸め込みを厳しく確認する。

// 不可視文字はソースに生で書くと読めない・grepできないファイルになるのでコードから作る
const ch = (cp: number) => String.fromCodePoint(cp);
const RLO = ch(0x202e); // 双方向オーバーライド（以降を右から左に描かせる＝表示の偽装）
const ZWSP = ch(0x200b); // ゼロ幅スペース
const BOM = ch(0xfeff);
const NUL = ch(0x00);

describe('sanitizeInviteFrom（招待リンクの ?from= の安全化）', () => {
  it('ふつうのニックネームはそのまま通る', () => {
    expect(sanitizeInviteFrom('くまた')).toBe('くまた');
    expect(sanitizeInviteFrom('Taro')).toBe('Taro');
  });

  it('タグの記号を落とす（スクリプト片を書かれても文字列として無害になる）', () => {
    const out = sanitizeInviteFrom('<script>alert(1)</script>');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('/');
    expect(sanitizeInviteFrom('<b>太字</b>')).toBe('b太字b');
  });

  it('引用符・バッククォート・バックスラッシュ・スラッシュを落とす', () => {
    expect(sanitizeInviteFrom('a"b\'c`d\\e/f')).toBe('abcdef');
  });

  it('& を落とす（実体参照の起点を残さない）', () => {
    expect(sanitizeInviteFrom('A&amp;B')).toBe('Aamp;B');
    expect(sanitizeInviteFrom('A&B')).toBe('AB');
  });

  it('改行・タブ・連続空白は半角スペース1個に畳む', () => {
    expect(sanitizeInviteFrom('あ\n\n\tい   う')).toBe('あ い う');
  });

  it('制御文字・ゼロ幅・双方向オーバーライド・BOMを落とす', () => {
    expect(sanitizeInviteFrom(`A${RLO}B${ZWSP}C${BOM}D${NUL}`)).toBe('ABCD');
  });

  it('20文字で切る', () => {
    expect(INVITE_FROM_MAX).toBe(20);
    expect(sanitizeInviteFrom('あ'.repeat(50))).toBe('あ'.repeat(20));
  });

  it('絵文字の途中で切らない（サロゲートペアを壊さない）', () => {
    const out = sanitizeInviteFrom('🍙'.repeat(30));
    expect(Array.from(out)).toHaveLength(INVITE_FROM_MAX);
    expect(out).not.toContain('�');
  });

  it('前後の空白は落とす（20文字で切った直後の末尾空白も）', () => {
    expect(sanitizeInviteFrom('  くまた  ')).toBe('くまた');
    // 20文字目がちょうど空白になるケース: 切ったあとに末尾が浮かない
    expect(sanitizeInviteFrom(`${'あ'.repeat(19)} いろは`)).toBe('あ'.repeat(19));
  });

  it('文字列以外・未指定は空文字（招待者名を出さない）', () => {
    expect(sanitizeInviteFrom(undefined)).toBe('');
    expect(sanitizeInviteFrom(null)).toBe('');
    expect(sanitizeInviteFrom(123)).toBe('');
    expect(sanitizeInviteFrom({ from: 'x' })).toBe('');
  });

  it('同じキーが複数回来たら先頭だけを見る（?from=a&from=b）', () => {
    expect(sanitizeInviteFrom(['くまた', '<script>'])).toBe('くまた');
    expect(sanitizeInviteFrom([])).toBe('');
  });

  it('記号だけの入力は空文字になり、招待者の行そのものが出ない', () => {
    expect(sanitizeInviteFrom('<<<>>>')).toBe('');
  });
});
