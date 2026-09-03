// 起床時刻の窓（lib/wakeTime.ts）の再発防止。
//
// 固定するのは3つ:
//   ① 「朝の窓」と「起床前」の境界（深夜に朝のものを出さない・**日付を跨ぐ夜勤でも壊れない**）
//   ② 壊れた保存値・範囲外の値が既定（7:00）へ落ちること
//   ③ 深夜の「前日として記録」を**出す条件**と**行き先の日付**（勝手に前日へ寄せない）
//
// ここが崩れると「0:30 に開くと翌日の気分を聞かれる」（熊田さんの指摘・2026-09-04）が再発する。
import {
  MORNING_SPAN_HOURS, REMINDER_OFFSET_HOURS, WAKE_DEFAULT_HM, WAKE_TIME_DEFAULT,
  beforeWake, defaultReminderHour, fmtWakeTime, isMorningWindow, minutesSinceWake, minutesToWake,
  morningEndHm, parseWakeTime, previousDayTarget, shiftIsoDate, wakeOrDefault,
} from '../wakeTime';

const hm = (h: number, m = 0) => ({ h, m });
const WAKE7 = hm(7, 0);
const WAKE5 = hm(5, 0);
const WAKE10 = hm(10, 30);
const WAKE23 = hm(23, 0);   // 夜勤（日付を跨ぐ）

describe('parseWakeTime / fmtWakeTime（壊れた値は既定へ）', () => {
  it("'HH:mm' と 'H:mm' の両方を読める", () => {
    expect(parseWakeTime('07:00')).toEqual(WAKE7);
    expect(parseWakeTime('7:00')).toEqual(WAKE7);
    expect(parseWakeTime(' 23:45 ')).toEqual(hm(23, 45));
  });

  it('壊れた値・範囲外は null（静かに間違った時刻で判定しない）', () => {
    for (const bad of ['', '7', '7:0', '24:00', '07:60', '-1:00', 'abc', '7:00:00', null, undefined, '１０:００']) {
      expect(parseWakeTime(bad as string)).toBeNull();
    }
  });

  it('wakeOrDefault は不正値を既定（7:00）へ寄せる', () => {
    expect(wakeOrDefault('05:15')).toEqual(hm(5, 15));
    expect(wakeOrDefault('99:99')).toEqual(WAKE_DEFAULT_HM);
    expect(wakeOrDefault(null)).toEqual(WAKE_DEFAULT_HM);
  });

  it('既定値の文字列と {h,m} が一致している（設定の初期表示と判定がズレない）', () => {
    expect(fmtWakeTime(WAKE_DEFAULT_HM)).toBe(WAKE_TIME_DEFAULT);
    expect(parseWakeTime(WAKE_TIME_DEFAULT)).toEqual(WAKE_DEFAULT_HM);
  });

  it('fmtWakeTime は時もゼロ埋めする（文字列比較で時刻順に並ぶ）', () => {
    expect(fmtWakeTime(hm(7, 5))).toBe('07:05');
    expect(fmtWakeTime(hm(23, 30))).toBe('23:30');
  });
});

describe('minutesSinceWake / minutesToWake（日付跨ぎの算術）', () => {
  it('起床後の経過分は0から1439に収まる', () => {
    expect(minutesSinceWake(hm(7, 0), WAKE7)).toBe(0);
    expect(minutesSinceWake(hm(9, 30), WAKE7)).toBe(150);
    expect(minutesSinceWake(hm(6, 59), WAKE7)).toBe(1439);
  });

  it('**日付を跨いでも正しい**（起床23:00・いま1:00 → 2時間前に起きた）', () => {
    expect(minutesSinceWake(hm(1, 0), WAKE23)).toBe(120);
    expect(minutesSinceWake(hm(22, 0), WAKE23)).toBe(1380);
  });

  it('次の起床までの分（ちょうど起床時刻なら0）', () => {
    expect(minutesToWake(hm(7, 0), WAKE7)).toBe(0);
    expect(minutesToWake(hm(3, 0), WAKE7)).toBe(240);
    expect(minutesToWake(hm(23, 0), WAKE7)).toBe(480);
  });
});

