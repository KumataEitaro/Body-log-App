// 体の写真（body_photos）の保存・一覧・削除（2026-09-26・復活）。
//
// 経緯: 2026-09-05 に「体の写真＋体脂肪率」（旧 BodyPhotosCard）があったが「保存に失敗する」ため
// 2026-09-18（ef91b51）で写真の保存をやめ、数値だけを残す BodyFatSheet に置き換えた。
// 熊田さん 2026-09-26「自分の体の画像を保存（推定体脂肪率とセットで）。うまく機能していないからテストして直して」
//
// 以前うまく動かなかった理由として分かったこと（docs/FEATURES.md 2026-09-26 に詳述）:
//   1. supabase/schema.sql に body_photos が無い（apply-pending.sql v16 / fix-body-photos.sql にしか無い）
//      ＝本番 DB にテーブル・バケットが無い、または作った後に PostgREST のスキーマキャッシュが古いままだった
//      可能性が高い。旧 UI の失敗文言「記録の保存に失敗しました」は **insert 側** の失敗
//   2. 旧実装は失敗の段階（upload か insert か）を UI が区別せず、insert に失敗しても上げた写真を消さなかった
//   3. React Native の fetch は Blob を ArrayBuffer から作れないので、Storage には **ArrayBuffer** を渡すのが確実
//      （旧実装は Uint8Array。動く環境もあるが、Supabase の RN ガイドは ArrayBuffer を推奨）
//
// 設計:
//   ・写真は非公開バケット 'body-photos' の '<uid>/<date>-<nonce>.jpg'（RLS はフォルダ名＝uid）
//   ・行は public.body_photos { user_id, date, path, bodyfat }。表示は署名付き URL（1時間）
//   ・**失敗を握りつぶさない**: どの段で何が失敗したか（step・エラー本文）を返し、UI がそのまま出す
//   ・insert に失敗したら upload したファイルを消す（後始末）。upload に失敗したら insert しない
//   ・Supabase 呼び出しは deps で差し替えられる（jest では純関数として検証。lib/bodyLog.ts と同じ流儀）
import { supabase } from '@/lib/supabase';
import { t } from '@/lib/i18n';

export const BODY_PHOTO_BUCKET = 'body-photos';
export const BODY_PHOTO_TABLE = 'body_photos';
/** 署名付き URL の有効期間（秒）。カードを開いている間だけ見られればよい */
export const SIGNED_URL_TTL = 3600;

export type BodyPhotoRow = { id: string; date: string; path: string; bodyfat: number | null };
export type BodyPhotoView = BodyPhotoRow & { url: string | null };

type ErrLike = { code?: string | null; message?: string | null; status?: number | null } | null | undefined;

// ===== base64 → bytes（純関数） =====

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** data URL の頭・空白・URL-safe 文字を標準の base64 に正規化する */
export function normalizeBase64(b64: string): string {
  return b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
}

/** atob に頼らない base64 デコード（Hermes に atob が無い版・jest 等でも同じ結果になる） */
export function decodeBase64Manual(b64: string): Uint8Array {
  const s = normalizeBase64(b64).replace(/=+$/, '');
  if (s.length % 4 === 1) throw new Error('invalid base64 length');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let buf = 0, bits = 0, o = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B64.indexOf(s[i]);
    if (v < 0) throw new Error(`invalid base64 char at ${i}`);
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
      buf &= (1 << bits) - 1;
    }
  }
  return o === out.length ? out : out.slice(0, o);
}

/**
 * base64 → Uint8Array。環境に atob があればそれを使い（速い）、無ければ自前でデコードする。
 * どちらでも同じバイト列になることを jest で固定している。
 */
