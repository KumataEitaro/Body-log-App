// /api/what-to-eat（食事タブ内「何を食べる？」）の入力検証と正常系。
// Supabase・Geminiはモックし、認証／文脈／残量の検証と、応答のサニタイズ・使用回数（coach_count）の計上を確かめる。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type UsageRow = { count: number; coach_count?: number } | null;
const state: { user: { id: string } | null; usage: UsageRow; upserted: Array<Record<string, unknown>> } =
  { user: null, usage: null, upserted: [] };

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === 'profiles' ? null : state.usage }),
          eq: () => ({ maybeSingle: async () => ({ data: state.usage }) }),
        }),
      }),
      upsert: async (row: Record<string, unknown>) => { state.upserted.push(row); return { error: null }; },
    }),
  }),
}));

import { POST } from '../app/api/what-to-eat/route';
import { _setModelsForTest } from '../lib/gemini';

function req(body: unknown): Request {
  return new Request('http://test/api/what-to-eat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
const GEMINI_OK = (text: string) => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  text: async () => '',
});
const PICKS = {
  picks: [
    { name: 'サラダチキン＋鮭おにぎり', estKcal: 290, p: 28, f: 4, c: 38, reason: 'たんぱく質が取れて残りに収まります。' },
    { name: 'ゆで卵2個＋バナナ', estKcal: 240, p: 14, f: 10, c: 27, reason: 'すぐ食べられます。' },
    { name: 'ギリシャヨーグルト', estKcal: 100, p: 10, f: 0, c: 6, reason: '軽めです。', dietFlag: 'none' },
  ],
  note: '',
};
const VALID = { context: 'convenience', remainingKcal: 620, pRemain: 40, fRemain: 12, cRemain: 80, slot: 'noon' };

beforeEach(() => {
  state.user = { id: 'user-1' };
  state.usage = null;
  state.upserted = [];
  process.env.GEMINI_API_KEY = 'test-key';
  _setModelsForTest(['gemini-test']);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('POST /api/what-to-eat', () => {
  it('未ログインは401', async () => {
    state.user = null;
    const res = await POST(req(VALID));
    expect(res.status).toBe(401);
  });

  it('文脈チップが不正なら400（未知の値・欠落）', async () => {
    expect((await POST(req({ ...VALID, context: 'party' }))).status).toBe(400);
    expect((await POST(req({ remainingKcal: 500 }))).status).toBe(400);
  });

  it('残りカロリーが数値でない・極端なら400', async () => {
    expect((await POST(req({ ...VALID, remainingKcal: 'abc' }))).status).toBe(400);
    expect((await POST(req({ ...VALID, remainingKcal: 99999 }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('正常系: 3案を返し、dietFlag=none は落ち、coach_count を+1して計上する', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(GEMINI_OK(JSON.stringify(PICKS)));
    state.usage = { count: 2, coach_count: 1 };
    const res = await POST(req({ ...VALID, note: '魚がいい', myFoods: ['オートミール', 42, ''], insights: '【本人の法則】\n・睡眠不足の翌日に食べすぎ' }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.result.picks).toHaveLength(3);
    expect(j.result.picks[0].name).toBe('サラダチキン＋鮭おにぎり');
    expect('dietFlag' in j.result.picks[2]).toBe(false);
    expect(j.plan).toBe('free');
    // プロンプトに本人の一言・マイ食品・法則が入っている（型崩れの42は落ちる）
    const sent = JSON.parse(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body));
    const prompt = JSON.stringify(sent);
    expect(prompt).toContain('魚がいい');
    expect(prompt).toContain('オートミール');
    expect(prompt).toContain('コンビニ');
    expect(prompt).toContain('本人の法則');
    expect(state.upserted[0]).toMatchObject({ user_id: 'user-1', count: 3, coach_count: 2 });
  });

  it('1回目がJSONとして読めなければ念押しして1回だけ再試行し、それでも駄目なら502・回数は消費しない', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(GEMINI_OK('ごめんなさい、うまく考えられませんでした'))
      .mockResolvedValueOnce(GEMINI_OK('まだ文章です'));
    const res = await POST(req(VALID));
    expect(res.status).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String((fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body));
    expect(JSON.stringify(second)).toContain('JSONとして読めませんでした');
    expect(state.upserted.length).toBe(0);
  });

  it('再試行で読めれば200（1回目の失敗は本人に見せない）', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(GEMINI_OK('文章のみ'))
      .mockResolvedValueOnce(GEMINI_OK('```json\n' + JSON.stringify(PICKS) + '\n```'));
    const res = await POST(req({ ...VALID, context: 'snack' }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.result.picks).toHaveLength(3);
  });
});