describe('isMorningWindow（朝＝起床から5時間・境界は [wake, wake+span)）', () => {
  it('7:00起床なら 7:00〜11:59 が朝・12:00 で閉じる', () => {
    expect(isMorningWindow(hm(7, 0), WAKE7)).toBe(true);
    expect(isMorningWindow(hm(11, 59), WAKE7)).toBe(true);
    expect(isMorningWindow(hm(12, 0), WAKE7)).toBe(false);
    expect(isMorningWindow(hm(6, 59), WAKE7)).toBe(false);
  });

  it('早起き（5:00）は早く閉じ、遅起き（10:30）は遅くまで開く＝生活リズムに追従する', () => {
    expect(isMorningWindow(hm(9, 59), WAKE5)).toBe(true);
    expect(isMorningWindow(hm(10, 0), WAKE5)).toBe(false);   // 5:00+5h
    expect(isMorningWindow(hm(10, 0), WAKE10)).toBe(false);  // まだ起きていない
    expect(isMorningWindow(hm(10, 30), WAKE10)).toBe(true);
    expect(isMorningWindow(hm(15, 29), WAKE10)).toBe(true);  // 10:30+5h=15:30
    expect(isMorningWindow(hm(15, 30), WAKE10)).toBe(false);
  });

  it('**夜勤（起床23:00）でも日付を跨いで正しい**: 23:00〜翌4:00 が朝', () => {
    expect(isMorningWindow(hm(23, 0), WAKE23)).toBe(true);
    expect(isMorningWindow(hm(0, 30), WAKE23)).toBe(true);
    expect(isMorningWindow(hm(3, 59), WAKE23)).toBe(true);
    expect(isMorningWindow(hm(4, 0), WAKE23)).toBe(false);
    expect(isMorningWindow(hm(22, 59), WAKE23)).toBe(false);
  });

  it('span を変えても境界が保たれる（0は常に false・24以上は常に true）', () => {
    expect(isMorningWindow(hm(8, 0), WAKE7, 1)).toBe(false);
    expect(isMorningWindow(hm(7, 59), WAKE7, 1)).toBe(true);
    expect(isMorningWindow(hm(7, 0), WAKE7, 0)).toBe(false);
    expect(isMorningWindow(hm(3, 0), WAKE7, 24)).toBe(true);
  });

  it('既定の span は5時間（morningEndHm が窓の終わりを言える）', () => {
    expect(MORNING_SPAN_HOURS).toBe(5);
    expect(morningEndHm(WAKE7)).toBe('12:00');
    expect(morningEndHm(WAKE23)).toBe('04:00');   // 跨ぎも表示できる
  });
});

describe('beforeWake（＝本人の体感では「まだ昨日の夜」・ここで朝のものを止める）', () => {
  it('**0:30 は起床前**（これが直したかった事故: 深夜に翌日の気分・過食アラートが出ていた）', () => {
    expect(beforeWake(hm(0, 30), WAKE7)).toBe(true);
    expect(beforeWake(hm(3, 0), WAKE7)).toBe(true);
    expect(beforeWake(hm(6, 59), WAKE7)).toBe(true);
  });

  it('起床時刻を過ぎたら false（朝のものが出るようになる）', () => {
    expect(beforeWake(hm(7, 0), WAKE7)).toBe(false);
    expect(beforeWake(hm(12, 0), WAKE7)).toBe(false);   // 朝の窓を過ぎても「前日扱い」ではない
    expect(beforeWake(hm(23, 30), WAKE7)).toBe(false);
  });

  it('遅起き（10:30）の人は 10:29 まで「まだ前日」＝朝を待てる', () => {
    expect(beforeWake(hm(9, 0), WAKE10)).toBe(true);
    expect(beforeWake(hm(10, 29), WAKE10)).toBe(true);
    expect(beforeWake(hm(10, 30), WAKE10)).toBe(false);
  });

  it('**夜勤（起床23:00）で朝の窓の中は false**（暦の分数だけで比べると1日ほぼ全部が前日扱いになり機能が死ぬ）', () => {
    expect(beforeWake(hm(1, 0), WAKE23)).toBe(false);    // 起床2時間後＝朝
    expect(beforeWake(hm(3, 59), WAKE23)).toBe(false);
    expect(beforeWake(hm(4, 0), WAKE23)).toBe(true);      // 窓を抜けたら次の起床を待つ
    expect(beforeWake(hm(22, 0), WAKE23)).toBe(true);
    expect(beforeWake(hm(23, 0), WAKE23)).toBe(false);
  });
});

