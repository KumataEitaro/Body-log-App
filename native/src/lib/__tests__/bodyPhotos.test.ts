// 体の写真の保存・一覧・削除（lib/bodyPhotos.ts）を固定する（2026-09-26・復活）。
// 熊田さん「自分の体の画像を保存（推定体脂肪率とセットで）。うまく機能していないからテストして直して」
//
// ここで固定すること:
//   ・base64 → bytes が atob の有無で同じ結果になる（Hermes / jest の差で壊れない）
//   ・upload に失敗したら insert しない
//   ・insert に失敗したら upload したファイルを消す（後始末）
//   ・失敗は握りつぶさず、段階（step）とエラー本文が UI に返る
import {
  base64ToBytes, decodeBase64Manual, normalizeBase64, bytesToArrayBuffer, bodyPhotoPath, describePhotoError,
  uploadBodyPhoto, insertBodyPhoto, saveBodyPhoto, listBodyPhotos, deleteBodyPhoto,
} from '@/lib/bodyPhotos';

// 'hello' / 'hi' / 'hel' / JPEG の先頭4バイト（FF D8 FF E0）
const CASES: [string, number[]][] = [
  ['aGVsbG8=', [104, 101, 108, 108, 111]],
  ['aGk=', [104, 105]],
  ['aGVs', [104, 101, 108]],
  ['/9j/4A==', [0xff, 0xd8, 0xff, 0xe0]],
  ['', []],
];

