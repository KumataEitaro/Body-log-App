import { NextResponse } from 'next/server';

// Gemini各モデルの生死・応答時間の診断（ループエンジニアリング用）。
// 本番の callGemini と同じ発見ロジック・同じ試行順で、1モデルずつ軽いJSONタスクを
// 実測して返す。解析が遅い時に「どのモデルで時間が溶けているか」を特定するために使う。
export const preferredRegion = 'hnd1';
export const maxDuration = 300;

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const STATIC_FALLBACK = [
  'gemini-flash-latest', 'gemini-pro-latest',
  'gemini-3-flash', 'gemini-3.0-flash', 'gemini-3-pro',
  'gemini-2.5-flash', 'gemini-2.5-pro',
];

// lib/gemini.ts の rank と同一（診断は本番と同じ順序で見ることに意味がある）
function rank(nameRaw: string): number {
  const n = nameRaw.replace('models/', '');
  if (/embedding|aqa|imagen|veo|tts|image|learnlm|gemma|audio|live/i.test(n)) return -1;
  let s = 0;
  if (n.includes('flash')) s += 50;
  if (n.includes('pro')) s += 20;
  if (n.includes('latest')) s += 15;
  const m = n.match(/(\d+(?:\.\d+)?)/);
  if (m) s += parseFloat(m[1]) * 3;
  if (n.includes('lite')) s -= 6;
  if (/preview|exp/i.test(n)) s -= 4;
  return s;
}

export async function POST(req: Request) {
  const secret = process.env.QA_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'no key' }, { status: 500 });

  // 発見（本番と同じフィルタ・ソート）
  const t0 = Date.now();
  let discovered: string[] = [];
  try {
    const r = await fetch(`${BASE}/models?key=${encodeURIComponent(key)}&pageSize=100`);
    if (r.ok) {
      const j = await r.json();
      discovered = (j.models || [])
        .filter((m: { supportedGenerationMethods?: string[] }) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m: { name: string }) => m.name.replace('models/', ''))
        .filter((n: string) => rank(n) >= 0)
        .sort((a: string, b: string) => rank(b) - rank(a));
    }
  } catch { /* 発見失敗はdiscovered空のまま返す */ }
  const discoverMs = Date.now() - t0;

  const list = [...new Set([...discovered.slice(0, 4), ...STATIC_FALLBACK])];
  const results: Array<{ model: string; status: string; ms: number; note?: string }> = [];
  for (const model of list) {
    const genCfg: Record<string, unknown> = {
      temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 8192,
      ...(/2\.5|latest|-3|3\./.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const t1 = Date.now();
    try {
      const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: '{"a":1}というJSONだけ返して' }] }], generationConfig: genCfg }),
        signal: ctrl.signal,
      });
      const ms = Date.now() - t1;
      if (!res.ok) {
        const t = await res.text();
        results.push({ model, status: `HTTP ${res.status}`, ms, note: t.slice(0, 160) });
      } else {
        const j = await res.json();
        const out = (j.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('');
        results.push({ model, status: out ? 'OK' : '空応答', ms });
      }
    } catch {
      results.push({ model, status: 'タイムアウト', ms: Date.now() - t1 });
    } finally { clearTimeout(timer); }
  }
  return NextResponse.json({ ok: true, discoverMs, discovered: discovered.slice(0, 10), tried: results });
}
