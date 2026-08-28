// スタートチェックリストの表示判定（純関数）のテスト
import { shouldShowChecklist } from '@/components/StartChecklist';

const DAY = 86400000;
const now = Date.parse('2026-08-29T12:00:00Z');
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

describe('shouldShowChecklist', () => {
  test('登録直後は表示する', () => {
    expect(shouldShowChecklist(iso(0), null, now)).toBe(true);
  });
  test('登録から14日以内は表示する', () => {
    expect(shouldShowChecklist(iso(13 * DAY), null, now)).toBe(true);
  });
  test('登録から14日を超えたら表示しない', () => {
    expect(shouldShowChecklist(iso(15 * DAY), null, now)).toBe(false);
  });
  test('登録日が不明（created_atなし）なら表示しない', () => {
    expect(shouldShowChecklist(undefined, null, now)).toBe(false);
    expect(shouldShowChecklist('not-a-date', null, now)).toBe(false);
  });
  test('全完了から24時間以内は祝祭を見せるため表示する', () => {
    expect(shouldShowChecklist(iso(3 * DAY), now - 3600000, now)).toBe(true);
  });
  test('全完了から24時間たったら自動で消える', () => {
    expect(shouldShowChecklist(iso(3 * DAY), now - 25 * 3600000, now)).toBe(false);
  });
});
