// レストタイマーの再発防止（2026-09-17・2026-09-25 終了通知を廃止）。
//
// 【起きた事故】熊田さん「一度戻るボタンから戻ってしまうと、タイマーの通知が来ない」
//   app/lift-session.tsx が AppState リスナーの中でだけ画面の外の知らせを用意し、画面のアンマウントで
//   取り消していた。戻るボタンで離れる＝「用意される前に、用意する人がいなくなる」。
//   静かに何も起きないので、テストが無いと気づけない種類の抜けだった。
//
// 【2026-09-25】熊田さん「レストタイマーの通知のイメージが違う。ダイナミックアイランドにして。
//   今ある通知の機能はなくしてよし」→ 終了時のローカル通知を廃止し、画面の外は Live Activity に一本化。
//
// ここで固定する約束:
//   ① レストを始めたら**その場で**島（Live Activity）に出す（前景・背景を問わない）
//   ② 画面が消えても島は残る（このモジュールは画面のライフサイクルを知らない）
//   ③ 止めたら畳む／付け替えたら新しい終了時刻で出し直す／同じ終了時刻なら出し直さない
//   ④ 0 の合図は同じレストで1回だけ（画面と帯の両方で鳴らさない）
//   ⑤ ソース検査: 終了通知（expo-notifications）が戻っていない・画面側に予約が戻っていない
import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Vibration } from 'react-native';
import { armRest, stopRest, hydrateRest, restEndsAt, restLeft, subscribeRest, __resetRestTimerForTest } from '@/lib/restTimer';
import { startRestActivity, endRestActivity, cleanupRestActivities } from '@/lib/restActivity';
import { LIFT_SESSION_KEY, serializeSessionState } from '@/lib/liftSession';

// 島への口だけ差し替える（本物は jest では no-op なので、呼ばれたかどうかを見る）
jest.mock('@/lib/restActivity', () => ({
  startRestActivity: jest.fn(),
  endRestActivity: jest.fn(() => Promise.resolve()),
  cleanupRestActivities: jest.fn(() => Promise.resolve()),
}));
const start = startRestActivity as jest.Mock;
const end = endRestActivity as jest.Mock;
const cleanup = cleanupRestActivities as jest.Mock;

