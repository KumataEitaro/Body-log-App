// 数値入力の共通パーサ（QA B-1）。
// 「ドイツで体重72,5と打つと保存されない」「全角で身長を打つと170cmの別人になる」を固定する。
import { parseDecimal, parseInteger } from '../parseNum';

describe('parseDecimal', () => {
  it('半角の小数をそのまま読む', () => {
    expect(parseDecimal('72.5')).toBe(72.5);
    expect(parseDecimal('0')).toBe(0);
    expect(parseDecimal('170')).toBe(170);
  });

  it('カンマ小数ロケールの入力を読む（ドイツ・フランス・スペイン語圏の標準）', () => {
    expect(parseDecimal('72,5')).toBe(72.5);
  });

  it('全角の数字と記号を読む（日本語キーボードで混ざる）', () => {
    expect(parseDecimal('７２．５')).toBe(72.5);
    expect(parseDecimal('１７０')).toBe(170);
  });

  it('前後の空白と単位を落とす', () => {
    expect(parseDecimal(' 72.5 kg')).toBe(72.5);
    expect(parseDecimal('170cm')).toBe(170);
    expect(parseDecimal('約 22 ％')).toBe(22);
    expect(parseDecimal('30歳')).toBe(30);
  });

  it('空・数字でない入力は null（既定値へ黙って倒さないための土台）', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('kg')).toBeNull();
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal(undefined)).toBeNull();
  });

  it('数字のかたまりが2つある入力は読み取りを諦める', () => {
    expect(parseDecimal('12kg34')).toBeNull();
    expect(parseDecimal('60 - 70')).toBeNull();
  });

  it('符号つきも読む（範囲の判定は呼び出し側に任せる）', () => {
    expect(parseDecimal('-5')).toBe(-5);
    expect(parseDecimal('+72.5')).toBe(72.5);
  });

  it('桁区切りが混ざっても壊れない', () => {
    expect(parseDecimal('1,234.5')).toBe(1234.5);   // 英語圏の桁区切り
    expect(parseDecimal('1.234,5')).toBe(1234.5);   // ドイツ語圏の桁区切り
    expect(parseDecimal('1,234,567')).toBe(1234567);
  });

  it('Number()が通してしまう値を弾く（NaN汚染の入口を塞ぐ）', () => {
    // Number('') === 0 / Number('  ') === 0 / Number('0x10') === 16 だった
    expect(parseDecimal('0x10')).toBeNull();
    expect(parseDecimal('Infinity')).toBeNull();
  });
});

describe('parseInteger', () => {
  it('小数を四捨五入する（170.4cm を弾いて行き止まりにしない）', () => {
    expect(parseInteger('170.4')).toBe(170);
    expect(parseInteger('170.6')).toBe(171);
    expect(parseInteger('１７０')).toBe(170);
  });

  it('読めない入力は null', () => {
    expect(parseInteger('')).toBeNull();
    expect(parseInteger('abc')).toBeNull();
  });
});
