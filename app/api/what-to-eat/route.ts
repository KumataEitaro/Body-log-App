import { NextResponse, after } from 'next/server';
import { getApiAuth } from '@/lib/supabase/apiAuth';
import { AI_LIMITS_ENABLED, isUnlimited, todayJST } from '@/lib/calc';
import { resolvePlan, getLimits, checkKindLimit } from '@/lib/plan';
import { globalCapReached } from '@/lib/globalUsage';
import { callGemini, parseJsonLoose } from '@/lib/gemini';
import { findLang } from '@/lib/langs';
import { buildDietBlock, dietAiPlan } from '@/lib/dietPrompt';
import {
  buildWhatToEatPrompt, sanitizeEatPicks, slotOfHour,
  EAT_CONTEXTS, EAT_SLOTS, type EatContext, type EatSlot, type EatPick,
} from '@/lib/whatToEatPrompt';

// 「何を食べる？」（食事タブ内のAI相談）: 残りkcal・残りPFC・時間帯・目的・本人の法則・直近の食材・
// マイ食品から「いま何を食べるか」の候補を3案返す事前意思決定支援。
// 認証・上限・Gemini呼び出しの流儀は menu-advice / coach と同じ。
// プラン上限は「本人のデータを根拠にAIが提案する」点がAI相談と同じなので kind='coach'（coach_count）に
// 相乗りする（新kindを作るとplan_limits・ai_usage両方のマイグレーションが要る割に意味が同じ）。
// 無料（coach_day=0）では429 plan_limit → アプリ側は機能の存在を見せたまま「スタンダードで使えます」を出す。
export const preferredRegion = 'hnd1';

const NOTE_MAX = 80;
const INSIGHTS_MAX = 600;
const TAGS_MAX = 200;
const TIERS_MAX = 400;   // たんぱく源ティアの要約（食材ナビ・端末側 tierPromptSummary の上限と同値）

/** 制御文字を落として長さで切る（プロンプト肥大・改行によるルール破壊の防止） */
function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/[^\S\n]+/g, ' ').trim().slice(0, max);
}

