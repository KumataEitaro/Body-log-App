// 歩数・睡眠の「過去日の詳しい記録」（feat/health-history）の日付規則。
//
// ここが崩れると「9/3を選んでいるのに9/2の記録が出る」「7日表の先頭が飛ぶ」という
// 1日ズレ事故になる。月またぎ・年またぎ・うるう日・壊れた入力・HealthKitへ渡す
// 時間窓（JST 0:00 起点／末尾は翌日0:00の排他）まで固定する。
import {
  shiftYmd, daysEndingAt, mdOf, sleepHeading, weekMondayOf, activityRange, fillDays, hasDayRecord,
} from '../healthHistory';

describe('shiftYmd（日付の加減算）', () => {
  it('前後にずらせる', () => {
    expect(shiftYmd('2026-09-10', -1)).toBe('2026-09-09');
    expect(shiftYmd('2026-09-10', 1)).toBe('2026-09-11');
    expect(shiftYmd('2026-09-10', 0)).toBe('2026-09-10');
  });

  it('月・年をまたぐ', () => {
    expect(shiftYmd('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftYmd('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftYmd('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('うるう年の2/29を作れる', () => {
    expect(shiftYmd('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftYmd('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('壊れた入力はそのまま返す（画面が空白になるより日付文字列が出るほうがまし）', () => {
    expect(shiftYmd('', -1)).toBe('');
    expect(shiftYmd('2026/09/10', -1)).toBe('2026/09/10');
  });
});

describe('daysEndingAt（選んだ日を末尾とする日付列）', () => {
  it('古い→新しいの順で、末尾が選んだ日', () => {
    expect(daysEndingAt('2026-09-10', 7)).toEqual([
      '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
    ]);
  });

  it('月をまたいでも日付が飛ばない', () => {
    expect(daysEndingAt('2026-03-02', 4)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });

  it('1日ぶん／0日以下', () => {
    expect(daysEndingAt('2026-09-10', 1)).toEqual(['2026-09-10']);
    expect(daysEndingAt('2026-09-10', 0)).toEqual([]);
    expect(daysEndingAt('2026-09-10', -3)).toEqual([]);
  });
});

describe('mdOf（M/D表記）', () => {
  it('ゼロ埋めしない', () => {
    expect(mdOf('2026-09-03')).toBe('9/3');
    expect(mdOf('2026-12-25')).toBe('12/25');
  });

  it('壊れた入力は空文字（「NaN/NaN」を出さない）', () => {
    expect(mdOf('')).toBe('');
    expect(mdOf('きのう')).toBe('');
  });
});

describe('sleepHeading（睡眠ブロックの見出し）', () => {
  it('今日は「昨夜の睡眠」', () => {
    expect(sleepHeading('2026-09-10', '2026-09-10')).toBe('昨夜の睡眠');
  });

  it('過去日は「{m}/{d} の睡眠」＝その朝に起きたぶん', () => {
    expect(sleepHeading('2026-09-03', '2026-09-10')).toBe('9/3 の睡眠');
    expect(sleepHeading('2026-12-01', '2026-12-10')).toBe('12/1 の睡眠');
  });
});

describe('weekMondayOf（月曜起点の週）', () => {
  it('週内のどの日でも同じ月曜になる（2026-09-07が月曜）', () => {
    for (const d of ['2026-09-07', '2026-09-08', '2026-09-10', '2026-09-13']) {
      expect(weekMondayOf(d)).toBe('2026-09-07');
    }
  });

  it('日曜はその週の月曜（翌週にしない）', () => {
    expect(weekMondayOf('2026-09-06')).toBe('2026-08-31');
  });
});

describe('activityRange（HealthKitへ渡す読み取り窓）', () => {
  it('末尾日の翌日0:00 JSTまで（排他）・先頭は days-1 日前の0:00 JST', () => {
    const r = activityRange(7, '2026-09-10');
    expect(r.start.toISOString()).toBe('2026-09-03T15:00:00.000Z'); // 9/4 0:00 JST
    expect(r.end.toISOString()).toBe('2026-09-10T15:00:00.000Z');   // 9/11 0:00 JST
  });

  it('1日ぶんはその日の0:00〜翌0:00（24時間ちょうど）', () => {
    const r = activityRange(1, '2026-09-10');
    expect(r.end.getTime() - r.start.getTime()).toBe(86400000);
  });

  it('days<1 は1日として扱う（窓が反転しない）', () => {
    const r = activityRange(0, '2026-09-10');
    expect(r.end.getTime() - r.start.getTime()).toBe(86400000);
  });
});

describe('fillDays（記録の無い日も行にする）', () => {
  const dates = daysEndingAt('2026-09-10', 3); // 9/8, 9/9, 9/10

  it('日付列と同じ長さ・同じ順で並ぶ', () => {
    const rows = fillDays([{ date: '2026-09-09', steps: 8000, sleepH: 7.2, activeKcal: 320 }], dates);
    expect(rows.map((r) => r.date)).toEqual(dates);
    expect(rows[1]).toEqual({ date: '2026-09-09', steps: 8000, sleepH: 7.2, activeKcal: 320 });
  });

  it('無い日は0埋め（日付が飛ばない）', () => {
    const rows = fillDays([], dates);
    expect(rows).toEqual(dates.map((date) => ({ date, steps: 0, sleepH: 0, activeKcal: 0 })));
  });

  it('日付列にない記録は捨てる（窓の外の日が混ざらない）', () => {
    const rows = fillDays([{ date: '2026-08-01', steps: 100, sleepH: 1, activeKcal: 1 }], dates);
    expect(rows.every((r) => r.steps === 0)).toBe(true);
  });
});

describe('hasDayRecord（「この日の記録はありません」の判定）', () => {
  it('歩数・睡眠・アクティブのどれかがあれば記録あり', () => {
    expect(hasDayRecord({ date: '2026-09-10', steps: 1, sleepH: 0, activeKcal: 0 })).toBe(true);
    expect(hasDayRecord({ date: '2026-09-10', steps: 0, sleepH: 6.5, activeKcal: 0 })).toBe(true);
    expect(hasDayRecord({ date: '2026-09-10', steps: 0, sleepH: 0, activeKcal: 210 })).toBe(true);
  });

  it('全部0／未読込は記録なし', () => {
    expect(hasDayRecord({ date: '2026-09-10', steps: 0, sleepH: 0, activeKcal: 0 })).toBe(false);
    expect(hasDayRecord(null)).toBe(false);
    expect(hasDayRecord(undefined)).toBe(false);
  });
});
