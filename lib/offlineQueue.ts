'use client';
// オフライン記録キュー: 圏外で保存された記録を端末に貯め、通信回復時に自動送信する。
import type { LogRow } from './day';

export type QueuedLog = { localId: string; date: string; log: LogRow; ts: number };

const key = (uid: string) => `blq:${uid}`;

export function getQueue(uid: string): QueuedLog[] {
  try {
    return JSON.parse(localStorage.getItem(key(uid)) || '[]') as QueuedLog[];
  } catch {
    return [];
  }
}

export function enqueueLog(uid: string, date: string, log: LogRow): QueuedLog {
  const item: QueuedLog = { localId: `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, date, log, ts: Date.now() };
  const q = getQueue(uid);
  q.push(item);
  try { localStorage.setItem(key(uid), JSON.stringify(q)); } catch { /* 無視 */ }
  return item;
}

export function removeFromQueue(uid: string, localId: string): void {
  const q = getQueue(uid).filter((i) => i.localId !== localId);
  try { localStorage.setItem(key(uid), JSON.stringify(q)); } catch { /* 無視 */ }
}

export function clearQueue(uid: string): void {
  try { localStorage.removeItem(key(uid)); } catch { /* 無視 */ }
}
