// オフラインキュー: 「送信に失敗したらローカルに積み、オンライン復帰で自動送信」の薄い層。
//
// ジムの地下など圏外での筋トレ記録が消えないようにする（1500人監査ペイン5位対応）。
// 専用の同期エンジンは作らない。NetInfoも足さない（依存を増やさず、失敗＝圏外として扱う）。
// flushの起点は呼び出し側（運動タブのマウント・AppState復帰・保存成功時・未同期チップのタップ）。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { syncEntriesForDate } from '@/lib/sync';

/** logsテーブルへのinsertペイロード＋ローカル管理情報 */
export type PendingLog = {
  localId: string;                    // 端末で採番（表示・重複排除用。DBには送らない）
  createdAt: number;                  // enqueue時刻(ms)。7日で静かに破棄
  row: { user_id: string; date: string } & Record<string, unknown>;
};

const KEY = 'bl-offline-logs';
const MAX_ITEMS = 50;                          // 無限に貯めない（超えたら古いものから破棄）
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;    // 7日で破棄（破棄時は静かに）

// 未同期件数の購読（運動タブの「未同期 {n}件」チップ用）。
// enqueue/flushのたびに最新件数を通知する。
const listeners = new Set<(n: number) => void>();
export function subscribePendingCount(cb: (n: number) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function emit(n: number) { listeners.forEach((cb) => { try { cb(n); } catch { /* 表示側の都合で全体を止めない */ } }); }

/** 上限50件・7日超えを落とす（破棄は静かに＝メッセージを出さない） */
function prune(items: PendingLog[]): PendingLog[] {
  const now = Date.now();
  const alive = items.filter((it) => now - it.createdAt < MAX_AGE_MS);
  return alive.length > MAX_ITEMS ? alive.slice(alive.length - MAX_ITEMS) : alive;
}

async function readQueue(): Promise<PendingLog[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as PendingLog[];
    return Array.isArray(items) ? prune(items) : [];
  } catch { return []; }
}

async function writeQueue(items: PendingLog[]): Promise<void> {
  try {
    if (items.length === 0) await AsyncStorage.removeItem(KEY);
    else await AsyncStorage.setItem(KEY, JSON.stringify(items));
  } catch { /* 端末ストレージ不調。次のenqueue/flushで再試行される */ }
  emit(items.length);
}

/**
 * ネットワーク起因の失敗か（DBエラーと区別するため）。
 * RNのfetchは "Network request failed"、supabase-jsは "TypeError: fetch failed" 等を返す。
 * バリデーション・RLS・スキーマ違反はここに該当しないので従来どおり失敗表示に回る。
 */
export function isNetworkError(e: unknown): boolean {
  const msg = typeof e === 'string' ? e
    : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message)
    : String(e);
  return /network|fetch|internet|offline|timed?\s*out|timeout|socket|ECONN|abort/i.test(msg);
}

/** 送信に失敗した1行をキューへ積む。戻り値は積んだあとの未同期件数 */
export async function enqueue(row: PendingLog['row']): Promise<number> {
  const items = prune(await readQueue());
  items.push({
    localId: `off-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    row,
  });
  const kept = prune(items);
  await writeQueue(kept);
  return kept.length;
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

// 二重flush防止（AppState復帰とマウントが同時に走っても1本しか送らない）
let flushing = false;

/**
 * 先頭から順にsupabaseへinsertする。成功した日付は syncEntriesForDate で日次サマリーも直す。
 * ネットワーク失敗（まだ圏外）ならそこで止めて残りは次回へ。
 * ネットワーク以外の失敗（バリデーション等）はその行だけ静かに落とす
 * （毒饅頭が先頭に居座ってキュー全体を詰まらせないため）。
 */
export async function flush(): Promise<{ sent: number; left: number }> {
  if (flushing) return { sent: 0, left: await pendingCount() };
  flushing = true;
  try {
    let items = await readQueue();
    await writeQueue(items);   // pruneの結果を確定させつつ件数を通知
    let sent = 0;
    const syncTargets = new Map<string, string>();   // date -> user_id
    while (items.length > 0) {
      const head = items[0];
      let error: { message: string } | null = null;
      try {
        ({ error } = await supabase.from('logs').insert(head.row));
        // v17列（ex_minutes/ex_km）が無い旧DBでも保存できるようフォールバック（保存経路と同じ流儀）
        if (error && /ex_minutes|ex_km|column|schema/i.test(error.message) && !isNetworkError(error)) {
          const { ex_minutes: _m, ex_km: _k, ...rest } = head.row as Record<string, unknown>;
          ({ error } = await supabase.from('logs').insert(rest));
        }
      } catch (e) {
        error = { message: String((e as Error)?.message ?? e) };
      }
      if (error && isNetworkError(error)) break;      // まだ圏外。残して次回に任せる
      if (!error) {
        sent += 1;
        syncTargets.set(head.row.date, head.row.user_id);
      }
      // 成功、またはDB側で受け付けられない行（再送しても直らない）はキューから外す
      items = items.slice(1);
      await writeQueue(items);
    }
    // 日次サマリーは日付ごとに1回でよい（同じ日の複数件をまとめる）
    for (const [date, uid] of syncTargets) {
      try { await syncEntriesForDate(uid, date); } catch { /* logsは入っている。次の保存時に再同期される */ }
    }
    return { sent, left: items.length };
  } finally {
    flushing = false;
  }
}
