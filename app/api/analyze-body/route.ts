import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AI_DAILY_LIMIT, isUnlimited, todayJST } from '@/lib/calc';
import { globalCapReached } from '@/lib/globalUsage';
import { callGemini, parseJsonLoose } from '@/lib/gemini';
import { findLang } from '@/lib/langs';

const MAX_IMAGE_BYTES = 1_500_000;

// mode: 'assess'  = 現状の体組成判定（写真1〜2枚）
// mode: 'compare' = 前回写真との比較（before/after 各1枚）
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'ログインが必要です。' }, { status: 401 });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'サーバーにAI用のAPIキーが未設定です。' }, { status: 500 });

  const unlimited = isUnlimited(user.email);
  const today = todayJST();
  const { data: usage } = await supabase.from('ai_usage')
    .select('count').eq('user_id', user.id).eq('date', today).maybeSingle();
  const used = usage?.count ?? 0;
  if (!unlimited && used >= AI_DAILY_LIMIT) {
    return NextResponse.json({ ok: false, remaining: 0, error: `本日のAI回数（${AI_DAILY_LIMIT}回）を使い切りました。` }, { status: 429 });
  }
  if (await globalCapReached()) {
    return NextResponse.json({ ok: false, remaining: unlimited ? null : AI_DAILY_LIMIT - used, error: '本日はサービス全体のAI利用上限に達しました。明日また使えます。' }, { status: 429 });
  }

  let mode = 'assess';
  let images: { data: string; mime: string }[] = [];
  let context = '';
  let outLang = '';
  try {
    const body = await req.json();
    mode = body.mode === 'compare' ? 'compare' : 'assess';
    context = String(body.context || '').slice(0, 500);
    const l = findLang(String(body.lang || ''));
    if (l && l.code !== 'ja') outLang = `${l.name}（${l.native}）`;
    if (Array.isArray(body.images)) {
      images = body.images.slice(0, 2)
        .filter((im: { data?: string; mime?: string }) =>
          typeof im?.data === 'string' && im.data.length < MAX_IMAGE_BYTES * 1.4 &&
          /^image\/(jpeg|png|webp)$/.test(String(im?.mime)))
        .map((im: { data: string; mime: string }) => ({ data: im.data, mime: im.mime }));
    }
  } catch {
    return NextResponse.json({ ok: false, error: '不正なリクエストです。' }, { status: 400 });
  }
  if (images.length === 0) return NextResponse.json({ ok: false, error: '写真が必要です。' }, { status: 400 });

  const prompt = mode === 'assess'
    ? 'あなたは経験豊富なフィットネストレーナーです。この体の写真から体組成を推定してください。\n' +
      (context ? `本人の情報・目標: ${context}\n` : '') +
      '注意: 写真からの推定は±3%程度の誤差があること、励ましのトーンで書くこと。\n' +
      '禁止: 疾病名の指摘・医療的な診断・治療の提案は行わないこと（本サービスは医療機器ではない）。\n' +
      '必ず次のJSON形式のみを返す:\n' +
      '{"bf_est": 推定体脂肪率の数値(例:16.5), "muscle": "筋肉のつき方の観察(60字以内)", "comment": "現状評価と目標に向けたアドバイス(120字以内)"}'
    : 'あなたは経験豊富なフィットネストレーナーです。1枚目が前回、2枚目が今回の体の写真です。変化を比較してください。\n' +
      (context ? `本人の情報・目標: ${context}\n` : '') +
      '注意: 小さな変化も見つけて具体的に。停滞していても改善点を前向きに。\n' +
      '禁止: 疾病名の指摘・医療的な診断・治療の提案は行わないこと（本サービスは医療機器ではない）。\n' +
      '必ず次のJSON形式のみを返す:\n' +
      '{"bf_est": 今回の推定体脂肪率(数値), "progress": "ahead|ontrack|behind のいずれか", "comment": "どこがどう変わったか、次に何をすべきか(150字以内)"}';

  const finalPrompt = outLang ? `${prompt}\nコメント等の文字列は${outLang}で書くこと。` : prompt;
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [{ text: finalPrompt }];
  for (const im of images) parts.push({ inline_data: { mime_type: im.mime, data: im.data } });

  try {
    const r = await callGemini(key, parts, 0.2);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    let parsed;
    try { parsed = parseJsonLoose(r.text); } catch {
      return NextResponse.json({ ok: false, error: 'AIの応答を解釈できませんでした。もう一度お試しください。' }, { status: 502 });
    }
    await supabase.from('ai_usage').upsert({ user_id: user.id, date: today, count: used + 1 });
    return NextResponse.json({ ok: true, result: parsed, remaining: unlimited ? null : AI_DAILY_LIMIT - used - 1 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: '解析に失敗しました: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
