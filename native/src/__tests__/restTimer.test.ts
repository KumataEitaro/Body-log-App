// レストタイマーの再発防止（2026-09-17）。
//
// 【起きた事故】熊田さん「一度戻るボタンから戻ってしまうと、タイマーの通知が来ない」
//   app/lift-session.tsx が AppState リスナーの中でだけ通知を予約し、画面のアンマウントで
//   取り消していた。戻るボタンで離れる＝「予約される前に、予約する人がいなくなる」。
//   静かに何も起きないので、テストが無いと気づけない種類の抜けだった。
//
// ここで固定する約束:
//   ① レストを始めたら**その場で**通知を予約する（前景・背景を問わない）
//   ② 画面が消えても予約は残る（このモジュールは画面のライフサイクルを知らない）
//   ③ 止めたら予約も消える／付け替えたら古い予約を捨ててから新しく取る
//   ④ 0 の合図は同じレストで1回だけ（画面と帯の両方で鳴らさない）
//   ⑤ ソース検査: lift-session.tsx が通知の予約を自前で持たない（また分かれたら落とす）
import fs from 'fs';
import path from 'path';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Vibration } from 'react-native';
import { armRest, stopRest, hydrateRest, restEndsAt, restLeft, subscribeRest, __resetRestTimerForTest } from '@/lib/restTimer';
import { LIFT_SESSION_KEY, serializeSessionState } from '@/lib/liftSession';

const sched = Notifications.scheduleNotificationAsync as jest.Mock;
const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const perms = Notifications.getPermissionsAsync as jest.Mock;

beforeEach(async () => {
  __resetRestTimerForTest();
  jest.clearAllMocks();
  perms.mockResolvedValue({ granted: true });
  sched.mockResolvedValue('notif-id');
  await AsyncStorage.clear();
});

describe('レストの通知は「画面」ではなく「タイマー」が持つ', () => {
  it('① 始めた瞬間に予約する（背景に回るのを待たない）', async () => {
    const at = Date.now() + 90_000;
    await armRest(at);
    expect(sched).toHaveBeenCalledTimes(1);
    const arg = sched.mock.calls[0][0] as { trigger: { date: Date } };
    expect(arg.trigger.date.getTime()).toBe(at);
    expect(restEndsAt()).toBe(at);
  });

  it('② 画面が消えても予約は消えない（戻るボタンの事故そのもの）', async () => {
    // 画面のアンマウントに相当する操作はこのモジュールには無い。
    // ＝「画面が消えたら予約を取り消す」コードを書ける場所が構造的に存在しない
    await armRest(Date.now() + 90_000);
    expect(cancel).not.toHaveBeenCalled();
    expect(restEndsAt()).not.toBeNull();
  });

  it('③ 止めたら予約も消える', async () => {
    await armRest(Date.now() + 90_000);
    await stopRest();
    expect(cancel).toHaveBeenCalledWith('notif-id');
    expect(restEndsAt()).toBeNull();
  });

  it('③ 付け替えたら古い予約を捨ててから新しく取る（二重に鳴らさない）', async () => {
    await armRest(Date.now() + 90_000);
    sched.mockResolvedValue('notif-2');
    await armRest(Date.now() + 180_000);
    expect(cancel).toHaveBeenCalledWith('notif-id');
    expect(sched).toHaveBeenCalledTimes(2);
  });

  it('通知の許可が無ければ黙って何もしない（催促しない）', async () => {
    perms.mockResolvedValue({ granted: false });
    await armRest(Date.now() + 90_000);
    expect(sched).not.toHaveBeenCalled();
    expect(restLeft(Date.now())).toBeGreaterThan(0);   // タイマー自体は動く
  });

  it('終わりが近すぎる（1.5秒未満）レストは予約しない（届く前に終わる）', async () => {
    await armRest(Date.now() + 500);
    expect(sched).not.toHaveBeenCalled();
  });
});

describe('残り時間は購読でき、0の合図は1回だけ', () => {
  it('④ 0 になったら1回だけバイブする（何人購読していても1回）', async () => {
    const vib = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
    jest.useFakeTimers();
    try {
      const a = jest.fn(); const b = jest.fn();
      const offA = subscribeRest(a); const offB = subscribeRest(b);
      await armRest(Date.now() + 1000);
      jest.advanceTimersByTime(3000);
      expect(vib).toHaveBeenCalledTimes(1);   // 購読者は2人でも1回
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
  it('途中のレストを端末から拾い直して予約し直す', async () => {
    const at = Date.now() + 120_000;
    await AsyncStorage.setItem(LIFT_SESSION_KEY, serializeSessionState({
      date: '2026-09-17', sets: [], restSec: 90, restEndsAt: at, startedAt: Date.now(),
    }));
    await hydrateRest();
    expect(restEndsAt()).toBe(at);
    expect(sched).toHaveBeenCalledTimes(1);
  });

  it('起動前に終わっていたレストは拾わない（開いた瞬間に鳴らさない）', async () => {
    await AsyncStorage.setItem(LIFT_SESSION_KEY, serializeSessionState({
      date: '2026-09-17', sets: [], restSec: 90, restEndsAt: Date.now() - 60_000, startedAt: Date.now() - 200_000,
    }));
    await hydrateRest();
    expect(restEndsAt()).toBeNull();
    expect(sched).not.toHaveBeenCalled();
  });
});

describe('ソース検査（また画面側に戻さない）', () => {
  const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  it('⑤ 筋トレ記録画面は通知の予約を自前で持たない（lib/restTimer.ts に一本化）', () => {
    const s = src('app/lift-session.tsx');
    expect(s).not.toMatch(/scheduleNotificationAsync/);
    expect(s).not.toMatch(/cancelScheduledNotificationAsync/);
    expect(s).toContain("from '@/lib/restTimer'");
  });

  it('⑤ レストの終了時刻を AppState の変化で予約する書き方が復活していない', () => {
    // 「背景に回った瞬間にだけ予約する」が事故の形。コード（コメントを除いた本体）の中で
    // AppState と通知の予約が同居していないことを見る
    const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const p of ['app/lift-session.tsx', 'lib/restTimer.ts', 'components/RestTimerBar.tsx']) {
      const c = code(p);
      if (!/AppState/.test(c)) continue;
      expect(c).not.toMatch(/scheduleNotificationAsync/);
    }
  });

  it('⑤ レスト中の帯はルート（Stack の外）に置く＝画面を離れても消えない', () => {
    const s = src('app/_layout.tsx');
    expect(s).toContain('<RestTimerBar />');
    // Stack の閉じタグより後ろに置く（中に入れると画面ごと作り直されたときに消える）
    expect(s.indexOf('<RestTimerBar />')).toBeGreaterThan(s.indexOf('</GuideProvider>'));
  });
});
