import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AI_DAILY_LIMIT, isUnlimited, todayJST } from '@/lib/calc';
import { globalCapReached } from '@/lib/globalUsage';
import { callGemini, parseJsonLoose } from '@/lib/gemini';
import { findLang } from '@/lib/langs';

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1_500_000; // base64後~2MB

export async function POST(req: Request) {
  // ログイン済みユーザーのみ利用可
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'ログインが必要です。' }, { status: 401 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: 'サーバーにAI用のAPIキーが未設定です（管理者向け: GEMINI_API_KEY）。' }, { status: 500 });
  }

  // ===== 1日の使用回数チェック（無制限アカウントは上限チェックのみスキップ。記録等は共通） =====
  const unlimited = isUnlimited(user.email);
  const today = todayJST();
  const { data: usage } = await supabase.from('ai_usage')
    .select('count').eq('user_id', user.id).eq('date', today).maybeSingle();
  const used = usage?.count ?? 0;
  if (!unlimited && used >= AI_DAILY_LIMIT) {
    return NextResponse.json({
      ok: false, remaining: 0,
      error: `本日のAI解析回数（${AI_DAILY_LIMIT}回）を使い切りました。明日また使えます。`,
    }, { status: 429 });
  }
  // 全体上限（課金の安全弁）。管理者もコスト保護のため対象
  if (await globalCapReached()) {
    return NextResponse.json({
      ok: false, remaining: unlimited ? null : AI_DAILY_LIMIT - used,
      error: '本日はサービス全体のAI利用上限に達しました。明日また使えます。',
    }, { status: 429 });
  }

  // ===== 入力 =====
  let text = '';
  let images: { data: string; mime: string }[] = [];
  let outLang = '';
  try {
    const body = await req.json();
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
  } catch {
    return NextResponse.json({ ok: false, error: '不正なリクエストです。' }, { status: 400 });
  }
  if (!text.trim() && images.length === 0) {
    return NextResponse.json({ ok: false, error: 'テキストか写真のどちらかを入れてください。' }, { status: 400 });
  }

  // ユーザー登録のマイ食品・レシピを辞書としてプロンプトに注入
  const { data: myFoods } = await supabase.from('my_foods')
    .select('name,kind,unit,kcal,p,f,c,note,serving_label,serving_ratio').limit(60);
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

  const prompt =
    'あなたは日本の管理栄養士 兼 トレーニング記録係です。ユーザーの1日の記録メモ（と食事写真）を解析してください。\n' +
    '\n【タスク1: 食事】メモと写真に写っている食事の各品目と合計の kcal・たんぱく質P(g)・脂質F(g)・炭水化物C(g) を推定する。\n' +
    '- 数量不明の調味料は大さじ1として計算\n' +
    '- 肉・魚・米などのグラム数は生の重量とみなす\n' +
    '- 写真は写っている量から標準的な1人前を推定\n' +
    '- 同じ食事がメモと写真の両方にある場合は二重計上しない\n' +
    '\n【タスク2: その他の抽出】メモに書かれていれば抽出する（なければnull）:\n' +
    '- weight: 体重(kg)の数値\n' +
    '- waist: ウエスト・腹囲(cm)の数値\n' +
    '- ex: 運動量。次の5択にマッピング → "オフ"(運動なし)/"軽い"(散歩・ストレッチ程度≒+30kcal)/"通常"(筋トレ・ジム1時間程度≒+150kcal)/"高"(ランニング・スイム・登山半日などしっかり有酸素≒+400kcal)/"特大"(終日登山・レースなど≒+800kcal)\n' +
    '- adj: 補正kcal。基本は0。本人が消費kcalを明記している場合のみ、上記レベル値との差分を入れる\n' +
    '- mood: 気分・メンタルに関する記述の要約(20字以内)\n' +
    dictBlock +
    (outLang ? `\n出力言語: items[].name・qty・mood・questionsの文字列は${outLang}で書くこと。\n` : '') +
    '\n【禁止事項】疾病名の指摘・医療的な診断・治療の提案は行わないこと（本サービスは医療機器ではない）。\n' +
    '\n数値は四捨五入した整数。必ず次のJSON形式のみを返す:\n' +
    '{"items":[{"name":"品目","qty":"分量","kcal":0,"p":0,"f":0,"c":0}],' +
    '"total":{"kcal":0,"p":0,"f":0,"c":0},' +
    '"weight":null,"waist":null,"ex":null,"adj":0,"mood":null,"questions":[]}\n' +
    '\n記録メモ:\n' + (text.trim() || '(写真のみ)');

  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [{ text: prompt }];
  for (const im of images) {
    parts.push({ inline_data: { mime_type: im.mime, data: im.data } });
  }

  try {
    const r = await callGemini(key, parts, 0);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    let parsed;
    try {
      parsed = parseJsonLoose(r.text);
    } catch {
      return NextResponse.json({ ok: false, error: 'AIの応答を解釈できませんでした。もう一度お試しください。' }, { status: 502 });
    }
    // 使用回数をカウントアップ（成功時のみ・無制限アカウントも記録は共通）
    await supabase.from('ai_usage').upsert({ user_id: user.id, date: today, count: used + 1 });
    return NextResponse.json({ ok: true, result: parsed, remaining: unlimited ? null : AI_DAILY_LIMIT - used - 1 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: '解析に失敗しました: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
