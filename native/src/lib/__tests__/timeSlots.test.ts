// 「食べた時間」の純関数（docs/INSIGHTS-ENGINE.md §4）。
// 8区分の境界（開始を含み終了を含まない）と、トレイの時刻チップ→logs.at の組み立てを固定する。
import {
  slotOf, slotIndexOf, resolveMealTime, buildAtJST, hmJST, parseHm, fmtHm, roundHm,
  MEAL_TIME_NOW, MEAL_TIME_PAST_DEFAULT,
} from '../timeSlots';

describe('slotOf: 8区分の時間帯', () => {
  it('早朝 4–7（4時ちょうどは早朝・3時台は深夜）', () => {
    expect(slotOf(4)).toBe('earlyMorning');
    expect(slotOf(6)).toBe('earlyMorning');
    expect(slotOf(3)).toBe('lateNight');
  });
  it('朝 7–10（7時ちょうどは朝＝6時台の早朝と切り替わる）', () => {
    expect(slotOf(7)).toBe('morning');
    expect(slotOf(9)).toBe('morning');
  });
  it('午前 10–12', () => {
    expect(slotOf(10)).toBe('forenoon');
    expect(slotOf(11)).toBe('forenoon');
  });
  it('昼 12–14（12時ちょうどは昼）', () => {
    expect(slotOf(12)).toBe('noon');
    expect(slotOf(13)).toBe('noon');
  });
  it('午後 14–17', () => {
    expect(slotOf(14)).toBe('afternoon');
    expect(slotOf(16)).toBe('afternoon');
  });
  it('夕 17–20', () => {
    expect(slotOf(17)).toBe('evening');
    expect(slotOf(19)).toBe('evening');
  });
  it('夜 20–23（22時台まで夜）', () => {
    expect(slotOf(20)).toBe('night');
    expect(slotOf(22)).toBe('night');
  });
  it('深夜 23–翌4（23時ちょうど・0時・24=翌0時・負数や非数も深夜側に丸める）', () => {
    expect(slotOf(23)).toBe('lateNight');
    expect(slotOf(0)).toBe('lateNight');
    expect(slotOf(24)).toBe('lateNight');
    expect(slotOf(-1)).toBe('lateNight');
    expect(slotOf(Number.NaN)).toBe('lateNight');
    // 添字は features.ts の time_slots 配列と同じ並び（早朝=0 … 深夜=7）
    expect(slotIndexOf(4)).toBe(0);
    expect(slotIndexOf(23)).toBe(7);
  });
});

describe('トレイの時刻チップ → logs.at', () => {
  it('未操作: 今日は「いま」、過去日は12:00（過去日に現在時刻を入れるのは嘘）', () => {
    expect(resolveMealTime(null, true)).toBe(MEAL_TIME_NOW);
    expect(resolveMealTime(null, false)).toBe(MEAL_TIME_PAST_DEFAULT);
    // 「いま」を選んだまま過去日へ移っても、過去日に「いま」は存在しない
    expect(resolveMealTime(MEAL_TIME_NOW, false)).toBe(MEAL_TIME_PAST_DEFAULT);
    expect(resolveMealTime('19:00', false)).toBe('19:00');
    expect(resolveMealTime('7:00', true)).toBe('7:00');
  });
  it('buildAtJST: 表示中の日付＋選んだ時刻をJSTで組み、UTCのISOで返す', () => {
    // 2026-09-02 19:00 JST = 2026-09-02 10:00 UTC
    expect(buildAtJST('2026-09-02', '19:00')).toBe('2026-09-02T10:00:00.000Z');
    // 7:00 JST は前日 22:00 UTC（日付をまたいでも date 側の日に属する）
    expect(buildAtJST('2026-09-02', '7:00')).toBe('2026-09-01T22:00:00.000Z');
    expect(buildAtJST('2026-09-02', '25:00')).toBeNull();
    expect(buildAtJST('bad', '12:00')).toBeNull();
  });
  it('hmJST: 元の記録の at から「書き換える」の既定時刻を出す（往復で一致）', () => {
    expect(hmJST('2026-09-02T10:00:00.000Z')).toBe('19:00');
    expect(hmJST('2026-09-01T22:15:00+00:00')).toBe('7:15');
    expect(hmJST(buildAtJST('2026-09-02', '22:45'))).toBe('22:45');
    expect(hmJST(null)).toBeNull();
    expect(hmJST('garbage')).toBeNull();
  });
  it('parseHm / fmtHm / roundHm: 15分刻みの丸めと表記', () => {
    expect(parseHm('07:05')).toEqual({ h: 7, m: 5 });
    expect(parseHm('7:5')).toBeNull();
    expect(fmtHm(7, 5)).toBe('7:05');
    expect(roundHm(12, 7)).toEqual({ h: 12, m: 0 });
    expect(roundHm(12, 8)).toEqual({ h: 12, m: 15 });
    expect(roundHm(23, 55)).toEqual({ h: 0, m: 0 });   // 繰り上げは翌0時に巻く
  });
});
