import { NextResponse, after } from 'next/server';
import { getApiAuth } from '@/lib/supabase/apiAuth';
import { AI_LIMITS_ENABLED, isUnlimited, todayJST } from '@/lib/calc';
import { resolvePlan, getLimits, checkKindLimit } from '@/lib/plan';
import { globalCapReached } from '@/lib/globalUsage';
import { callGemini, parseJsonLoose } from '@/lib/gemini';
import { findLang } from '@/lib/langs';
import { buildMenuAdvicePrompt } from '@/lib/menuAdvicePrompt';
import { buildDietBlock, dietAiPlan } from '@/lib/dietPrompt';

// 外食メニューおすすめ（B-11）: メニュー表の写真＋今日の残量＋目的から
// 「この中ならどれを選ぶべきか」を注文前に答える事前意思決定支援。
// 認証・上限・Gemini呼び出しの流儀は parse-food と同じ。プラン上限は
// 「写真1枚をAIに読ませる」点が同じ写真解析なので kind='photo' に相乗りする
// （新kindを作るとplan_limits・ai_usage両方のマイグレーションが要る割に意味が同じ）。
export const preferredRegion = 'hnd1';

const MAX_IMAGE_BYTES = 1_500_000; // base64後~2MB（parse-foodと同じ上限）

/** 1候補。dietFlag は食事の制約（B-18）に該当した可能性の強さ（該当なしはキーごと無し） */
type MenuPick = { name: string; estKcal: number; reason: string; dietFlag?: 'high' | 'maybe' };

/** AI応答のpicksを想定形だけに整える（プロンプトインジェクション等での型崩れを通さない） */
function sanitizePicks(v: unknown): MenuPick[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p): p is { name?: unknown; estKcal?: unknown; reason?: unknown; dietFlag?: unknown } => p != null && typeof p === 'object')
    .map((p) => ({
      name: String(p.name ?? '').slice(0, 80).trim(),
      estKcal: Math.round(Number(p.estKcal)) || 0,
      reason: String(p.reason ?? '').slice(0, 200).trim(),
      // 食事の制約（B-18）: high/maybe だけ通す。none・未知値はキーごと落として「該当なし」にする。
      // 安全を意味する値をクライアントへ渡さないため（docs/DIET-MODES.md §6）
      ...(p.dietFlag === 'high' || p.dietFlag === 'maybe' ? { dietFlag: p.dietFlag as 'high' | 'maybe' } : {}),
    }))
    .filter((p) => p.name)
    .slice(0, 3);
}

