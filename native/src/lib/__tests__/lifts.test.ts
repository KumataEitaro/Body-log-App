// 筋トレ種目の一覧とユーザー追加分の扱い。
// DBには canon（日本語固定）を書くため、canon が重複・欠落しないことが特に重要。
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LIFTS, LIFT_PARTS, OTHER_PART, liftName, addCustomLift, removeCustomLift, getCustomLifts, getCustomLiftDefs,
  loadCustomLifts, liftPartOf, isPerSideLift, isBodyweightLift, isPartKey,
} from '../lifts';

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

describe('ダンベル種目（片側入力）の基本種目', () => {
  it('db フラグは明らかに両手にダンベルを持つ7種だけ（バーベルでもやる種目には付けない）', () => {
    expect(LIFTS.filter((l) => l.db).map((l) => l.canon)).toEqual([
      'ダンベルプレス', 'ダンベルロウ', 'サイドレイズ', 'フロントレイズ', 'リアレイズ', 'ハンマーカール', 'キックバック',
    ]);
    expect(isPerSideLift('ダンベルプレス')).toBe(true);
    expect(isPerSideLift(' ダンベルロウ ')).toBe(true);
    expect(isPerSideLift('アームカール')).toBe(false);     // バーベルでもやる
    expect(isPerSideLift('ショルダープレス')).toBe(false);
    expect(isPerSideLift('ベンチプレス')).toBe(false);
  });

  it('db と bw は同時に付いていない（自重種目の加重は片側入力にしない）', () => {
    expect(LIFTS.filter((l) => l.db && l.bw != null)).toEqual([]);
  });

  it('部位キーは基本7部位＋その他', () => {
    for (const p of LIFT_PARTS) expect(isPartKey(p.key)).toBe(true);
    expect(isPartKey(OTHER_PART)).toBe(true);
    expect(isPartKey('wings')).toBe(false);
  });
});

// 追加種目の属性（部位・自重・ダンベル）は端末に保存され、統計（liftPartOf）と入力画面（isPerSideLift）が読む
describe('ユーザー追加種目の属性', () => {
  beforeEach(async () => {
    for (const n of [...getCustomLifts()]) await removeCustomLift(n);
  });

  it('部位を選んで足すと liftPartOf がその部位を返す（統計の「その他」に落ちない）', async () => {
    await addCustomLift('ヒップアブダクション', { part: 'legs' });
    expect(liftPartOf('ヒップアブダクション')).toBe('legs');
    expect(liftPartOf(' ヒップアブダクション ')).toBe('legs');
  });

  it('部位を選ばなければ その他。知らない種目も その他', async () => {
    await addCustomLift('ネックカール');
    expect(liftPartOf('ネックカール')).toBe(OTHER_PART);
    expect(liftPartOf('知らない種目')).toBe(OTHER_PART);
  });

  it('不正な部位キーは捨てて その他', async () => {
    await addCustomLift('謎の種目', { part: 'wings' });
    expect(liftPartOf('謎の種目')).toBe(OTHER_PART);
    expect(getCustomLiftDefs().find((c) => c.n === '謎の種目')?.part).toBeUndefined();
  });

  it('ダンベル種目として足すと片側入力になる（自重ではない）', async () => {
    await addCustomLift('ダンベルカール', { part: 'arm', dumbbell: true });
    expect(isPerSideLift('ダンベルカール')).toBe(true);
    expect(isBodyweightLift('ダンベルカール')).toBe(false);
    expect(liftPartOf('ダンベルカール')).toBe('arm');
  });

  it('自重種目として足すと体重が負荷になる（以前の boolean 指定も受ける）', async () => {
    await addCustomLift('マッスルアップ', { bodyweight: true, part: 'back' });
    expect(isBodyweightLift('マッスルアップ')).toBe(true);
    expect(isPerSideLift('マッスルアップ')).toBe(false);
    await addCustomLift('Lシット', true);
    expect(isBodyweightLift('Lシット')).toBe(true);
  });

  it('基本種目の部位・フラグは追加種目に上書きされない', () => {
    expect(liftPartOf('ベンチプレス')).toBe('chest');
    expect(liftPartOf(' 懸垂 ')).toBe('back');
    expect(liftPartOf('ケトルベルスイング')).toBe('full');
  });

  it('保存形式は {n, bw?, part?, db?}。旧形式（文字列・{n,bw}）も読み、壊れた行は捨てる', async () => {
    await AsyncStorage.setItem('bl-custom-lifts', JSON.stringify([
      'ジャンプスクワット',
      { n: 'マッスルアップ', bw: 1 },
      { n: 'ダンベルカール', part: 'arm', db: true },
      { n: '  ', part: 'arm' },
      { part: 'legs' },
      42,
    ]));
    await loadCustomLifts();
    expect(getCustomLifts()).toEqual(['ジャンプスクワット', 'マッスルアップ', 'ダンベルカール']);
    expect(liftPartOf('ジャンプスクワット')).toBe(OTHER_PART);
    expect(isBodyweightLift('マッスルアップ')).toBe(true);
    expect(liftPartOf('ダンベルカール')).toBe('arm');
    expect(isPerSideLift('ダンベルカール')).toBe(true);
  });

  it('属性は保存して読み直しても残る', async () => {
    await addCustomLift('ダンベルカール', { part: 'arm', dumbbell: true });
    await addCustomLift('マッスルアップ', { bodyweight: true, part: 'back' });
    await loadCustomLifts();
    expect(getCustomLiftDefs()).toEqual([
      { n: 'ダンベルカール', part: 'arm', db: true },
      { n: 'マッスルアップ', bw: 1, part: 'back' },
    ]);
  });

  it('削除すると部位・フラグも消える', async () => {
    await addCustomLift('ダンベルカール', { part: 'arm', dumbbell: true });
    await removeCustomLift('ダンベルカール');
    expect(isPerSideLift('ダンベルカール')).toBe(false);
    expect(liftPartOf('ダンベルカール')).toBe(OTHER_PART);
    expect(getCustomLiftDefs()).toEqual([]);
  });
});
