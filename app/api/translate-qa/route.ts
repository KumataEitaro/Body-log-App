import { NextResponse } from 'next/server';
import { callGemini, parseJsonLoose } from '@/lib/gemini';

// 辞書翻訳の作業用エンドポイント（ループエンジニアリング）。
// QA_SECRET を知る場合のみ動く。日本語キー＋英語参考訳のバッチを受け取り、
// 指定言語の訳をJSONで返す。DBに触れず、ai_usageも数えない。
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
    target?: string; entries?: { ja: string; en?: string }[];
  } | null;
  const target = String(body?.target ?? '').slice(0, 20);
  const entries = Array.isArray(body?.entries) ? body!.entries!.slice(0, 60) : [];
  if (!target || entries.length === 0) {
    return NextResponse.json({ ok: false, error: 'target/entries required' }, { status: 400 });
  }

  const list = entries.map((e, i) => `${i + 1}. ja: ${JSON.stringify(e.ja)}${e.en ? ` / en: ${JSON.stringify(e.en)}` : ''}`).join('\n');
  const prompt =
    `あなたはフィットネス/栄養アプリのUI翻訳者です。以下の日本語UI文字列を ${target} に翻訳してください。\n` +
    '規則:\n' +
    '- {n} {name} {p} などの波括弧プレースホルダは、綴りを一字も変えずそのまま残す\n' +
    '- kcal・kg・P/F/C などの単位・略語はそのまま\n' +
    '- UIラベルは短く自然に。文はアプリの声（責めない・軽い・丁寧すぎない）で\n' +
    '- 英語の参考訳がある場合はトーンを合わせる\n' +
    '- 絵文字は保持する\n' +
    `\n${list}\n` +
    '\n必ず {"t":["1番の訳","2番の訳",...]} のJSONのみを返す（配列の長さは入力と同じ）。';

  const r = await callGemini(key, [{ text: prompt }], 0.2);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  try {
    const j = parseJsonLoose(r.text) as { t?: string[] };
    if (!Array.isArray(j.t) || j.t.length !== entries.length) {
      return NextResponse.json({ ok: false, error: 'length mismatch', got: j.t?.length }, { status: 502 });
    }
    return NextResponse.json({ ok: true, t: j.t });
  } catch {
    return NextResponse.json({ ok: false, error: 'parse failed', raw: r.text.slice(0, 300) }, { status: 502 });
  }
}
