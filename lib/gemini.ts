// Gemini呼び出しの共通ヘルパー。
// 利用可能なモデルをListModelsで自動発見し、generateContent対応のflash系を優先して使う。
// モデル名がGoogle側で変わっても自動追従する（404が全滅したらキャッシュを捨てて再発見）。

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
// 発見に失敗した時の保険（-latest系を先頭に。旧世代IDはGoogle側で随時廃止されるため保険は薄く）
const STATIC_FALLBACK = [
  'gemini-flash-latest', 'gemini-pro-latest',
  'gemini-3-flash', 'gemini-3.0-flash', 'gemini-3-pro',
  'gemini-2.5-flash', 'gemini-2.5-pro',
];

let cachedModels: string[] | null = null;

// テスト用: モデル発見をスキップさせる（本番では使わない）
export function _setModelsForTest(models: string[] | null): void {
  cachedModels = models;
}

// モデル名のスコアリング（flash優先・新しいバージョン優先・埋め込み等は除外）
function rank(nameRaw: string): number {
  const n = nameRaw.replace('models/', '');
  // テキスト生成以外（画像生成系の gemini-2.5-flash-image 等も含めて）除外
  if (/embedding|aqa|imagen|veo|tts|image|learnlm|gemma|audio|live/i.test(n)) return -1;
  let s = 0;
  if (n.includes('flash')) s += 50;
  if (n.includes('pro')) s += 20;
  if (n.includes('latest')) s += 15;
  const m = n.match(/(\d+(?:\.\d+)?)/);
  if (m) s += parseFloat(m[1]) * 3; // 新バージョンを少し優先（"gemini-3-flash"のような小数なし表記にも対応）
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
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string; detail?: string }> {
  // モデル発見: キャッシュが無ければ最大2秒だけ発見を待つ。
  // （静的リストはGoogleの世代交代でいずれ必ず古びる。2026-08に2.x系が全404になり
  //   AIが全断した事故の再発防止として、発見を最優先にする）
  if (!cachedModels) {
    const found = await Promise.race([
      discover(key),
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 2000)),
    ]);
    if (found.length) cachedModels = found;
  }
  const discovered = cachedModels && cachedModels.length ? cachedModels.slice(0, 4) : [];
  const list = [...new Set([...discovered, ...STATIC_FALLBACK])];

  let lastErr = '';
  const errs: string[] = []; // 失敗理由の履歴（診断用）
  let sawStale = false;
  for (const model of list) {
    // 2.5系/latest系は「思考(thinking)」がデフォルト有効で数秒〜10秒消費するため無効化する（速度最優先）。
    // thinkingConfig非対応モデルで400が返ったら、外して同モデルで1回だけ再試行。
    let includeThinking = /2\.5|latest|-3|3\./.test(model); // 2.5系・3系・latest系は思考を無効化して高速化
    let attempt = 0;
    while (attempt < 2) {
      attempt++;
      const genCfg: Record<string, unknown> = {
        temperature,
        responseMimeType: 'application/json',
        // 注意: 上限を小さくすると thinking が枠を食い潰して本文が空になるモデルがあるため大きめに
        maxOutputTokens: 8192,
        ...(includeThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000); // 1モデル20秒で打ち切り
      let res: Response;
      try {
        res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: genCfg }),
          signal: ctrl.signal,
        });
      } catch {
        clearTimeout(timer);
        lastErr = `${model}: タイムアウト(20秒)`;
        break; // 次のモデルへ
      }
      clearTimeout(timer);

      if (!res.ok) {
        const t = await res.text();
        lastErr = `${model}: HTTP ${res.status} ${t.slice(0, 240)}`;
        console.log(`[gemini] ${lastErr}`); // 失敗理由をサーバログに必ず残す
        if (res.status === 400 && includeThinking) {
          includeThinking = false; // 400はまずthinkingConfig非互換を疑い、外して同モデルで再試行
          continue;
        }
        if ((res.status === 503 || res.status === 429) && attempt < 2) {
          await new Promise((r) => setTimeout(r, 800)); // 過負荷は同モデルで1回だけ再試行
          continue;
        }
        if (res.status === 404) sawStale = true; // モデル廃止 → 次へ
        // どのエラーでも1モデルの非互換で全体を落とさず、次のモデルで続行する
        break;
      }
      const j = await res.json();
      // thinking系モデルは複数パーツで返すことがあるため全テキストを連結
      const partsArr: Array<{ text?: string }> = j.candidates?.[0]?.content?.parts || [];
      const out = partsArr.map((p) => p.text || '').join('');
      if (!out) { lastErr = `${model}: 空応答`; break; }
      return { ok: true, text: out };
    }
  }
  if (sawStale) cachedModels = null; // 全滅時は次回再発見
  // ユーザー向けは日本語のみ（選択言語へはDOM翻訳が担当）。技術詳細はdetailに分離してログ用に返す
  return { ok: false, status: 502, error: 'AIが一時的に使えませんでした。少し待って再試行してください。', detail: lastErr };
}
