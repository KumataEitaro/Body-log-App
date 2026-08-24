import { NextResponse } from 'next/server';
import { callGemini, parseJsonLoose } from '@/lib/gemini';
import { buildCoachPrompt, COACH_ACTION_KINDS } from '@/lib/coachPrompt';

// コーチAIの品質検証（ループエンジニアリング）用エンドポイント。
//
// 本番の /api/coach と同じ buildCoachPrompt・同じモデル呼び出しを、
// 「合成した本人データ」で実行する。ここで確かめた文面は本番と一字一句同じ。
//
// - QA_SECRET を知っている場合のみ動く（未設定なら常に404相当で閉じる）
// - DBには一切触れない（dataBlockはリクエストで受け取った文字列をそのまま使う）
// - ai_usage も数えない（品質検証はユーザーの利用ではないため）
export const preferredRegion = 'hnd1';

export async function POST(req: Request) {
  const secret = process.env.QA_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'no key' }, { status: 500 });

  const body = await req.json().catch(() => null) as { dataBlock?: string; question?: string } | null;
  const dataBlock = String(body?.dataBlock ?? '').slice(0, 8000);
  const question = String(body?.question ?? '').slice(0, 500);
  if (!dataBlock || !question) return NextResponse.json({ ok: false, error: 'dataBlock/question required' }, { status: 400 });

  const prompt = buildCoachPrompt({ dataBlock, historyBlock: '', question, answerLang: '' });
  const r = await callGemini(key, [{ text: prompt }], 0.4);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, detail: r.detail }, { status: r.status });

  let answer = '';
  let action: Record<string, unknown> | null = null;
  try {
    const j = parseJsonLoose(r.text) as { answer?: string; action?: Record<string, unknown> };
    answer = String(j.answer || '').trim();
    if (j.action && typeof j.action === 'object' && (COACH_ACTION_KINDS as readonly string[]).includes(String(j.action.kind))) {
      action = j.action;
    }
  } catch { /* JSON崩れ時は生テキスト */ }
  if (!answer) answer = r.text.trim();
  return NextResponse.json({ ok: true, answer, action });
}
