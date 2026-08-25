import { NextResponse, after } from 'next/server';
import { getApiAuth } from '@/lib/supabase/apiAuth';
import { AI_DAILY_LIMIT, isUnlimited, todayJST } from '@/lib/calc';
import { isPremiumActive } from '@/lib/premium';
import { globalCapReached } from '@/lib/globalUsage';
import { callGemini, parseJsonLoose } from '@/lib/gemini';
import { findLang } from '@/lib/langs';
import { buildParseFoodPrompt, buildParseHistoryBlock } from '@/lib/parseFoodPrompt';

// 日本のユーザーが主のため東京リージョンで実行（画像アップロードとSupabase往復を短縮）
export const preferredRegion = 'hnd1';

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1_500_000; // base64後~2MB

export async function POST(req: Request) {
  const t0 = Date.now();
  // 認証確認（Web=Cookie / ネイティブ=Bearer 両対応）とボディ読込を並列に
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
  let text = '';
  let images: { data: string; mime: string }[] = [];
  let outLang = '';
  let history: { role: string; text: string }[] = [];
  {
    const body = bodyRaw as { text?: unknown; lang?: unknown; images?: unknown; history?: unknown };
    if (Array.isArray(body.history)) history = (body.history as { role: string; text: string }[]).slice(-4);
    text = String(body.text || '').slice(0, 3000);
    const l = findLang(String(body.lang || ''));
    if (l && l.code !== 'ja') outLang = `${l.name}（${l.native}）`;
    if (Array.isArray(body.images)) {
      images = body.images.slice(0, MAX_IMAGES)
        .filter((im: { data?: string; mime?: string }) =>
          typeof im?.data === 'string' && im.data.length < MAX_IMAGE_BYTES * 1.4 &&
          /^image\/(jpeg|png|webp)$/.test(String(im?.mime)))
        .map((im: { data: string; mime: string }) => ({ data: im.data, mime: im.mime }));
    }
  }
  if (!text.trim() && images.length === 0) {
    return NextResponse.json({ ok: false, error: 'テキストか写真のどちらかを入れてください。' }, { status: 400 });
  }

  // ===== 使用回数チェック・全体上限・マイ食品辞書を並列取得（直列3往復→1往復分の時間に） =====
  const today = todayJST();
  const [usageRes, capReached, myFoodsRes, premRes] = await Promise.all([
    supabase.from('ai_usage').select('count').eq('user_id', user.id).eq('date', today).maybeSingle(),
    globalCapReached(),
    supabase.from('my_foods').select('name,kind,unit,kcal,p,f,c,note,serving_label,serving_ratio').limit(60),
    supabase.from('profiles').select('premium_until').eq('id', user.id).maybeSingle(), // 列未作成でもerror→無料扱いで安全
  ]);
  // プレミアム会員はAI無制限（管理者メールも従来どおり無制限）
  const unlimited = isUnlimited(user.email) || isPremiumActive(premRes.data?.premium_until as string | null | undefined);
  const used = usageRes.data?.count ?? 0;
  if (!unlimited && used >= AI_DAILY_LIMIT) {
    return NextResponse.json({
      ok: false, remaining: 0,
      error: `本日のAI解析回数（${AI_DAILY_LIMIT}回）を使い切りました。明日また使えます。`,
    }, { status: 429 });
  }
  // 全体上限（課金の安全弁）。管理者もコスト保護のため対象
  if (capReached) {
    return NextResponse.json({
      ok: false, remaining: unlimited ? null : AI_DAILY_LIMIT - used,
      error: '本日はサービス全体のAI利用上限に達しました。明日また使えます。',
    }, { status: 429 });
  }

  // ユーザー登録のマイ食品・レシピを辞書としてプロンプトに注入
  const myFoods = myFoodsRes.data;
  let dictBlock = '';
  if (myFoods && myFoods.length > 0) {
    const lines = myFoods.map((fd) => {
      const r = fd.serving_ratio != null && Number(fd.serving_ratio) > 0 ? Number(fd.serving_ratio) : null;
      const serving = r != null
        ? ` ／ 1回分の量:基準量の${r}倍=${Math.round(Number(fd.kcal) * r)}kcal`
        : '';
      return `- ${fd.name} 基準量:${fd.unit} = ${fd.kcal}kcal P${fd.p} F${fd.f} C${fd.c}${serving}${fd.note ? ` ／ ${String(fd.note).slice(0, 80)}` : ''}`;
    }).join('\n');
    dictBlock =
      '\n【ユーザー登録のマイ食品辞書（基準量あたり）】\n' + lines + '\n' +
      '辞書ルール:\n' +
      '- メモに辞書の名前（表記ゆれ含む）が出てきたら、一般的な推定ではなく登録値を基準に、書かれた分量に比例スケールして計算する（例: 基準量が全量で「1/3食べた」なら1/3倍、「丼1杯」など基準量と単位が違う場合は常識的に換算）。\n' +
      '- 分量の記載がなく「1回分の量」が登録されている場合は、質問せず1回分として計算する。「2杯」「2回分」等とあれば1回分×2。\n' +
      '- 分量の記載がなく、1回分の量も未登録で、基準量が「全量」など一度に食べきらない量の場合は、itemsに含めず"questions"配列に「◯◯はどのくらい食べましたか？（全量で△△kcal）」形式の日本語の質問を入れる。\n' +
      '- 分量の記載がなく、基準量が1個・1杯など単品の場合は基準量1つ分として計算する。\n';
  }

  const prompt = buildParseFoodPrompt({ text, dictBlock, outLang, historyBlock: buildParseHistoryBlock(history) });

  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [{ text: prompt }];
  for (const im of images) {
    parts.push({ inline_data: { mime_type: im.mime, data: im.data } });
  }

  try {
    const tSetup = Date.now() - t0;
    const r = await callGemini(key, parts, 0);
    const tAi = Date.now() - t0 - tSetup;
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, detail: r.detail }, { status: r.status });
    let parsed;
    try {
      parsed = parseJsonLoose(r.text);
    } catch {
      return NextResponse.json({ ok: false, error: 'AIの応答を解釈できませんでした。もう一度お試しください。' }, { status: 502 });
    }
    // 使用回数のカウントアップは応答を返した後に実行（ユーザーを待たせない）
    const bumpUsage = async () => {
      try { await supabase.from('ai_usage').upsert({ user_id: user.id, date: today, count: used + 1 }); } catch { /* 計上失敗は無視 */ }
    };
    try { after(bumpUsage); } catch { void bumpUsage(); } // after非対応環境（テスト等）は即時実行
    const totalMs = Date.now() - t0;
    console.log(`[parse-food] setup=${tSetup}ms ai=${tAi}ms total=${totalMs}ms imgs=${images.length} textLen=${text.length}`);
    return NextResponse.json({
      ok: true, result: parsed, remaining: unlimited ? null : AI_DAILY_LIMIT - used - 1,
      timings: { setupMs: tSetup, aiMs: tAi, totalMs },
    });
  } catch (e) {
    // ユーザー向けは日本語のみ。技術詳細はdetailとサーバログへ
    const detail = e instanceof Error ? e.message : String(e);
    console.log(`[parse-food] unhandled: ${detail}`);
    return NextResponse.json({ ok: false, code: 'parse_failed', error: '解析に失敗しました。もう一度お試しください。', detail }, { status: 500 });
  }
}