beforeEach(async () => {
  __resetRestTimerForTest();
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('レストの「画面の外の表示」は「画面」ではなく「タイマー」が持つ', () => {
  it('① 始めた瞬間に島へ出す（背景に回るのを待たない）', async () => {
    const at = Date.now() + 90_000;
    await armRest(at, { exercise: '懸垂' });
    expect(start).toHaveBeenCalledTimes(1);
    const [startedAt, endsAt, exercise] = start.mock.calls[0] as [number, number, string];
    expect(endsAt).toBe(at);
    expect(startedAt).toBeLessThanOrEqual(at);
    expect(exercise).toBe('懸垂');
    expect(restEndsAt()).toBe(at);
  });

  it('② 画面が消えても島は消えない（戻るボタンの事故そのもの）', async () => {
    // 画面のアンマウントに相当する操作はこのモジュールには無い。
    // ＝「画面が消えたら畳む」コードを書ける場所が構造的に存在しない
    await armRest(Date.now() + 90_000);
    expect(end).not.toHaveBeenCalled();
    expect(restEndsAt()).not.toBeNull();
  });

  it('③ 止めたら畳む', async () => {
    await armRest(Date.now() + 90_000);
    await stopRest();
    expect(end).toHaveBeenCalled();
    expect(restEndsAt()).toBeNull();
    expect(start).toHaveBeenCalledTimes(1);   // 止めたときに出し直さない
  });

  it('③ 付け替えたら新しい終了時刻で出し直す（前のは restActivity 側が畳む）', async () => {
    const a = Date.now() + 90_000; const b = Date.now() + 180_000;
    await armRest(a);
    await armRest(b);
    expect(start).toHaveBeenCalledTimes(2);
    expect((start.mock.calls[1] as [number, number])[1]).toBe(b);
  });

  it('③ 同じ終了時刻で呼び直しても出し直さない（島がちらつく）', async () => {
    const at = Date.now() + 90_000;
    await armRest(at, { exercise: '懸垂' });
    await armRest(at, { exercise: 'ディップス' });   // 種目名だけ変わった＝記録画面の effect が走り直した形
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
  });

  it('過ぎた終了時刻を渡されたら畳むだけ（出さない）', async () => {
    await armRest(Date.now() - 1000);
    expect(start).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalled();
    expect(restLeft()).toBe(0);
  });
});

describe('残り時間は購読でき、0の合図は1回だけ', () => {
  it('④ 0 になったら1回だけバイブし、島を畳む（何人購読していても1回）', async () => {
    const vib = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
    jest.useFakeTimers();
    try {
      const a = jest.fn(); const b = jest.fn();
      const offA = subscribeRest(a); const offB = subscribeRest(b);
      await armRest(Date.now() + 1000);
      end.mockClear();
      jest.advanceTimersByTime(3000);
      expect(vib).toHaveBeenCalledTimes(1);   // 購読者は2人でも1回
      expect(end).toHaveBeenCalledTimes(1);   // 前景で 0 を見た＝畳む
      expect(a).toHaveBeenCalled();
      expect(b).toHaveBeenCalled();
      offA(); offB();
    } finally {
      jest.useRealTimers();
      vib.mockRestore();
    }
  });

  it('残り秒は止まっていれば null・走っていれば正・終われば 0', async () => {
    const now = Date.now();
    expect(restLeft(now)).toBeNull();
    await armRest(now + 30_000);
    expect(restLeft(now)).toBe(30);
    expect(restLeft(now + 60_000)).toBe(0);
  });
});

describe('アプリを立ち上げ直しても続く', () => {
  it('途中のレストを端末から拾い直し、残骸を掃除してから種目名つきで島に出し直す', async () => {
    const at = Date.now() + 120_000;
    await AsyncStorage.setItem(LIFT_SESSION_KEY, serializeSessionState({
      date: '2026-09-17', sets: [{ id: 's1', name: '懸垂', kg: 0, reps: 8 }], restSec: 90, restEndsAt: at, startedAt: Date.now(),
    }));
    await hydrateRest();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(restEndsAt()).toBe(at);
    expect(start).toHaveBeenCalledTimes(1);
    expect((start.mock.calls[0] as [number, number, string])[2]).toBe('懸垂');
    // 掃除が先、出し直しが後（逆だと出したばかりの島を自分で消す）
    expect(cleanup.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0]);
  });

  it('起動前に終わっていたレストは拾わない（開いた瞬間に鳴らさない・島にも出さない）', async () => {
    await AsyncStorage.setItem(LIFT_SESSION_KEY, serializeSessionState({
      date: '2026-09-17', sets: [], restSec: 90, restEndsAt: Date.now() - 60_000, startedAt: Date.now() - 200_000,
    }));
    await hydrateRest();
    expect(restEndsAt()).toBeNull();
    expect(start).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);   // 残骸の掃除だけはする
  });
});

describe('ソース検査（また画面側に戻さない・通知を復活させない）', () => {
  const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  it('⑤ 筋トレ記録画面は画面の外の知らせを自前で持たない（lib/restTimer.ts に一本化）', () => {
    const s = src('app/lift-session.tsx');
    expect(s).not.toMatch(/scheduleNotificationAsync/);
    expect(s).not.toMatch(/cancelScheduledNotificationAsync/);
    expect(s).not.toMatch(/startRestActivity|endRestActivity/);
    expect(s).toContain("from '@/lib/restTimer'");
  });

  it('⑤ レスト終了のローカル通知は廃止（2026-09-25・熊田さん）。restTimer / restActivity は expo-notifications を使わない', () => {
    for (const p of ['lib/restTimer.ts', 'lib/restActivity.ts', 'components/RestTimerBar.tsx']) {
      expect(src(p)).not.toMatch(/expo-notifications|scheduleNotificationAsync|getPermissionsAsync/);
    }
  });

  it('⑤ レストの終了時刻を AppState の変化で出す書き方が復活していない', () => {
    // 「背景に回った瞬間にだけ用意する」が事故の形。コード（コメントを除いた本体）の中で
    // AppState と島の開始が同居していないことを見る
    const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const p of ['app/lift-session.tsx', 'lib/restTimer.ts', 'components/RestTimerBar.tsx']) {
      const c = code(p);
      if (!/AppState/.test(c)) continue;
      expect(c).not.toMatch(/startRestActivity|scheduleNotificationAsync/);
    }
  });

  it('⑤ レスト中の帯はルート（Stack の外）に置く＝画面を離れても消えない', () => {
    const s = src('app/_layout.tsx');
    expect(s).toContain('<RestTimerBar />');
    // Stack の閉じタグより後ろに置く（中に入れると画面ごと作り直されたときに消える）
    expect(s.indexOf('<RestTimerBar />')).toBeGreaterThan(s.indexOf('</GuideProvider>'));
  });
});
