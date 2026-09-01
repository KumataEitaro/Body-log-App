// 送信ジョブの永続化: 「送った」と「解析が終わった」を切り離す。
//
// 従来は解析中の行が画面のstateにしか無かったため、アプリを閉じる・落ちると
// 送信そのものが無かったことになっていた（1500人監査ペイン9位「解析待ちと非同期化の欠如」）。
// 送信の瞬間に端末へジョブを書き、トレイに反映できた時点で消す。次に食事タブを
// 開いたときに未完了ジョブを自動で再送するので、解析が迷子にならない。
//
// 写真はbase64ではなく圧縮済みJPEGのローカルURIだけを持つ（base64をAsyncStorageに
// 積むと1枚で数百KB。端末のキャッシュが消えていたらそのジョブは破棄する）。
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

/** 端末に置くジョブの保存キー */
export const JOBS_KEY = 'bl-parse-jobs';
/** これを超えて待たされたら「混み合っています」を添える（体感の不安を潰す） */
export const SLOW_MS = 8000;
/** これより古いジョブは復元しない（日をまたいだ食事を勝手にトレイへ積まない） */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** 端末に残すジョブの上限。連投で無制限に太らせない（超過分は古い順に捨てる） */
export const MAX_JOBS = 20;

/** running=解析中（再送の対象） / failed=失敗して本人の判断待ち */
export type JobState = 'running' | 'failed';

export type ParseJob = {
  id: string;
  /** 入力テキスト（写真だけの送信では空） */
  text: string;
  /** 圧縮済みJPEGのローカルURI。復元時はここから読み直す */
  photoUris: string[];
  /** 記録先の日付（YYYY-MM-DD）。過去日を見ながら送った分を翌日に持ち越さない */
  date: string;
  /** 送信時刻（epoch ms） */
  createdAt: number;
  state: JobState;
  /** 失敗理由（そのままチップに出す） */
  error?: string;
};

/** 送信1回ぶんのジョブを作る。nowとrandを渡すのはテストで固定するため */
export function makeJob(
  input: { text: string; photoUris: string[]; date: string },
  now: number,
  rand: () => number,
): ParseJob {
  const tail = Math.floor(rand() * 1e9).toString(36);
  return {
    id: `j${now.toString(36)}-${tail}`,
    text: input.text,
    photoUris: [...input.photoUris],
    date: input.date,
    createdAt: now,
    state: 'running',
  };
}

/** ジョブを積む（上限を超えたぶんは古い順に落とす） */
export function addJob(list: ParseJob[], job: ParseJob): ParseJob[] {
  const next = [...list.filter((j) => j.id !== job.id), job];
  return next.length > MAX_JOBS ? next.slice(next.length - MAX_JOBS) : next;
}

/** 反映済み・破棄したジョブを外す（自分の分だけ） */
export function removeJob(list: ParseJob[], id: string): ParseJob[] {
  return list.filter((j) => j.id !== id);
}

/** 失敗として残す。静かに消さないのがこの機能の肝 */
export function markFailed(list: ParseJob[], id: string, error: string): ParseJob[] {
  return list.map((j) => (j.id === id ? { ...j, state: 'failed' as const, error } : j));
}

/** 再試行・復元で解析中へ戻す（失敗理由は消す） */
export function markRunning(list: ParseJob[], id: string, now?: number): ParseJob[] {
  return list.map((j) => (j.id === id
    ? { ...j, state: 'running' as const, error: undefined, createdAt: now ?? j.createdAt }
    : j));
}

/** 1件が壊れていても全体を捨てない。形が合わないものだけ落とす */
function validJob(v: unknown): ParseJob | null {
  if (typeof v !== 'object' || v == null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '') return null;
  if (typeof o.date !== 'string') return null;
  if (typeof o.createdAt !== 'number' || !Number.isFinite(o.createdAt)) return null;
  const uris = Array.isArray(o.photoUris) ? o.photoUris.filter((u): u is string => typeof u === 'string') : [];
  const text = typeof o.text === 'string' ? o.text : '';
  // テキストも写真も無いジョブは再送しても意味がない
  if (text === '' && uris.length === 0) return null;
  return {
    id: o.id, text, photoUris: uris, date: o.date, createdAt: o.createdAt,
    state: o.state === 'failed' ? 'failed' : 'running',
    error: typeof o.error === 'string' ? o.error : undefined,
  };
}

/** 端末の文字列 → ジョブ配列（未保存・壊れたJSONは空配列） */
export function decodeJobs(raw: string | null): ParseJob[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(validJob).filter((j): j is ParseJob => j !== null);
}

export function encodeJobs(list: ParseJob[]): string {
  return JSON.stringify(list);
}

/** 待たされすぎているか（解析中チップに「混み合っています」を添える判定） */
export function isSlow(job: ParseJob, now: number): boolean {
  return job.state === 'running' && now - job.createdAt > SLOW_MS;
}

/** 復元時の仕分け: resume=自動で再送する / keep=失敗表示のまま残す / drop=捨てる */
export function triageJobs(
  list: ParseJob[], today: string, now: number,
): { resume: ParseJob[]; keep: ParseJob[]; drop: ParseJob[] } {
  const resume: ParseJob[] = [];
  const keep: ParseJob[] = [];
  const drop: ParseJob[] = [];
  for (const j of list) {
    if (j.date !== today || now - j.createdAt > MAX_AGE_MS || now < j.createdAt - 60_000) drop.push(j);
    else if (j.state === 'running') resume.push(j);
    else keep.push(j);
  }
  return { resume, keep, drop };
}

/** 同じidの二重処理を防ぐ関門。まだ通っていなければtrueを返して記録する。
 *  再送中に旧い応答が返ってきても、トレイに二重で積まないための要（冪等の実体） */
export function claimOnce(seen: Set<string>, id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
}

/** 関門を開け直す（本人が［再試行］を押したときだけ） */
export function releaseClaim(seen: Set<string>, id: string): void {
  seen.delete(id);
}

// ===== 端末への読み書き（副作用あり。純粋な判断は上の関数に寄せてある） =====

export async function loadJobs(): Promise<ParseJob[]> {
  try { return decodeJobs(await AsyncStorage.getItem(JOBS_KEY)); } catch { return []; }
}

export async function saveJobs(list: ParseJob[]): Promise<void> {
  try {
    if (list.length === 0) await AsyncStorage.removeItem(JOBS_KEY);
    else await AsyncStorage.setItem(JOBS_KEY, encodeJobs(list));
  } catch { /* 保存できなくても送信自体は止めない */ }
}

/** 復元用に写真をURIから読み直す。1枚でも読めなければnull（＝そのジョブは破棄する）。
 *  カメラの一時ファイルはOSがいつでも掃除するので「消えている」は正常な結末 */
export async function readPhotoPayloads(uris: string[]): Promise<{ data: string; mime: string }[] | null> {
  const out: { data: string; mime: string }[] = [];
  for (const uri of uris) {
    try {
      const data = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      if (!data) return null;
      out.push({ data, mime: 'image/jpeg' });
    } catch { return null; }
  }
  return out;
}