describe('defaultReminderHour（未選択時の既定だけを起床から作る）', () => {
  it('既定7:00なら21:00＝**従来の既定と完全に一致**（既存ユーザーの既定は動かない）', () => {
    expect(REMINDER_OFFSET_HOURS).toBe(14);
    expect(defaultReminderHour(WAKE7)).toBe(21);
  });

  it('早起き・遅起きに追従し、跨いでも0-23に収まる', () => {
    expect(defaultReminderHour(WAKE5)).toBe(19);
    expect(defaultReminderHour(WAKE10)).toBe(0);   // 10:30起床 → 10+14=24 → 0時に折り返す
    expect(defaultReminderHour(WAKE23)).toBe(13);
    for (let h = 0; h < 24; h++) {
      const v = defaultReminderHour(hm(h));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(23);
    }
  });
});

describe('shiftIsoDate（前日の算出・月末とうるう年）', () => {
  it('月初と年始を跨いでも正しい', () => {
    expect(shiftIsoDate('2026-09-04', -1)).toBe('2026-09-03');
    expect(shiftIsoDate('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftIsoDate('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftIsoDate('2024-03-01', -1)).toBe('2024-02-29');   // うるう年
  });

  it('壊れた入力は null（「前日として記録」を出さない合図）', () => {
    expect(shiftIsoDate('2026-9-4', -1)).toBeNull();
    expect(shiftIsoDate('', -1)).toBeNull();
    expect(shiftIsoDate('abc', -1)).toBeNull();
  });
});

describe('previousDayTarget（深夜の「前日として記録」）', () => {
  it('**起床前のときだけ**出る。行き先は前日', () => {
    expect(previousDayTarget('2026-09-04', hm(0, 30), WAKE7)).toBe('2026-09-03');
    expect(previousDayTarget('2026-09-04', hm(6, 59), WAKE7)).toBe('2026-09-03');
  });

  it('起床後は出さない（昼に「前日として」を出すと日付の意味が曖昧になる）', () => {
    expect(previousDayTarget('2026-09-04', hm(7, 0), WAKE7)).toBeNull();
    expect(previousDayTarget('2026-09-04', hm(21, 0), WAKE7)).toBeNull();
  });

  it('過去日を表示中は出さない（「前日として」が二重の意味になる）', () => {
    expect(previousDayTarget('2026-09-01', hm(0, 30), WAKE7, '2026-09-04')).toBeNull();
  });

  it('起床時刻の設定に追従する（遅起きなら朝10時台でもまだ「前日」）', () => {
    expect(previousDayTarget('2026-09-04', hm(9, 0), WAKE10)).toBe('2026-09-03');
    expect(previousDayTarget('2026-09-04', hm(9, 0), WAKE5)).toBeNull();
  });

  it('夜勤（起床23:00）の朝の窓の中は出さない（本人にとっては「今日の朝」だから）', () => {
    expect(previousDayTarget('2026-09-04', hm(1, 0), WAKE23)).toBeNull();
    expect(previousDayTarget('2026-09-04', hm(5, 0), WAKE23)).toBe('2026-09-03');
  });

  it('月をまたぐ深夜でも前日を正しく指す', () => {
    expect(previousDayTarget('2026-09-01', hm(0, 10), WAKE7)).toBe('2026-08-31');
  });
});
