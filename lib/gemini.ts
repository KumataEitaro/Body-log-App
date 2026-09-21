// Gemini呼び出しの共通ヘルパー。
// 利用可能なモデルをListModelsで自動発見し、generateContent対応のflash系を優先して使う。
// モデル名がGoogle側で変わっても自動追従する（404が全滅したらキャッシュを捨てて再発見）。

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
// 発見に失敗した時の保険。**費用の安い順**に並べる（下の rank も同じ方針）。
//
// 2026-09-15 更新（新しいプロジェクトの API キーで全モデルを実測した結果）:
//  ・`gemini-2.5-flash-lite`（$0.10/$0.40）と `gemini-2.5-flash` は
//    **"no longer available to new users" で 404**。作り直したプロジェクトでは使えない
//  ・**新しい世代ほど高い**。`gemini-flash-latest` は実体が `gemini-3.8-flash`（$0.75/$3.75）で、
//    しかも **2027-01-01 に $1.50/$7.50 へ倍増が公式告知済み**。「新しい順」は費用の観点では逆効果
//  ・`gemini-flash-lite-latest` の実体は `gemini-3.5-flash-lite`（$0.30/$2.50）
//  ・実測で通った最安は **`gemini-3.1-flash-lite`（$0.25/$1.50）**
//  ・3.5-flash-lite 系は `thinkingConfig` を 400 で拒否する（tryModel が自動で外して再試行するので動くが、
//    1往復むだになる）。3.1-flash-lite は受け付ける
// 価格の一次情報は docs/llm-pricing-2026-09.md、方針は docs/LLM-PROVIDERS.md
const STATIC_FALLBACK = [
  'gemini-3.1-flash-lite',    // $0.25/$1.50 実測で通る最安
  'gemini-3.5-flash-lite',    // $0.30/$2.50
  'gemini-flash-lite-latest', // → 3.5-flash-lite の別名（名前が生き残る側の保険）
  'gemini-flash-latest',      // → 3.8-flash（$0.75/$3.75・高い）。ここまで落ちたら可用性優先
];

let cachedModels: string[] | null = null;

// テスト用: モデル発見・実測ピンをスキップさせる（本番では使わない）
export function _setModelsForTest(models: string[] | null): void {
  cachedModels = models;
  lastGood = models?.[0] ?? null;   // ピン(probeFastest)を走らせない＝fetchモックの回数を予測可能に
  badUntil.clear();
}

