// バイタルの純関数。ここは「診断しない」約束を固定する場所でもある。
// needsDoctorNote は受診をすすめる一言を出すかどうかの真偽だけを返し、
// 病名・重症度は一切持たない（呼び出し側も真偽しか受け取れない）。
// テストはロケール未設定（=日本語キーがそのまま返る）前提で日本語文字列を比較する。
import { needsDoctorNote, anyNeedsDoctorNote, vitalsSummary, addDays, type Vital } from '../vitals';

function v(p: Partial<Vital>): Vital {
  return { date: '2026-09-01', systolic: null, diastolic: null, pulse: null, glucose: null, note: null, ...p };
}

describe('needsDoctorNote', () => {
  it('通常域では一言を出さない', () => {
    expect(needsDoctorNote(v({ systolic: 128, diastolic: 82, glucose: 105 }))).toBe(false);
  });
  it('収縮期180以上で出す', () => {
    expect(needsDoctorNote(v({ systolic: 180, diastolic: 90 }))).toBe(true);
  });
  it('拡張期110以上で出す', () => {
    expect(needsDoctorNote(v({ systolic: 150, diastolic: 110 }))).toBe(true);
  });
  it('低すぎる収縮期でも出す', () => {
    expect(needsDoctorNote(v({ systolic: 78, diastolic: 50 }))).toBe(true);
  });
  it('血糖の高値・低値で出す', () => {
    expect(needsDoctorNote(v({ glucose: 320 }))).toBe(true);
    expect(needsDoctorNote(v({ glucose: 55 }))).toBe(true);
  });
  it('未入力（全部null）では出さない', () => {
    expect(needsDoctorNote(v({}))).toBe(false);
  });
  it('脈拍だけでは判定しない（脈は受診の目安に使わない）', () => {
    expect(needsDoctorNote(v({ pulse: 200 }))).toBe(false);
  });
});

describe('anyNeedsDoctorNote', () => {
  it('1日でも該当すれば真', () => {
    expect(anyNeedsDoctorNote([v({ systolic: 120, diastolic: 70 }), v({ systolic: 190, diastolic: 95 })])).toBe(true);
  });
  it('空配列は偽', () => {
    expect(anyNeedsDoctorNote([])).toBe(false);
  });
});

describe('vitalsSummary', () => {
  it('記録が無ければ誘い文', () => {
    expect(vitalsSummary([])).toBe('血圧・脈拍・血糖を残す');
  });
  it('最新の血圧を優先する（配列は日付昇順）', () => {
    const list = [v({ date: '2026-08-30', systolic: 140, diastolic: 90 }), v({ date: '2026-09-01', systolic: 128, diastolic: 82 })];
    expect(vitalsSummary(list)).toBe('最新 128/82');
  });
  it('血圧が無い日は血糖・脈拍にフォールバックする', () => {
    expect(vitalsSummary([v({ glucose: 99 })])).toBe('最新 血糖 99');
    expect(vitalsSummary([v({ pulse: 64 })])).toBe('最新 脈拍 64');
  });
});

describe('addDays', () => {
  it('月をまたいでも正しく戻る', () => {
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
    expect(addDays('2026-09-01', -29)).toBe('2026-08-03');
  });
});
