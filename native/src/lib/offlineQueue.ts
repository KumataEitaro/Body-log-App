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
// 「DBに受け付けられず捨てた件数」の控え（QA P0-2）。次回の起動で1度だけ本人に伝える。
// 黙って消すと「保存しました」と言われた記録が理由も分からず消えたように見える
const DROPPED_KEY = 'bl-offline-dropped';
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
  return /network|fetch|internet|offline|timed?\s*out|timeout|socket|ECONN|abort/i.test(errText(e));
}

function errText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; code?: unknown };
    return `${String(o.message ?? '')} ${String(o.code ?? '')}`;
  }
  return String(e);
}

/**
 * 権限・RLS 由来の拒否か（QA P0-2）。
 *
 * これは「再送しても直らない毒饅頭」ではない: 別アカウントでログイン中・JWTの期限切れ・
 * ポリシー未適用など、**あとで通る**理由で弾かれているだけのことが多い。
 * ここに該当する行は捨てずに残す（捨てると本人の記録が黙って消える）。
 * 42501 = insufficient_privilege（PostgreSQL）。supabase-js は message にRLS文言を載せる。
 */
export function isPermissionError(e: unknown): boolean {
  // 「violates」単体は入れない: not-null / check / foreign key 制約違反（＝本当に再送しても直らない行）
  // まで保持してしまう。RLS の文言は "violates row-level security policy" なので、そこだけ拾う
  return /row[- ]level security|permission denied|not authorized|unauthorized|42501|\bJWT\b/i.test(errText(e));
}

/** 破棄した件数を控える（次回起動で takeDroppedNotice() が1度だけ読み出す） */
async function noteDropped(n: number): Promise<void> {
  if (n <= 0) return;
  try {
    const prev = Number(await AsyncStorage.getItem(DROPPED_KEY)) || 0;
    await AsyncStorage.setItem(DROPPED_KEY, String(prev + n));
  } catch { /* 控えられなくても本体は進める */ }
  // 端末に控えが残らなかった場合でも、少なくとも開発者向けの手がかりは残す
  console.warn(`[offlineQueue] DBに受け付けられなかった記録を${n}件破棄しました`);
}

/**
 * 「同期できなかった記録が N 件あります」を伝えるための件数を読み出し、控えを消す。
 * 起動時に1度だけ呼ぶ（native/src/app/_layout.tsx）。0 なら何も出さない。
 */
export async function takeDroppedNotice(): Promise<number> {
  try {
    const n = Number(await AsyncStorage.getItem(DROPPED_KEY)) || 0;
    if (n > 0) await AsyncStorage.removeItem(DROPPED_KEY);
    return n;
  } catch { return 0; }
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
 *
 * 送らない・捨てないの線引き（QA P0-2・2026-09-10）:
 *  ・**現在のセッションのuidと違う行は送らない**（保持したまま次の行へ）。
 *    圏外で記録 → 別アカウントでログイン、の順で操作されると、以前は B のセッションから
 *    A の user_id を insert して RLS に弾かれ、その行を「毒饅頭」として捨てていた
 *    （A の記録が、エラーも出さずに消えていた）
 *  ・**RLS・権限エラーの行も捨てない**。JWTの期限切れ・ポリシー未適用など、あとで通る理由が多い
 *  ・ネットワーク失敗（まだ圏外）はそこで止めて残り全部を次回へ
 *  ・それ以外（列違反などの本当に再送しても直らない行）だけ落とし、件数を控えて次回起動で伝える
 *
 * 未ログイン中は「誰の行か」を判定できないので1件も送らない（安全側）。
 */
export async function flush(): Promise<{ sent: number; left: number }> {
  if (flushing) return { sent: 0, left: await pendingCount() };
  flushing = true;
  try {
    let items = await readQueue();
    await writeQueue(items);   // pruneの結果を確定させつつ件数を通知

    // セッションはflushの先頭で1回だけ読む（1行ごとに読み直すとログアウトと競合する）
    let uid: string | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      uid = data.session?.user?.id ?? null;
    } catch { uid = null; }
    if (!uid) return { sent: 0, left: items.length };

    let sent = 0;
    let dropped = 0;
    const held: PendingLog[] = [];                   // 送らずに残す行（別アカウント・権限エラー）
    const syncTargets = new Map<string, string>();   // date -> user_id
    const persist = async () => { await writeQueue(held.concat(items)); };

    while (items.length > 0) {
      const head = items[0];
      // 別アカウントの行: このセッションでは送れない。持ち主が次にログインしたときに送る
      if (head.row.user_id !== uid) {
        held.push(head);
        items = items.slice(1);
        await persist();
        continue;
      }
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
      if (error && isPermissionError(error)) {        // RLS・権限。捨てずに残す（あとで通る）
        held.push(head);
        items = items.slice(1);
        await persist();
        continue;
      }
      if (!error) {
        sent += 1;
        syncTargets.set(head.row.date, head.row.user_id);
      } else {
        dropped += 1;   // 本当に再送しても直らない行（列違反など）。件数だけ控えて本人に伝える
      }
      items = items.slice(1);
      await persist();
    }
    await noteDropped(dropped);
    // 日次サマリーは日付ごとに1回でよい（同じ日の複数件をまとめる）
    for (const [date, u] of syncTargets) {
      try { await syncEntriesForDate(u, date); } catch { /* logsは入っている。次の保存時に再同期される */ }
    }
    return { sent, left: held.length + items.length };
  } finally {
    flushing = false;
  }
}
