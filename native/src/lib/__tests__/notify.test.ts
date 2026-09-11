// smart リマインダーの予約キーと取消キー（QA A-2）。
//
// 元のバグ: 予約側は端末ローカル日付、取消側は todayJST() でキーを作っていた。
// 非JSTの人（例: America/New_York・UTC−5）が昼に記録すると、
//   ・JSTでは既に「明日」なので **明日のぶん** が取り消され
//   ・**今夜のぶん** は残って鳴る
// 「記録したのに催促される」「明日は催促されない」が同時に起きる。
//
// 【テストの作り方】端末TZを America/New_York に固定して確かめたかったが、
// jest のサンドボックスは process.env を複製して持つため、テスト内で TZ を変えても
// V8 のタイムゾーンは切り替わらない（Windows では起動時の TZ 環境変数も効かない）。
// そこで「ローカル日付 ≠ todayJST()」という**ズレそのもの**を todayJST のモックで作る。
// 実TZでの最終確認は docs の実機チェックリスト（America/New_York で13:00に記録）に残す。
jest.mock('../calc', () => ({
  ...jest.requireActual('../calc'),
  // 非JST端末の再現: ローカル日付とJST日付が食い違っている状態
  todayJST: jest.fn(() => '2099-12-31'),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { readFileSync } from 'fs';
import { join } from 'path';
import { reminderDateKey, applyDailyReminder, skipTodayReminder } from '../notify';
import { todayJST } from '../calc';

const SMART_KEY = 'bl-notif-smart-ids';
const MODE_KEY = 'bl-notif-daily-mode';
const TIME_KEY = 'bl-notif-daily-time';
const SMART_HORIZON = 14;
const HOUR = 21;   // 今日のぶんが「まだ未来」になるよう、下でローカル9時に合わせる

async function smartMap(): Promise<Record<string, string>> {
  return JSON.parse((await AsyncStorage.getItem(SMART_KEY)) || '{}');
}

/** from から i 日後の暦日キー（DSTに影響されない進め方） */
function localDateKey(from: Date, i: number): string {
  const d = new Date(from.getTime());
  d.setDate(from.getDate() + i);
  return reminderDateKey(d);
}

/** 実行環境のTZに関係なく「ローカル9:00」に時計を合わせる（今夜21:00が未来になる） */
function setClockToLocalMorning(iso: string): Date {
  jest.setSystemTime(new Date(iso));
  const h = new Date().getHours();
  jest.setSystemTime(new Date(Date.now() + ((9 - h + 24) % 24) * 3600_000));
  return new Date();
}

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([[MODE_KEY, 'smart'], [TIME_KEY, `${HOUR}:00`]]);
  (todayJST as jest.Mock).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ローカル日付とJST日付がズレている端末（非JSTの人）', () => {
  it('記録したときに消えるのは「今夜のぶん」で、「明日のぶん」は残る', async () => {
    const now = setClockToLocalMorning('2026-11-01T12:00:00Z');
    await applyDailyReminder();

    const before = await smartMap();
    const todayKey = reminderDateKey(now);
    const tomorrowKey = localDateKey(now, 1);
    expect(before[todayKey]).toBeDefined();     // 今夜21:00のぶん
    expect(before[tomorrowKey]).toBeDefined();  // 明日のぶん
    expect(before[todayJST()]).toBeUndefined(); // JST日付のキーはそもそも積まれていない

    await skipTodayReminder();

    const after = await smartMap();
    // 修正前は todayJST() のキーを消しに行くので、今夜のぶんが残り明日のぶんが消えていた
    expect(after[todayKey]).toBeUndefined();
    expect(after[tomorrowKey]).toBeDefined();
  });

  it('取消キーの生成に todayJST を使わない（予約側と同じ関数だけを通る）', async () => {
    setClockToLocalMorning('2026-11-01T12:00:00Z');
    await applyDailyReminder();
    (todayJST as jest.Mock).mockClear();
    await skipTodayReminder();
    expect(todayJST).not.toHaveBeenCalled();
  });
});

describe('14日ぶんの先積み', () => {
  it('連続した暦日が1日ずつ・重複なく積まれる（夏時間の週でも飛ばさない）', async () => {
    // 2026-03-08 に米国の夏時間が始まる週。+i*86400000 だと1時間ずれて日付が飛ぶ
    const now = setClockToLocalMorning('2026-03-04T12:00:00Z');
    await applyDailyReminder();

    const keys = Object.keys(await smartMap()).sort();
    const want = Array.from({ length: SMART_HORIZON }, (_, i) => localDateKey(now, i)).sort();
    expect(keys).toEqual(want);
    expect(new Set(keys).size).toBe(SMART_HORIZON);   // 同じ日が2回積まれていない
  });
});

describe('reminderDateKey', () => {
  it('ローカルの暦日を YYYY-MM-DD で返す（0埋めあり）', () => {
    expect(reminderDateKey(new Date(2026, 0, 5, 21, 0))).toBe('2026-01-05');
    expect(reminderDateKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('setDate で日を進めれば暦日が1日ずつ進む', () => {
    const base = new Date(2026, 2, 6, 23, 30);
    const keys = Array.from({ length: 5 }, (_, i) => localDateKey(base, i));
    expect(keys).toEqual(['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
  });
});

// 上の2つはローカルTZがJST（DSTなし）のCIでは「DSTでも飛ばない」ことまでは示せない。
// 実装が元の書き方に戻っていないことをソースで固定する（themeConvention.test.ts と同じ作法）。
describe('実装の規約', () => {
  const SRC = readFileSync(join(__dirname, '..', 'notify.ts'), 'utf8');

  it('smartの先積みは setDate で日を進める（+i*86400000 に戻さない）', () => {
    expect(SRC).not.toMatch(/i\s*\*\s*86400000/);
    expect(SRC).toMatch(/setDate\(\s*now\.getDate\(\)\s*\+\s*i\s*\)/);
  });

  it('日付キーの組み立てはこのファイルに1か所だけ（reminderDateKey の中）', () => {
    // `${d.getFullYear()}-${String(...)}` のベタ書きが増えると、また片方だけズレる
    const inline = SRC.match(/getFullYear\(\)\}-\$\{String\(/g) ?? [];
    expect(inline).toHaveLength(1);
  });
});