export async function POST(req: Request) {
  const t0 = Date.now();
  const [{ supabase, user }, bodyRaw] = await Promise.all([
    getApiAuth(req),
    req.json().catch(() => null),
  ]);
  if (!user) {
    return NextResponse.json({ ok: false, code: 'unauthorized', error: 'ログインが必要です。' }, { status: 401 });
  }
  if (!bodyRaw) {
    return NextResponse.json({ ok: false, error: '不正なリクエストです。' }, { status: 400 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: 'サーバーにAI用のAPIキーが未設定です（管理者向け: GEMINI_API_KEY）。' }, { status: 500 });
  }

  // ===== 入力 =====
  const body = bodyRaw as { image?: unknown; remainingKcal?: unknown; purposeKey?: unknown; pRemain?: unknown; lang?: unknown };
  const image = typeof body.image === 'string' ? body.image : '';
  if (!image || image.length > MAX_IMAGE_BYTES * 1.4) {
    return NextResponse.json({ ok: false, error: 'メニューの写真を送ってください。' }, { status: 400 });
  }
  const remainingKcal = Number(body.remainingKcal);
  if (!Number.isFinite(remainingKcal) || Math.abs(remainingKcal) > 20000) {
    return NextResponse.json({ ok: false, error: '残りカロリーの値が不正です。' }, { status: 400 });
  }
  const purposeKey = typeof body.purposeKey === 'string' && body.purposeKey ? body.purposeKey.slice(0, 20) : null;
  const pRemain = Number.isFinite(Number(body.pRemain)) && body.pRemain != null ? Number(body.pRemain) : null;
  const l = findLang(String(body.lang || ''));
  const outLang = l && l.code !== 'ja' ? `${l.name}（${l.native}）` : '';

  // ===== 使用回数・全体上限（parse-foodの写真解析と同じゲート） =====
  const today = todayJST();
  const [usageRes, capReached, profRes, dietRes] = await Promise.all([
    supabase.from('ai_usage').select('count,text_count,photo_count,coach_count').eq('user_id', user.id).eq('date', today).maybeSingle(),
    globalCapReached(),
    supabase.from('profiles').select('plan,plan_until,premium_until,photo_trial_used').eq('id', user.id).maybeSingle(),
    // 食事の制約（B-18・migration-26）。プラン取得とは別クエリにする＝列が無い環境でこの
    // selectが失敗しても、プラン判定まで巻き込んで無料に落ちない（parse-foodと同じ流儀）
    supabase.from('profiles').select('diet_modes,diet_custom,diet_consent_at').eq('id', user.id).maybeSingle(),
  ]);
  const used = usageRes.data?.count ?? 0;
  const photoTrialUsed = Number((profRes.data as { photo_trial_used?: number } | null)?.photo_trial_used ?? 0);
  const plan = resolvePlan(profRes.data);
  // AI_LIMITS_ENABLED=false の間は判定を眠らせる（parse-foodと同じ挙動を壊さない）
  if (AI_LIMITS_ENABLED && !isUnlimited(user.email)) {
    const limits = await getLimits(supabase, plan);
    const chk = checkKindLimit(limits, 'photo', usageRes.data, photoTrialUsed);
    if (!chk.ok) {
      const msg = chk.reason === 'trial'
        ? `写真解析のお試し枠（累計${chk.limit}枚）を使い切りました。写真解析はスタンダードプランで使えます。`
        : `本日の写真解析回数（${chk.limit}回）を使い切りました。明日また使えます。`;
      return NextResponse.json({ ok: false, code: 'plan_limit', plan, kind: 'photo', reason: chk.reason, error: msg }, { status: 429 });
    }
  }
  if (capReached) {
    return NextResponse.json({ ok: false, error: '本日はサービス全体のAI利用上限に達しました。明日また使えます。' }, { status: 429 });
  }

  // 食事の制約（B-18）: メニュー判定はスタンダード以上＋免責同意済みのときだけ注入する。
  // 候補は消さずに判定だけ付けさせる（消すと「安全な物だけ出た」と誤解させるため・§5）
  const diet = dietRes.data as { diet_modes?: unknown; diet_custom?: unknown; diet_consent_at?: string | null } | null;
  const dietBlock = (dietAiPlan(plan) || isUnlimited(user.email)) && diet?.diet_consent_at
    ? buildDietBlock({ modes: diet.diet_modes, custom: diet.diet_custom, noun: '候補', field: 'picks' })
    : '';

  const prompt = buildMenuAdvicePrompt({ remainingKcal, purposeKey, pRemain, outLang, dietBlock });
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
    { text: prompt },
    { inline_data: { mime_type: 'image/jpeg', data: image } },
  ];

  try {
    const tSetup = Date.now() - t0;
    const r = await callGemini(key, parts, 0.2);
    const tAi = Date.now() - t0 - tSetup;
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, detail: r.detail }, { status: r.status });
    let picks: MenuPick[] = [];
    let note = '';
    try {
      const j = parseJsonLoose(r.text) as { picks?: unknown; note?: unknown };
      picks = sanitizePicks(j.picks);
      note = String(j.note ?? '').slice(0, 300).trim();
    } catch {
      return NextResponse.json({ ok: false, error: 'AIの応答を解釈できませんでした。もう一度お試しください。' }, { status: 502 });
    }
    // 使用回数は応答を返した後に計上（写真解析として数える。parse-foodと同じ流儀）
    const bumpUsage = async () => {
      try {
        await supabase.from('ai_usage').upsert({
          user_id: user.id, date: today, count: used + 1,
          text_count: usageRes.data?.text_count ?? 0,
          photo_count: (usageRes.data?.photo_count ?? 0) + 1,
          coach_count: usageRes.data?.coach_count ?? 0,
        });
        if (plan === 'free' || plan === 'lite') {
          await supabase.from('profiles').update({ photo_trial_used: photoTrialUsed + 1 }).eq('id', user.id);
        }
      } catch { /* 計上失敗は無視 */ }
    };
    try { after(bumpUsage); } catch { void bumpUsage(); } // after非対応環境（テスト等）は即時実行
    console.log(`[menu-advice] setup=${tSetup}ms ai=${tAi}ms total=${Date.now() - t0}ms picks=${picks.length}`);
    return NextResponse.json({ ok: true, result: { picks, note }, plan });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.log(`[menu-advice] unhandled: ${detail}`);
    return NextResponse.json({ ok: false, code: 'advice_failed', error: '解析に失敗しました。もう一度お試しください。', detail }, { status: 500 });
  }
}