// モデル名のスコアリング（**安い順**・埋め込み等は除外）。
//
// 2026-09-15 に方針を反転した。それまでは lite に -6 のペナルティを付けて
// 「品質重視で lite は後回し」にしていたが、Google の価格は**新しい世代ほど高い**ため、
// この並びだと自動的に最も高いモデル（`gemini-flash-latest` = 3.8-flash・$0.75/$3.75）が
// 選ばれ続ける。用途は「JSONの抽出」であって最前線の推論ではないので、lite で足りる。
// 新しさの加点は 404（世代交代でモデルが消える）の保険として残すが、**lite の加点より弱くする**。
function rank(nameRaw: string): number {
  const n = nameRaw.replace('models/', '');
  // テキスト生成以外（画像生成系の gemini-2.5-flash-image 等も含めて）除外
  if (/embedding|aqa|imagen|veo|tts|image|learnlm|gemma|audio|live/i.test(n)) return -1;
  let s = 0;
  if (n.includes('flash')) s += 50;
  if (n.includes('pro')) s += 20;
  if (n.includes('lite')) s += 40;  // **安いので最優先**（2026-09-15 に -6 から反転）
  if (n.includes('latest')) s += 15;
  const m = n.match(/(\d+(?:\.\d+)?)/);
  if (m) s += parseFloat(m[1]) * 1.5; // 新バージョンをわずかに優先（廃止済みIDを掴まないための保険）
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

// 直近で成功したモデル（warmなインスタンス内で持続）。次回はこれを最初に試す。
let lastGood: string | null = null;
// タイムアウト・廃止だったモデルはしばらく候補から外す（ランク上位が刺さると毎回遅くなるため）
const badUntil = new Map<string, number>();
const BAD_TTL_MS = 10 * 60_000;
// 先頭候補がこの時間内に返らなければ、次の候補を並走で追い越しにかける。
// （2026-08実測: flash-latest/3.7-flashが思考モードで20秒超・3.5-flashは1秒。
//   直列に待つと毎回50秒＝アプリ側45秒タイムアウトで「無反応」に見える事故になった）
const HEDGE_DELAY_MS = 2500;
const MAX_PARALLEL = 3;

type ModelTry =
  | { ok: true; text: string }
  | { ok: false; err: string; stale?: boolean; penalize?: boolean; penaltyMs?: number };

// 1モデルを試す（400→thinking設定を外して再試行 / 429・503→0.8秒後に1回だけ再試行）
async function tryModel(
  key: string, model: string, parts: Part[], temperature: number, ctrl: AbortController,
): Promise<ModelTry> {
  // 2.5系/3系/latest系は「思考(thinking)」がデフォルト有効で数秒〜数十秒消費するため無効化する。
  let includeThinking = /2\.5|latest|-3|3\./.test(model);
  let attempt = 0;
  let lastErr = '';
  while (attempt < 2) {
    attempt++;
    const genCfg: Record<string, unknown> = {
      temperature,
      responseMimeType: 'application/json',
      // 注意: 上限を小さくすると thinking が枠を食い潰して本文が空になるモデルがあるため大きめに
      maxOutputTokens: 8192,
      ...(includeThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    };
    // 20秒タイムアウトもヘッジ中断も同じabortになるため、どちらだったかをフラグで区別する
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, 20000); // 1試行20秒で打ち切り
    let res: Response;
    try {
      res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: genCfg }),
        signal: ctrl.signal,
      });
    } catch {
      // タイムアウト＝そのモデルが遅い（ペナルティ）。ヘッジ中断・回線断はモデルのせいにしない
      return { ok: false, err: timedOut ? `${model}: タイムアウト(20秒)` : `${model}: 中断/回線エラー`, penalize: timedOut || undefined };
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      lastErr = `${model}: HTTP ${res.status} ${t.slice(0, 240)}`;
      console.log(`[gemini] ${lastErr}`); // 失敗理由をサーバログに必ず残す
      if (res.status === 400 && includeThinking) {
        includeThinking = false; // 400はまずthinkingConfig非互換を疑い、外して同モデルで再試行
        continue;
      }
      if (res.status === 400) {
        // thinkingを外しても400＝このモデルはこちらのリクエスト形と恒常的に非互換
        // （2026-08-30実測: gemini-3.6-flashが常時400でヘッジ枠を1つ潰し、
        //   503スパイク時に生存モデルへ届かず全滅する事故の温床になった）。長めに追放する
        return { ok: false, err: lastErr, penalize: true, penaltyMs: 6 * 3600_000 };
      }
      if ((res.status === 503 || res.status === 429) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 800)); // 過負荷は同モデルで1回だけ再試行
        continue;
      }
      if (res.status === 503 || res.status === 429) {
        // 再試行しても過負荷＝短時間だけ候補から外す（スパイクは数分で引くので長く外さない。
        // 次のリクエストが同じ壁に正面衝突し続けるのを防ぐ）
        return { ok: false, err: lastErr, penalize: true, penaltyMs: 60_000 };
      }
      // 404=モデル廃止。以後しばらく候補から外し、全滅時の再発見トリガーにもする
      return { ok: false, err: lastErr, stale: res.status === 404, penalize: res.status === 404 };
    }
    const j = await res.json();
    // thinking系モデルは複数パーツで返すことがあるため全テキストを連結
    const partsArr: Array<{ text?: string }> = j.candidates?.[0]?.content?.parts || [];
    const out = partsArr.map((p) => p.text || '').join('');
    if (!out) return { ok: false, err: `${model}: 空応答` };
    return { ok: true, text: out };
  }
  return { ok: false, err: lastErr || `${model}: 再試行しても失敗` };
}

