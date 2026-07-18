// Gemini呼び出しの共通ヘルパー。
// 利用可能なモデルをListModelsで自動発見し、generateContent対応のflash系を優先して使う。
// モデル名がGoogle側で変わっても自動追従する（404が全滅したらキャッシュを捨てて再発見）。

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
// 発見に失敗した時の保険（新しめの候補を広めに）
const STATIC_FALLBACK = [
  'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  'gemini-2.0-flash-001', 'gemini-2.0-flash', 'gemini-pro-latest', 'gemini-2.5-pro',
];

let cachedModels: string[] | null = null;

// テスト用: モデル発見をスキップさせる（本番では使わない）
export function _setModelsForTest(models: string[] | null): void {
  cachedModels = models;
}

// モデル名のスコアリング（flash優先・新しいバージョン優先・埋め込み等は除外）
function rank(nameRaw: string): number {
  const n = nameRaw.replace('models/', '');
  if (/embedding|aqa|imagen|veo|tts|image-generation|learnlm|gemma/i.test(n)) return -1;
  let s = 0;
  if (n.includes('flash')) s += 50;
  if (n.includes('pro')) s += 20;
  if (n.includes('latest')) s += 15;
  const m = n.match(/(\d+\.\d+)/);
  if (m) s += parseFloat(m[1]) * 3; // 新バージョンを少し優先
  if (n.includes('lite')) s -= 6;   // 品質重視でliteは後回し（保険には残す）
  if (/preview|exp/i.test(n)) s -= 4;
  return s;
}

async function discover(key: string): Promise<string[]> {
  try {
    const r = await fetch(`${BASE}/models?key=${encodeURIComponent(key)}&pageSize=100`);
    if (!r.ok) return [];
    const j = await r.json();
    return (j.models || [])
      .filter((m: { supportedGenerationMethods?: string[] }) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m: { name: string }) => m.name.replace('models/', ''))
      .filter((n: string) => rank(n) >= 0)
      .sort((a: string, b: string) => rank(b) - rank(a));
  } catch {
    return [];
  }
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

// AI応答からJSONをゆるく取り出す（```json フェンス・前置きテキスト・思考出力に耐える）
export function parseJsonLoose(text: string): unknown {
  const t = String(text).trim();
  try { return JSON.parse(t); } catch { /* 次の手へ */ }
  // ```json ... ``` フェンスを剥がす
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* 次の手へ */ }
  }
  // 最初の { または [ から最後の } または ] までを試す
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const s = t.indexOf(open);
    const e = t.lastIndexOf(close);
    if (s !== -1 && e > s) {
      try { return JSON.parse(t.slice(s, e + 1)); } catch { /* 次の候補へ */ }
    }
  }
  throw new Error('JSONを抽出できませんでした');
}

export async function callGemini(
  key: string, parts: Part[], temperature = 0
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  if (!cachedModels) cachedModels = await discover(key);
  const discovered = cachedModels && cachedModels.length ? cachedModels.slice(0, 4) : [];
  const list = [...new Set([...discovered, ...STATIC_FALLBACK])];

  let lastErr = '';
  let sawStale = false;
  for (const model of list) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000); // 1モデル20秒で打ち切り
    let res: Response;
    try {
      res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature, responseMimeType: 'application/json' } }),
        signal: ctrl.signal,
      });
    } catch {
      clearTimeout(timer);
      lastErr = `${model}: タイムアウト(20秒)`;
      continue;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const t = await res.text();
      lastErr = `${model}: HTTP ${res.status} ${t.slice(0, 100)}`;
      if (res.status === 404) sawStale = true;                 // モデル廃止 → 次へ
      // 429=枠上限 / 404=廃止 / 500,503=そのモデルが過負荷・不調 → いずれも次のモデルで続行
      if (res.status === 429 || res.status === 404 || res.status === 500 || res.status === 503) continue;
      if (sawStale) cachedModels = null;
      return { ok: false, status: 502, error: `AI APIエラー(${res.status}): ${t.slice(0, 180)}` };
    }
    const j = await res.json();
    // thinking系モデルは複数パーツで返すことがあるため全テキストを連結
    const partsArr: Array<{ text?: string }> = j.candidates?.[0]?.content?.parts || [];
    const out = partsArr.map((p) => p.text || '').join('');
    if (!out) { lastErr = `${model}: 空応答`; continue; }
    return { ok: true, text: out };
  }
  if (sawStale) cachedModels = null; // 全滅時は次回再発見
  return { ok: false, status: 502, error: `AIが一時的に使えませんでした。少し待って再試行してください。（${lastErr}）` };
}