describe('base64 → bytes', () => {
  it('標準の base64 を正しくデコードする（atob あり）', () => {
    expect(typeof globalThis.atob).toBe('function');
    for (const [b64, bytes] of CASES) expect([...base64ToBytes(b64)]).toEqual(bytes);
  });

  it('atob が無い環境でも同じ結果（自前デコード）', () => {
    const saved = globalThis.atob;
    // @ts-expect-error atob を一時的に外す
    delete globalThis.atob;
    try {
      expect(typeof globalThis.atob).toBe('undefined');
      for (const [b64, bytes] of CASES) expect([...base64ToBytes(b64)]).toEqual(bytes);
    } finally { globalThis.atob = saved; }
  });

  it('自前デコードは atob と完全に一致する（ランダムなバイト列 200 本）', () => {
    for (let n = 0; n < 200; n++) {
      const len = n % 17;
      const bytes = Array.from({ length: len }, (_, i) => (i * 73 + n * 31) & 0xff);
      const b64 = Buffer.from(bytes).toString('base64');
      expect([...decodeBase64Manual(b64)]).toEqual(bytes);
      expect([...base64ToBytes(b64)]).toEqual(bytes);
    }
  });

  it('パディング無し・改行入り・URL-safe・data URL の頭も受け付ける', () => {
    expect([...base64ToBytes('aGVsbG8')]).toEqual([104, 101, 108, 108, 111]);        // パディング無し
    expect([...base64ToBytes('aGVs\r\nbG8=')]).toEqual([104, 101, 108, 108, 111]);   // 改行入り
    expect([...base64ToBytes('_9j_4A')]).toEqual([0xff, 0xd8, 0xff, 0xe0]);         // URL-safe（- _）
    expect([...base64ToBytes('data:image/jpeg;base64,/9j/4A==')]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(normalizeBase64('data:image/jpeg;base64,_9j_\n4A==')).toBe('/9j/4A==');
  });

  it('壊れた文字列は例外（呼び出し側で「写真の保存に失敗」に畳む）', () => {
    expect(() => decodeBase64Manual('a')).toThrow();
    expect(() => decodeBase64Manual('ab$c')).toThrow();
  });

  it('ArrayBuffer はその範囲だけ（subarray でも余計なバイトを送らない）', () => {
    const all = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const view = all.subarray(2, 5);
    const ab = bytesToArrayBuffer(view);
    expect(ab.byteLength).toBe(3);
    expect([...new Uint8Array(ab)]).toEqual([3, 4, 5]);
  });
});

describe('パスと失敗の言語化', () => {
  it('パスは <uid>/<date>-<nonce>.jpg（フォルダ名＝uid が RLS の条件）', () => {
    expect(bodyPhotoPath('u1', '2026-09-26', 'abc123')).toBe('u1/2026-09-26-abc123.jpg');
  });
  it('バケット無し・テーブル無し・権限・その他を区別し、本文を添える', () => {
    expect(describePhotoError('upload', { message: 'Bucket not found' })).toMatch(/migration-39\.sql.*\[Bucket not found\]/);
    expect(describePhotoError('insert', { code: '42P01', message: 'relation "public.body_photos" does not exist' })).toMatch(/migration-39\.sql.*\[42P01/);
    expect(describePhotoError('insert', { code: 'PGRST205', message: 'Could not find the table' })).toMatch(/migration-39\.sql/);
    expect(describePhotoError('insert', { code: '42501', message: 'new row violates row-level security policy' })).toMatch(/ログインし直して/);
    expect(describePhotoError('upload', { message: 'Network request failed' })).toBe('写真の保存に失敗しました。 [Network request failed]');
    expect(describePhotoError('insert', { message: '' })).toBe('記録の保存に失敗しました。');
    expect(describePhotoError('list', null)).toBe('写真を読み込めませんでした。');
  });
});

describe('保存（upload → insert）', () => {
  const B64 = '/9j/4A==';

  it('成功: path と id を返し、upload には ArrayBuffer と image/jpeg を渡す', async () => {
    const upload = jest.fn(async () => ({ error: null }));
    const insert = jest.fn(async () => ({ data: { id: 'row-1' }, error: null }));
    const removeFiles = jest.fn(async () => ({ error: null }));
    const r = await saveBodyPhoto({ uid: 'u1', date: '2026-09-26', base64: B64, bodyfat: 21.5 }, { upload, insert, removeFiles, nonce: () => 'n0nce1' });
    expect(r).toEqual({ ok: true, id: 'row-1', path: 'u1/2026-09-26-n0nce1.jpg' });
    expect(upload).toHaveBeenCalledTimes(1);
    const [path, body, ct] = (upload.mock.calls[0] as unknown as [string, ArrayBuffer, string]);
    expect(path).toBe('u1/2026-09-26-n0nce1.jpg');
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(body)]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(ct).toBe('image/jpeg');
    expect(insert).toHaveBeenCalledWith({ user_id: 'u1', date: '2026-09-26', path: 'u1/2026-09-26-n0nce1.jpg', bodyfat: 21.5 });
    expect(removeFiles).not.toHaveBeenCalled();
  });

  it('upload に失敗したら insert しない（step=upload・本文つき）', async () => {
    const upload = jest.fn(async () => ({ error: { message: 'Bucket not found' } }));
    const insert = jest.fn(async () => ({ data: { id: 'x' }, error: null }));
    const r = await saveBodyPhoto({ uid: 'u1', date: '2026-09-26', base64: B64, bodyfat: null }, { upload, insert });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.step).toBe('upload');
      expect(r.error).toMatch(/migration-39\.sql/);
    }
    expect(insert).not.toHaveBeenCalled();
  });

  it('insert に失敗したら upload したファイルを消す（後始末）・step=insert', async () => {
    const upload = jest.fn(async () => ({ error: null }));
    const insert = jest.fn(async () => ({ data: null, error: { code: '42P01', message: 'relation "body_photos" does not exist' } }));
    const removeFiles = jest.fn(async () => ({ error: null }));
    const r = await saveBodyPhoto({ uid: 'u1', date: '2026-09-26', base64: B64, bodyfat: 20 }, { upload, insert, removeFiles, nonce: () => 'zz' });
    expect(r).toEqual({ ok: false, step: 'insert', error: expect.stringMatching(/migration-39\.sql.*42P01/) });
    expect(removeFiles).toHaveBeenCalledWith(['u1/2026-09-26-zz.jpg']);
  });

  it('後始末（removeFiles）が例外を投げても insert の失敗として返る', async () => {
    const upload = jest.fn(async () => ({ error: null }));
    const insert = jest.fn(async () => ({ data: null, error: { message: 'boom' } }));
    const removeFiles = jest.fn(async () => { throw new Error('network'); });
    const r = await saveBodyPhoto({ uid: 'u1', date: '2026-09-26', base64: B64, bodyfat: 20 }, { upload, insert, removeFiles });
    expect(r).toMatchObject({ ok: false, step: 'insert' });
  });

  it('壊れた base64 は upload を呼ばずに失敗', async () => {
    const saved = globalThis.atob;
    // @ts-expect-error 自前デコードの経路を通す
    delete globalThis.atob;
    try {
      const upload = jest.fn(async () => ({ error: null }));
      const r = await uploadBodyPhoto({ uid: 'u1', date: '2026-09-26', base64: 'a' }, { upload });
      expect(r).toMatchObject({ ok: false, step: 'upload' });
      expect(upload).not.toHaveBeenCalled();
    } finally { globalThis.atob = saved; }
  });

  it('空の画像は upload しない', async () => {
    const upload = jest.fn(async () => ({ error: null }));
    const r = await uploadBodyPhoto({ uid: 'u1', date: '2026-09-26', base64: '' }, { upload });
    expect(r).toMatchObject({ ok: false, step: 'upload' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('insertBodyPhoto 単体: user_id を必ず入れる（RLS の with check）', async () => {
    const insert = jest.fn(async (_row: { user_id: string; date: string; path: string; bodyfat: number | null }) => ({ data: { id: 'r' }, error: null }));
    const r = await insertBodyPhoto({ uid: 'u9', date: '2026-09-01', path: 'u9/2026-09-01-a.jpg', bodyfat: null }, { insert });
    expect(r).toEqual({ ok: true, id: 'r' });
    expect(insert.mock.calls[0][0]).toMatchObject({ user_id: 'u9' });
  });
});

describe('一覧と削除', () => {
  it('一覧: 署名付き URL を添え、bodyfat は数値にする（numeric は文字列で来る）', async () => {
    const list = jest.fn(async () => ({
      data: [
        { id: 'a', date: '2026-09-26', path: 'u1/a.jpg', bodyfat: '21.5' as unknown as number },
        { id: 'b', date: '2026-09-19', path: 'u1/b.jpg', bodyfat: null },
      ], error: null,
    }));
    const signedUrl = jest.fn(async (p: string) => (p === 'u1/a.jpg' ? 'https://x/a' : null));
    const r = await listBodyPhotos(24, { list, signedUrl });
    expect(r).toEqual({ ok: true, photos: [
      { id: 'a', date: '2026-09-26', path: 'u1/a.jpg', bodyfat: 21.5, url: 'https://x/a' },
      { id: 'b', date: '2026-09-19', path: 'u1/b.jpg', bodyfat: null, url: null },
    ] });
    expect(list).toHaveBeenCalledWith(24);
  });

  it('一覧: テーブルが無ければ step=list で理由を返す', async () => {
    const list = jest.fn(async () => ({ data: null, error: { code: 'PGRST205', message: 'Could not find the table public.body_photos' } }));
    const r = await listBodyPhotos(24, { list, signedUrl: async () => null });
    expect(r).toMatchObject({ ok: false, step: 'list', error: expect.stringMatching(/migration-39\.sql/) });
  });

  it('削除: 行を消してからファイルを消す。ファイルが消せなくても行は消えているので ok', async () => {
    const order: string[] = [];
    const deleteRow = jest.fn(async () => { order.push('row'); return { error: null }; });
    const removeFiles = jest.fn(async () => { order.push('file'); return { error: { message: 'gone' } }; });
    const r = await deleteBodyPhoto({ id: 'a', path: 'u1/a.jpg' }, { deleteRow, removeFiles });
    expect(r).toEqual({ ok: true, fileRemoved: false });
    expect(order).toEqual(['row', 'file']);
    expect(removeFiles).toHaveBeenCalledWith(['u1/a.jpg']);
  });

  it('削除: 行が消せなければファイルには触らない', async () => {
    const deleteRow = jest.fn(async () => ({ error: { code: '42501', message: 'permission denied' } }));
    const removeFiles = jest.fn(async () => ({ error: null }));
    const r = await deleteBodyPhoto({ id: 'a', path: 'u1/a.jpg' }, { deleteRow, removeFiles });
    expect(r).toMatchObject({ ok: false, step: 'delete', error: expect.stringMatching(/ログインし直して/) });
    expect(removeFiles).not.toHaveBeenCalled();
  });
});