// コールドスタート時、候補モデル全部に極小の生成を同時に打ち、最初に返ってきた
// モデルを主役にする（1.5秒上限）。「ランク上位＝速い」が成り立たない時期
// （2026-08: flash-latest/3.7が思考モードで20秒超）でも、実測で速い個体を掴める。
async function probeFastest(key: string, candidates: string[]): Promise<string | null> {
  const ctrls: AbortController[] = [];
  const ping = async (model: string): Promise<string> => {
    const ctrl = new AbortController();
    ctrls.push(ctrl);
    const genCfg: Record<string, unknown> = {
      temperature: 0, maxOutputTokens: 16,
      ...(/2\.5|latest|-3|3\./.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    };
    const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: '1' }] }], generationConfig: genCfg }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const out = (j.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('');
    if (!out) throw new Error('empty');
    return model;
  };
  try {
    return await Promise.race([
      Promise.any(candidates.map(ping)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]).catch(() => null);
  } finally {
    for (const c of ctrls) c.abort();   // 勝者以外（と時間切れの全部）を中断
  }
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
  // 上位4→6に拡大（2026-08-30: 上位flash族が揃って503になるスパイクで、
  // lite系まで候補に入っていれば生き残れたため。系統の多様性が可用性そのもの）
  const discovered = cachedModels && cachedModels.length ? cachedModels.slice(0, 6) : [];
  // コールド（成功実績なし）なら、実測ピンで速いモデルを先に掴む（+最大1.5秒）
  if (!lastGood) {
    lastGood = await probeFastest(key, [...new Set([...discovered, ...STATIC_FALLBACK])].slice(0, 5));
  }
  let list = [...new Set([
    ...(lastGood ? [lastGood] : []),   // 前回成功したモデルを最優先
    ...discovered,
    ...STATIC_FALLBACK,
  ])];
  const now = Date.now();
  const alive = list.filter((m) => (badUntil.get(m) ?? 0) < now);
  if (alive.length) list = alive;   // 全滅していたらペナルティを無視して全候補で試す
  list = list.slice(0, 8);

  const errs: string[] = [];
  let sawStale = false;

  // 追い越しヘッジ: 先頭候補を発火し、HEDGE_DELAY_MS返らなければ次の候補も並走させる（最大3本）。
  // 最初に成功した応答を採用し、残りは中断する。刺さるモデルがいても体感を壊さないための構え。
  const result = await new Promise<{ ok: true; text: string } | null>((resolve) => {
    let settled = false;
    let nextIdx = 0;
    let inflight = 0;
    const ctrls = new Set<AbortController>();
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (r: { ok: true; text: string } | null) => {
      if (settled) return;
      settled = true;
      if (hedgeTimer) clearTimeout(hedgeTimer);
      for (const c of ctrls) c.abort();
      resolve(r);
    };

    const pump = () => {
      if (settled) return;
      if (nextIdx >= list.length) {
        if (inflight === 0) finish(null);   // 全候補が出尽くして全部失敗
        return;
      }
      const model = list[nextIdx++];
      const ctrl = new AbortController();
      ctrls.add(ctrl);
      inflight++;
      // tryModel内の想定外の例外（応答形式の異常等）もモデル失敗として扱い、全体を止めない
      tryModel(key, model, parts, temperature, ctrl)
        .catch((e): ModelTry => ({ ok: false, err: `${model}: ${String((e as Error)?.message ?? e)}` }))
        .then((r) => {
        inflight--;
        ctrls.delete(ctrl);
        if (settled) return;
        if (r.ok) {
          lastGood = model;   // 次回はこのモデルから
          finish(r);
          return;
        }
        errs.push(r.err);
        if (r.stale) sawStale = true;
        if (r.penalize) badUntil.set(model, Date.now() + (r.penaltyMs ?? BAD_TTL_MS));
        pump();   // 失敗したら空いた枠で即座に次の候補へ
      });
      // 応答が遅い場合の追い越しを予約
      if (hedgeTimer) clearTimeout(hedgeTimer);
      if (nextIdx < list.length) {
        hedgeTimer = setTimeout(() => { if (!settled && inflight < MAX_PARALLEL) pump(); }, HEDGE_DELAY_MS);
      }
    };
    pump();
  });

  if (result) return result;
  if (sawStale) cachedModels = null; // 全滅時は次回再発見
  // 上流のエラー本文はリクエストURL（?key=…）を含みうる。本番では返さずログだけに残す（QA C-7）
  const rawDetail = errs.slice(-3).join(' / ');
  const detail = process.env.NODE_ENV === 'production' ? undefined : rawDetail;
  if (process.env.NODE_ENV === 'production') console.error(`[gemini] all candidates failed: ${rawDetail}`);
  // ユーザー向けは日本語のみ（選択言語へはDOM翻訳が担当）。技術詳細はdetailに分離してログ用に返す
  //
  // 「待てば直る」と「待っても直らない」を区別する（2026-09-15）。
  // 実際に踏んだ事故: Gemini のプリペイド残高が尽き、全モデルが 429
  // "Your prepayment credits are depleted" を返した。それでも画面には
  // 「少し待って再試行してください」と出ていたため、利用者は何度も押し続け、
  // 熊田さんにも「AIが使えない」としか伝わらず、原因に辿り着くまで時間がかかった。
  if (isBillingExhausted(errs)) {
    console.error(`[gemini] 課金枠の枯渇でAIが全断: ${rawDetail}`);
    return {
      ok: false, status: 502, detail,
      error: 'AIの利用枠が上限に達しているため、いまは解析できません。再試行しても直りません。復旧までお待ちください（開発者に通知が届いています）。',
    };
  }
  return { ok: false, status: 502, error: 'AIが一時的に使えませんでした。少し待って再試行してください。', detail };
}

/**
 * 失敗の山が「支払い・利用枠の枯渇」か（＝再試行しても直らない）。
 *
 * Google はこの状態を 429 で返すが、同じ 429 には「一時的な過負荷」も混ざる。
 * 本文の文言で切り分ける。過負荷は待てば直るので、従来どおりの案内に落とす。
 * 判定は純関数にして tests/gemini.test.ts で固定する（文言が増えたらここに足す）。
 */
export function isBillingExhausted(errs: string[]): boolean {
  if (errs.length === 0) return false;
  const pat = /credits are depleted|billing|quota exceeded|exceeded your current quota|RESOURCE_EXHAUSTED|free tier|insufficient.*(credit|fund)/i;
  const http429 = errs.filter((e) => /HTTP 429/.test(e));
  // 429 が1件も無いなら過負荷でも枯渇でもない（404 の世代交代など）
  if (http429.length === 0) return false;
  // 429 のうち1件でも枯渇の文言を含むなら枯渇として扱う。
  // 枯渇はプロジェクト単位で起きるので、一部のモデルだけ過負荷という混在はまず無い
  return http429.some((e) => pat.test(e));
}
