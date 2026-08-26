// 「今日の残り」の共有ストア。
//
// 食事タブは描画のたびに目標kcal・摂取済み・PFC目標を計算している。
// FABのクイック記録でも同じ数字を見せたいが、FAB内で計画計算一式
// （profile/goals/events取得＋computePlan）を繰り返すのは重複が過ぎる。
// 食事タブが計算結果をここに置き、FABは読むだけにする。
import { useSyncExternalStore } from 'react';

export type DayStatus = {
  goalKcal: number;
  eaten: number;
  p: { eaten: number; target: number };
  f: { eaten: number; target: number };
  c: { eaten: number; target: number };
};

let current: DayStatus | null = null;
const listeners = new Set<() => void>();

export function setDayStatus(s: DayStatus): void {
  // 毎レンダーで呼ばれるため、変化がないときは通知しない
  if (current
    && current.goalKcal === s.goalKcal && current.eaten === s.eaten
    && current.p.eaten === s.p.eaten && current.p.target === s.p.target
    && current.f.eaten === s.f.eaten && current.f.target === s.f.target
    && current.c.eaten === s.c.eaten && current.c.target === s.c.target) return;
  current = s;
  listeners.forEach((l) => l());
}

export function getDayStatus(): DayStatus | null { return current; }

export function useDayStatus(): DayStatus | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getDayStatus,
    getDayStatus,
  );
}
