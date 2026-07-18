import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AI_DAILY_LIMIT } from '../lib/calc';

// ===== Supabaseサーバークライアントのモック =====
type UsageRow = { count: number } | null;
const state: {
  user: { id: string } | null;
  usage: UsageRow;
  upserted: Array<Record<string, unknown>>;
  myFoods: Array<Record<string, unknown>>;
} = { user: null, usage: null, upserted: [], myFoods: [] };

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
    },
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state.usage }),
          }),
        }),
        limit: async () => ({ data: state.myFoods }),
      }),
      upsert: async (row: Record<string, unknown>) => {
        state.upserted.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { POST } from '../app/api/parse-food/route';
import { _setModelsForTest } from '../lib/gemini';

function req(body: unknown): Request {
  return new Request('http://test/api/parse-food', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const GEMINI_OK = (json: unknown) => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] }),
  text: async () => '',
});
const GEMINI_FAIL = (status: number) => ({
  ok: false, status,
  json: async () => ({}),
  text: async () => `{"error":{"code":${status}}}`,
});

beforeEach(() => {
  state.user = { id: 'user-1' };
  state.usage = null;
  state.upserted = [];
  state.myFoods = [];
  process.env.GEMINI_API_KEY = 'test-key';
  _setModelsForTest(['gemini-test']); // モデル発見のListModels呼び出しをスキップ（fetch=generateContentのみ）
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/parse-food', () => {
  it('未ログインは401', async () => {
    state.user = null;
    const res = await POST(req({ text: 'ごはん' }));
    expect(res.status).toBe(401);
  });

  it('APIキー未設定は500', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await POST(req({ text: 'ごはん' }));
    expect(res.status).toBe(500);
    const j = await res.json();
    expect(j.error).toContain('GEMINI_API_KEY');
  });

  it('テキストも写真も無ければ400', async () => {
    const res = await POST(req({ text: '' }));
    expect(res.status).toBe(400);
  });

  it('1日の上限に達していたら429・remaining 0・Geminiを呼ばない', async () => {
    state.usage = { count: AI_DAILY_LIMIT };
    const res = await POST(req({ text: 'ごはん' }));
    expect(res.status).toBe(429);
    const j = await res.json();
    expect(j.remaining).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('正常系: 解析結果を返し、使用回数を+1、remainingを返す', async () => {
    const payload = {
      items: [{ name: 'ごはん', qty: '180g', kcal: 302, p: 6, f: 1, c: 67 }],
      total: { kcal: 302, p: 6, f: 1, c: 67 },
      weight: 75.2, ex: '通常', adj: 0, mood: '好調',
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(GEMINI_OK(payload));
    const res = await POST(req({ text: 'ごはん180g 体重75.2 筋トレ' }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.result.total.kcal).toBe(302);
    expect(j.remaining).toBe(AI_DAILY_LIMIT - 1);
    expect(state.upserted[0]).toMatchObject({ user_id: 'user-1', count: 1 });
  });

  it('429のモデルはスキップして次のモデルで成功する（フォールバック）', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(GEMINI_FAIL(429))
      .mockResolvedValueOnce(GEMINI_FAIL(404))
      .mockResolvedValueOnce(GEMINI_OK({ items: [], total: { kcal: 100, p: 1, f: 1, c: 1 } }));
    const res = await POST(req({ text: 'バナナ' }));
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
    const j = await res.json();
    expect(j.result.total.kcal).toBe(100);
  });

  it('全モデルが429なら502・回数は消費しない', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(GEMINI_FAIL(429));
    const res = await POST(req({ text: 'バナナ' }));
    expect(res.status).toBe(502);
    const j = await res.json();
    expect(j.error).toContain('再試行');
    expect(state.upserted.length).toBe(0);
  });

  it('503(モデル過負荷)もスキップして次のモデルで成功する', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(GEMINI_FAIL(503))
      .mockResolvedValueOnce(GEMINI_OK({ items: [], total: { kcal: 50, p: 1, f: 1, c: 1 } }));
    const res = await POST(req({ text: 'キノコ100g' }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.result.total.kcal).toBe(50);
  });

  it('429/404/503以外のAPIエラー(400等)は即座に502で返す', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(GEMINI_FAIL(400));
    const res = await POST(req({ text: 'バナナ' }));
    expect(res.status).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(1); // フォールバックしない
  });

  it('2回目の利用でremainingが正しく減る', async () => {
    state.usage = { count: 1 };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(GEMINI_OK({ items: [], total: { kcal: 1, p: 0, f: 0, c: 0 } }));
    const res = await POST(req({ text: 'みかん' }));
    const j = await res.json();
    expect(j.remaining).toBe(AI_DAILY_LIMIT - 2);
    expect(state.upserted[0]).toMatchObject({ count: 2 });
  });

  it('不正な形式の画像は無視される（jpeg/png/webp以外）', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(GEMINI_OK({ items: [], total: { kcal: 1, p: 0, f: 0, c: 0 } }));
    await POST(req({ text: 'りんご', images: [{ data: 'x', mime: 'image/gif' }, { data: 'y', mime: 'text/html' }] }));
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    // 画像パートが含まれない（テキストのみ）
    expect(body.contents[0].parts.length).toBe(1);
  });

  it('JSONでないボディは400', async () => {
    const res = await POST(new Request('http://test/api/parse-food', { method: 'POST', body: 'not-json' }));
    expect(res.status).toBe(400);
  });

  it('マイ食品辞書がプロンプトに注入される', async () => {
    state.myFoods = [{ name: '野菜鍋', kind: 'recipe', unit: '全量', kcal: 1800, p: 90, f: 60, c: 120, note: 'キャベツ/鶏むね/きのこ' }];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(GEMINI_OK({ items: [], total: { kcal: 0, p: 0, f: 0, c: 0 } }));
    await POST(req({ text: '野菜鍋 1/3' }));
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    const prompt = body.contents[0].parts[0].text as string;
    expect(prompt).toContain('野菜鍋');
    expect(prompt).toContain('1800kcal');
    expect(prompt).toContain('辞書ルール');
  });

  it('辞書が空ならプロンプトに辞書ブロックが入らない', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(GEMINI_OK({ items: [], total: { kcal: 0, p: 0, f: 0, c: 0 } }));
    await POST(req({ text: 'ごはん' }));
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.contents[0].parts[0].text).not.toContain('辞書ルール');
  });

  it('無制限アカウント(gotcha429@gmail.com)は上限超過でも解析できる', async () => {
    state.user = { id: 'admin-1', email: 'gotcha429@gmail.com' } as { id: string };
    state.usage = { count: 999 }; // 上限をはるかに超えていても
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(GEMINI_OK({ items: [], total: { kcal: 0, p: 0, f: 0, c: 0 } }));
    const res = await POST(req({ text: 'ごはん' }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.remaining).toBeNull(); // 残数表示なし
    expect(state.upserted.length).toBe(1); // 使用回数の記録は一般ユーザーと同じく行われる
  });

  it('一般ユーザーは上限で429のまま（無制限化の影響を受けない）', async () => {
    state.user = { id: 'user-2', email: 'friend@example.com' } as { id: string };
    state.usage = { count: 15 };
    const res = await POST(req({ text: 'ごはん' }));
    expect(res.status).toBe(429);
  });

  it('AIからのquestions（分量の確認質問）がレスポンスに含まれる', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(GEMINI_OK({
      items: [], total: { kcal: 0, p: 0, f: 0, c: 0 },
      questions: ['野菜鍋はどのくらい食べましたか？（全量で1800kcal）'],
    }));
    const res = await POST(req({ text: '野菜鍋' }));
    const j = await res.json();
    expect(j.result.questions).toHaveLength(1);
    expect(j.result.questions[0]).toContain('野菜鍋');
  });
});
