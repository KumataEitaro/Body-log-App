// 法則検出（detectLaws）のうち sleep_factor（B-14b・夜食×睡眠）の判定を固定する。
// 「21時以降に食べた日」vs「食べなかった日」の当夜の睡眠を比べ、
// 差30分以上・各群5日以上のときだけ法則にする（ノイズを出さない側に倒す）。
// テストはロケール未設定（=日本語キーがそのまま返る）前提で日本語文字列を比較する。
import { detectLaws, type LawInput } from '../laws';

const TODAY = '2026-06-16';

function shift(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// 他の法則（食材・曜日・過食・時間帯・復帰）が発火しない最小のベース入力。
// itemHoursは10日ぶん（時間帯法則の下限14日未満）に抑える
function base(): LawInput {
  return {
    today: TODAY,
    days: [],
    itemDays: [],
    weights: [],
    itemHours: [],
    recordedDates: [],
    sleepDays: [],
  };
}

/**
 * lateN日=21時以降の摂取あり・offN日=なし の入力を組む。
 * 睡眠は「起きた日」に計上される流儀（health.ts）なので、日dの当夜の睡眠はd+1に置く
 */
function withSleep(lateN: number, offN: number, lateSleepH: number, offSleepH: number): LawInput {
  const input = base();
  let d = shift(TODAY, -1);
  for (let i = 0; i < lateN; i++) {
    input.itemHours.push({ date: d, hour: 22, kcal: 400 });          // 夜食あり
    input.sleepDays!.push({ date: shift(d, 1), sleepH: lateSleepH }); // 当夜の睡眠
    d = shift(d, -1);
  }
  for (let i = 0; i < offN; i++) {
    input.itemHours.push({ date: d, hour: 12, kcal: 600 });          // 昼だけ（夜食なし）
    input.sleepDays!.push({ date: shift(d, 1), sleepH: offSleepH });
    d = shift(d, -1);
  }
  return input;
}

describe('detectLaws: sleep_factor（夜食×睡眠）', () => {
  it('食べた日の睡眠が30分以上短い → 「短い」の法則（分は四捨五入）', () => {
    // 夜食日6.0h vs なし7.0h = 60分短い
    const laws = detectLaws(withSleep(5, 5, 6.0, 7.0));
    const law = laws.find((l) => l.kind === 'sleep_factor');
    expect(law).toBeDefined();
    expect(law!.id).toBe('sleep_factor');
    expect(law!.p).toEqual({ dir: 'short', min: 60, late: 5, off: 5 });
    expect(law!.title).toBe('あなたは21時以降に食べた日、睡眠が平均60分短い');
  });

  it('逆に食べた日のほうが長い → 「長い」の法則', () => {
    // 夜食日7.5h vs なし6.8h = 42分長い
    const laws = detectLaws(withSleep(6, 6, 7.5, 6.8));
    const law = laws.find((l) => l.kind === 'sleep_factor');
    expect(law).toBeDefined();
    expect(law!.p.dir).toBe('long');
    expect(law!.p.min).toBe(42);
    expect(law!.title).toBe('あなたは21時以降に食べた日、睡眠が平均42分長い');
  });

  it('差が30分未満なら法則にしない', () => {
    // 6.8h vs 7.0h = 12分差（閾値未満）
    const laws = detectLaws(withSleep(5, 5, 6.8, 7.0));
    expect(laws.find((l) => l.kind === 'sleep_factor')).toBeUndefined();
  });

  it('データ不足（片群が5日未満）なら法則にしない', () => {
    const laws = detectLaws(withSleep(4, 5, 6.0, 7.0));
    expect(laws.find((l) => l.kind === 'sleep_factor')).toBeUndefined();
  });

  it('睡眠データが無い（hk無し環境などでsleepDays未指定）ならスキップ', () => {
    const input = withSleep(5, 5, 6.0, 7.0);
    delete input.sleepDays;
    expect(detectLaws(input).find((l) => l.kind === 'sleep_factor')).toBeUndefined();
  });

  it('睡眠が引けない日（翌朝のデータ欠け）は両群から除外される', () => {
    const input = withSleep(5, 5, 6.0, 7.0);
    // 夜食日1日ぶんの睡眠を消す → late群が4日になり不成立
    const firstLateNight = shift(shift(TODAY, -1), 1);
    input.sleepDays = input.sleepDays!.filter((x) => x.date !== firstLateNight);
    expect(detectLaws(input).find((l) => l.kind === 'sleep_factor')).toBeUndefined();
  });
});