function optNum(v: unknown, max: number): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
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
  if (!bodyRaw || typeof bodyRaw !== 'object') {
    return NextResponse.json({ ok: false, error: '不正なリクエストです。' }, { status: 400 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: 'サーバーにAI用のAPIキーが未設定です（管理者向け: GEMINI_API_KEY）。' }, { status: 500 });
  }

  // ===== 入力の検証 =====
  const body = bodyRaw as Record<string, unknown>;
  const context = String(body.context ?? '') as EatContext;
  if (!(EAT_CONTEXTS as readonly string[]).includes(context)) {
    return NextResponse.json({ ok: false, error: '場面（コンビニ・外食など）を選んでください。' }, { status: 400 });
  }
  const remainingKcal = Number(body.remainingKcal);
  if (!Number.isFinite(remainingKcal) || Math.abs(remainingKcal) > 20000) {
    return NextResponse.json({ ok: false, error: '残りカロリーの値が不正です。' }, { status: 400 });
  }
  const pRemain = optNum(body.pRemain, 2000);
  const fRemain = optNum(body.fRemain, 2000);
  const cRemain = optNum(body.cRemain, 5000);
  // 時間帯: クライアントの8区分を優先（端末の時計＝本人のいま）。無ければJSTの時から求める
  const slotRaw = String(body.slot ?? '');
  const slot: EatSlot = (EAT_SLOTS as readonly string[]).includes(slotRaw)
    ? (slotRaw as EatSlot)
    : slotOfHour(new Date(Date.now() + 9 * 3600_000).getUTCHours());
  const note = cleanText(body.note, NOTE_MAX);
  const insights = cleanText(body.insights, INSIGHTS_MAX);
  const recentTags = cleanText(body.recentTags, TAGS_MAX).replace(/\n+/g, ' ');
  const proteinTiers = cleanText(body.proteinTiers, TIERS_MAX).replace(/\n+/g, ' ');
  const myFoods = Array.isArray(body.myFoods)
    ? body.myFoods.filter((s): s is string => typeof s === 'string').map((s) => cleanText(s, 40)).filter(Boolean).slice(0, 10)
    : [];
  const purposeFromClient = typeof body.purposeKey === 'string' && body.purposeKey ? body.purposeKey.slice(0, 20) : null;
  const l = findLang(String(body.lang || ''));
  const outLang = l && l.code !== 'ja' ? `${l.name}（${l.native}）` : '';

  // ===== 使用回数・全体上限（AI相談と同じゲート: kind='coach'） =====
  const today = todayJST();
  const [usageRes, capReached, profRes, dietRes] = await Promise.all([
    supabase.from('ai_usage').select('count,text_count,photo_count,coach_count').eq('user_id', user.id).eq('date', today).maybeSingle(),
    globalCapReached(),
    supabase.from('profiles').select('plan,plan_until,premium_until,purpose,maternity,constraints_note').eq('id', user.id).maybeSingle(),
    // 食事の制約（B-18・migration-26）。プラン取得とは別クエリ＝列が無い環境でも上限判定を巻き込まない
    supabase.from('profiles').select('diet_modes,diet_custom,diet_consent_at').eq('id', user.id).maybeSingle(),
  ]);
  const used = usageRes.data?.count ?? 0;
  const prof = (profRes.data ?? null) as { purpose?: string | null; maternity?: boolean | null; constraints_note?: string | null } | null;
  const plan = resolvePlan(profRes.data);
  if (AI_LIMITS_ENABLED && !isUnlimited(user.email)) {
    const limits = await getLimits(supabase, plan);
    const chk = checkKindLimit(limits, 'coach', usageRes.data, 0);
    if (!chk.ok) {
      // 上限0=そのプランでは1回も使えない（free/lite）。「0回を使い切った」と言わない
      return NextResponse.json({
        ok: false, code: 'plan_limit', plan, kind: 'coach', reason: chk.reason, limit: chk.limit,
        error: chk.limit === 0
          ? '「何を食べる？」の提案はスタンダードプラン以上で使えます（AI相談と同じ枠です）。'
          : `本日のAI相談回数（${chk.limit}回）を使い切りました。明日また使えます。`,
      }, { status: 429 });
    }
  }
  if (capReached) {
    return NextResponse.json({ ok: false, error: '本日はサービス全体のAI利用上限に達しました。明日また使えます。' }, { status: 429 });
  }

  // 食事の制約（B-18）: スタンダード以上＋免責同意済みのときだけ注入。候補は消さず判定だけ付けさせる（§5）
  const diet = dietRes.data as { diet_modes?: unknown; diet_custom?: unknown; diet_consent_at?: string | null } | null;
  const dietBlock = (dietAiPlan(plan) || isUnlimited(user.email)) && diet?.diet_consent_at
    ? buildDietBlock({ modes: diet.diet_modes, custom: diet.diet_custom, noun: '候補', field: 'picks' })
    : '';

  const base = {
    context, remainingKcal, pRemain, fRemain, cRemain, slot,
    // 目的はクライアント（端末の選択）を優先し、無ければプロフィールの値
    purposeKey: purposeFromClient ?? (prof?.purpose ? String(prof.purpose) : null),
    note, outLang, dietBlock, insights, recentTags, proteinTiers, myFoods,
    constraintsNote: prof?.constraints_note ?? null,
    maternity: prof?.maternity === true,
  };

  try {
    const tSetup = Date.now() - t0;
    // 1回目→JSONが読めなければ形式を念押しして1回だけ再試行（温度も下げる）
    let picks: EatPick[] = [];
    let note2 = '';
    let aiError: { status: number; error: string; detail?: string } | null = null;
    for (let attempt = 0; attempt < 2 && picks.length === 0; attempt++) {
      const prompt = buildWhatToEatPrompt({ ...base, retry: attempt > 0 });
      const r = await callGemini(key, [{ text: prompt }], attempt === 0 ? 0.5 : 0.2);
      if (!r.ok) { aiError = { status: r.status, error: r.error, detail: r.detail }; break; }
      try {
        const j = parseJsonLoose(r.text) as { picks?: unknown; note?: unknown };
        picks = sanitizeEatPicks(j.picks);
        note2 = String(j.note ?? '').slice(0, 300).trim();
      } catch { /* 再試行へ */ }
    }
    const tAi = Date.now() - t0 - tSetup;
    if (aiError) return NextResponse.json({ ok: false, error: aiError.error, detail: aiError.detail }, { status: aiError.status });
    if (picks.length === 0) {
      return NextResponse.json({ ok: false, code: 'no_picks', error: 'うまく考えられませんでした。もう一度お試しください。' }, { status: 502 });
    }
    // 使用回数は応答を返した後に計上（AI相談として数える）
    const bumpUsage = async () => {
      try {
        await supabase.from('ai_usage').upsert({
          user_id: user.id, date: today, count: used + 1,
          text_count: usageRes.data?.text_count ?? 0,
          photo_count: usageRes.data?.photo_count ?? 0,
          coach_count: (usageRes.data?.coach_count ?? 0) + 1,
        });
      } catch { /* 計上失敗は無視 */ }
    };
    try { after(bumpUsage); } catch { void bumpUsage(); } // after非対応環境（テスト等）は即時実行
    console.log(`[what-to-eat] ctx=${context} setup=${tSetup}ms ai=${tAi}ms total=${Date.now() - t0}ms picks=${picks.length}`);
    return NextResponse.json({ ok: true, result: { picks, note: note2 }, plan });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.log(`[what-to-eat] unhandled: ${detail}`);
    return NextResponse.json({ ok: false, code: 'advice_failed', error: 'うまく考えられませんでした。もう一度お試しください。', detail }, { status: 500 });
  }
}
