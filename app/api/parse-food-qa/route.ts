import { NextResponse } from 'next/server';
import { callGemini, parseJsonLoose } from '@/lib/gemini';
import { buildParseFoodPrompt, buildParseHistoryBlock } from '@/lib/parseFoodPrompt';

// 食事解析の品質検証（ループエンジニアリング）用エンドポイント。
// 本番の /api/parse-food と同じ buildParseFoodPrompt・同じモデル呼び出しを、
// 合成入力で実行する。DBに触れず、ai_usage も数えない（coach-qaと同じ方針）。
export const preferredRegion = 'hnd1';

export async function POST(req: Request) {
  const secret = process.env.QA_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'no key' }, { status: 500 });

  const body = await req.json().catch(() => null) as {
    text?: string; dictBlock?: string; history?: { role: string; text: string }[];
  } | null;
  const text = String(body?.text ?? '').slice(0, 3000);
  if (!text.trim()) return NextResponse.json({ ok: false, error: 'text required' }, { status: 400 });

  const prompt = buildParseFoodPrompt({
    text,
    dictBlock: String(body?.dictBlock ?? ''),
    outLang: '',
    historyBlock: buildParseHistoryBlock(Array.isArray(body?.history) ? body!.history! : []),
  });
  const r = await callGemini(key, [{ text: prompt }], 0);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, detail: r.detail }, { status: r.status });
  try {
    return NextResponse.json({ ok: true, result: parseJsonLoose(r.text) });
  } catch {
    return NextResponse.json({ ok: false, error: 'JSONを解釈できませんでした', raw: r.text.slice(0, 500) }, { status: 502 });
  }
}
