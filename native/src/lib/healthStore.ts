// ヘルスケア連携の小さな外部ストア（useSyncExternalStore）。
//
// 役割は2つだけ:
//   1. 連携状態（unavailable / unlinked / linked）と最終同期時刻を全画面へ配る
//   2. HealthKit側でデータが変わった（HKObserverQuery相当）ことを「世代番号」で知らせる
// 各画面は useHealthVersion() を既存の読み込みeffectの依存に足すだけで、
// 「ヘルスケアの数値が変わったきっかけでこちらも更新される」ようになる（定時ポーリングはしない）。
// 実際のHealthKit呼び出しはここには無い（lib/health.ts が bump/setLinkState を呼ぶ）。
import { useSyncExternalStore } from 'react';
import type { HealthChangeKind, HealthLinkState } from './healthLink';

type State = {
  link: HealthLinkState;
  /** 連携フラグを AsyncStorage から読み終えたか（読み終える前は判定を保留できる） */
  loaded: boolean;
  lastSyncAt: number | null;
  /** 変更イベントごとに +1。画面はこれをeffectの依存に入れて読み直す */
  version: number;
  /** 直近の変更の種類（デバッグ・部分更新の材料。UIは通常 version だけ見ればよい） */
  lastKind: HealthChangeKind | null;
};

let state: State = { link: 'unavailable', loaded: false, lastSyncAt: null, version: 0, lastKind: null };
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function get() { return state; }

export function healthStoreState(): State { return state; }

export function setHealthLinkState(link: HealthLinkState, loaded = true): void {
  if (state.link === link && state.loaded === loaded) return;
  state = { ...state, link, loaded };
  emit();
}

export function setHealthLastSync(at: number | null): void {
  state = { ...state, lastSyncAt: at };
  emit();
}

/** HealthKitの変更を購読者へ通知する（キャッシュの無効化は呼び出し側で済ませてから呼ぶ） */
export function bumpHealthVersion(kind: HealthChangeKind): void {
  state = { ...state, version: state.version + 1, lastKind: kind };
  emit();
}

/** 連携状態（レンダーに追従）。ボタンの出し分けはこれで判定する */
export function useHealthLinkState(): HealthLinkState {
  return useSyncExternalStore(subscribe, () => get().link, () => get().link);
}

/** 変更世代。既存の読み込みeffectの依存配列に足すと、HealthKit更新のたびに再実行される */
export function useHealthVersion(): number {
  return useSyncExternalStore(subscribe, () => get().version, () => get().version);
}

/** 最終同期時刻（epoch ms・未同期はnull） */
export function useHealthLastSync(): number | null {
  return useSyncExternalStore(subscribe, () => get().lastSyncAt, () => get().lastSyncAt);
}

/** テスト用: 初期状態へ戻す */
export function __resetHealthStore(): void {
  state = { link: 'unavailable', loaded: false, lastSyncAt: null, version: 0, lastKind: null };
}