export function base64ToBytes(b64: string): Uint8Array {
  const s = normalizeBase64(b64);
  const atobFn = (globalThis as { atob?: (x: string) => string }).atob;
  if (typeof atobFn === 'function') {
    const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
    const bin = atobFn(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return decodeBase64Manual(s);
}

/** Uint8Array → その範囲だけの ArrayBuffer（Storage の upload には ArrayBuffer を渡す） */
export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Storage 上のパス。フォルダ名＝uid が RLS の条件なので必ず '<uid>/' で始める */
export function bodyPhotoPath(uid: string, date: string, nonce: string): string {
  return `${uid}/${date}-${nonce}.jpg`;
}

function randomNonce(): string {
  return Math.random().toString(36).slice(2, 8);
}

// ===== 失敗の言語化 =====

export type PhotoStep = 'upload' | 'insert' | 'list' | 'delete';
export type PhotoFail = { ok: false; step: PhotoStep; error: string };

/** DB / Storage のエラーを「何が起きたか＋どうすればいいか」の短い日本語にする（本文も添える） */
export function describePhotoError(step: PhotoStep, e: ErrLike): string {
  const code = String(e?.code ?? '');
  const msg = String(e?.message ?? '');
  const detail = [code, msg].filter(Boolean).join(' ').slice(0, 140);
  let head: string;
  if (/bucket/i.test(msg) && /not found|does not exist/i.test(msg)) {
    head = t('ストレージ未セットアップです（supabase/migration-39.sql を実行してください）。');
  } else if (code === '42P01' || code === 'PGRST205' || /relation .* does not exist|schema cache/i.test(msg)) {
    head = t('テーブル未作成です（supabase/migration-39.sql を実行してください）。');
  } else if (code === '42501' || /row-level security|permission denied|unauthorized|jwt/i.test(msg) || e?.status === 401 || e?.status === 403) {
    head = t('権限がありません。ログインし直してからもう一度お試しください。');
  } else if (step === 'upload') {
    head = t('写真の保存に失敗しました。');
  } else if (step === 'delete') {
    head = t('削除に失敗しました。');
  } else if (step === 'list') {
    head = t('写真を読み込めませんでした。');
  } else {
    head = t('記録の保存に失敗しました。');
  }
  return detail ? `${head} [${detail}]` : head;
}

// ===== Supabase 呼び出し（deps で差し替え可能） =====

export type BodyPhotoDeps = {
  upload?: (path: string, body: ArrayBuffer, contentType: string) => Promise<{ error: ErrLike }>;
  insert?: (row: { user_id: string; date: string; path: string; bodyfat: number | null }) => Promise<{ data: { id: string } | null; error: ErrLike }>;
  removeFiles?: (paths: string[]) => Promise<{ error: ErrLike }>;
  deleteRow?: (id: string) => Promise<{ error: ErrLike }>;
  list?: (limit: number) => Promise<{ data: BodyPhotoRow[] | null; error: ErrLike }>;
  signedUrl?: (path: string) => Promise<string | null>;
  nonce?: () => string;
};

// 既定の実装。throw も { error } に畳む（jest の supabase モックに storage が無くても落ちない・UI は必ず文言を出せる）
const live: Required<BodyPhotoDeps> = {
  upload: async (path, body, contentType) => {
    try {
      const { error } = await supabase.storage.from(BODY_PHOTO_BUCKET).upload(path, body, { contentType, upsert: false });
      return { error };
    } catch (e) { return { error: { message: String((e as Error)?.message ?? e) } }; }
  },
  insert: async (row) => {
    try {
      const { data, error } = await supabase.from(BODY_PHOTO_TABLE).insert(row).select('id').single();
      return { data: (data as { id: string } | null) ?? null, error };
    } catch (e) { return { data: null, error: { message: String((e as Error)?.message ?? e) } }; }
  },
  removeFiles: async (paths) => {
    try {
      const { error } = await supabase.storage.from(BODY_PHOTO_BUCKET).remove(paths);
      return { error };
    } catch (e) { return { error: { message: String((e as Error)?.message ?? e) } }; }
  },
  deleteRow: async (id) => {
    try {
      const { error } = await supabase.from(BODY_PHOTO_TABLE).delete().eq('id', id);
      return { error };
    } catch (e) { return { error: { message: String((e as Error)?.message ?? e) } }; }
  },
  list: async (limit) => {
    try {
      const { data, error } = await supabase.from(BODY_PHOTO_TABLE).select('id,date,path,bodyfat')
        .order('date', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
      return { data: (data as BodyPhotoRow[] | null) ?? null, error };
    } catch (e) { return { data: null, error: { message: String((e as Error)?.message ?? e) } }; }
  },
  signedUrl: async (path) => {
    try {
      const { data } = await supabase.storage.from(BODY_PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
      return data?.signedUrl ?? null;
    } catch { return null; }
  },
  nonce: randomNonce,
};

/** 写真を Storage に上げる。成功なら path、失敗なら段階とエラー本文 */
export async function uploadBodyPhoto(
  { uid, date, base64 }: { uid: string; date: string; base64: string }, deps: BodyPhotoDeps = {},
): Promise<{ ok: true; path: string } | PhotoFail> {
  const upload = deps.upload ?? live.upload;
  let body: ArrayBuffer;
  try { body = bytesToArrayBuffer(base64ToBytes(base64)); }
  catch (e) { return { ok: false, step: 'upload', error: describePhotoError('upload', { message: String((e as Error)?.message ?? e) }) }; }
  if (body.byteLength === 0) return { ok: false, step: 'upload', error: describePhotoError('upload', { message: 'empty image' }) };
  const path = bodyPhotoPath(uid, date, (deps.nonce ?? live.nonce)());
  const { error } = await upload(path, body, 'image/jpeg');
  if (error) return { ok: false, step: 'upload', error: describePhotoError('upload', error) };
  return { ok: true, path };
}

/** body_photos に1行入れる。user_id は RLS（auth.uid() = user_id）のため必ず渡す */
export async function insertBodyPhoto(
  { uid, date, path, bodyfat }: { uid: string; date: string; path: string; bodyfat: number | null }, deps: BodyPhotoDeps = {},
): Promise<{ ok: true; id: string } | PhotoFail> {
  const insert = deps.insert ?? live.insert;
  const { data, error } = await insert({ user_id: uid, date, path, bodyfat });
  if (error) return { ok: false, step: 'insert', error: describePhotoError('insert', error) };
  return { ok: true, id: data?.id ?? '' };
}

/**
 * 写真＋体脂肪率を1組として保存する（upload → insert）。
 * insert に失敗したら upload したファイルを消す（後始末。消せなくても結果は insert の失敗として返す）。
 */
export async function saveBodyPhoto(
  { uid, date, base64, bodyfat }: { uid: string; date: string; base64: string; bodyfat: number | null }, deps: BodyPhotoDeps = {},
): Promise<{ ok: true; id: string; path: string } | PhotoFail> {
  const up = await uploadBodyPhoto({ uid, date, base64 }, deps);
  if (!up.ok) return up;
  const ins = await insertBodyPhoto({ uid, date, path: up.path, bodyfat }, deps);
  if (!ins.ok) {
    try { await (deps.removeFiles ?? live.removeFiles)([up.path]); } catch { /* 後始末の失敗は本筋の失敗に含めない */ }
    return ins;
  }
  return { ok: true, id: ins.id, path: up.path };
}

/** 新しい順に limit 件。非公開バケットなので署名付き URL を添える（取れなければ url null） */
export async function listBodyPhotos(limit = 24, deps: BodyPhotoDeps = {}): Promise<{ ok: true; photos: BodyPhotoView[] } | PhotoFail> {
  const { data, error } = await (deps.list ?? live.list)(limit);
  if (error) return { ok: false, step: 'list', error: describePhotoError('list', error) };
  const rows = data ?? [];
  const signed = deps.signedUrl ?? live.signedUrl;
  const photos = await Promise.all(rows.map(async (r) => ({
    ...r, bodyfat: r.bodyfat == null ? null : Number(r.bodyfat), url: await signed(r.path),
  })));
  return { ok: true, photos };
}

/**
 * 1枚消す。行を先に消し（見えなくする）、それから Storage のファイルを消す。
 * ファイルが消せなくても行は消えているので ok（孤児ファイルは見えないし RLS で他人にも見えない）。
 */
export async function deleteBodyPhoto(row: { id: string; path: string }, deps: BodyPhotoDeps = {}): Promise<{ ok: true; fileRemoved: boolean } | PhotoFail> {
  const { error } = await (deps.deleteRow ?? live.deleteRow)(row.id);
  if (error) return { ok: false, step: 'delete', error: describePhotoError('delete', error) };
  const rm = await (deps.removeFiles ?? live.removeFiles)([row.path]);
  return { ok: true, fileRemoved: !rm.error };
}
