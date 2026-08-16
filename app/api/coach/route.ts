import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AI_DAILY_LIMIT, isUnlimited, todayJST, mifflinBMR, EX_ADD, type ExLevel } from '@/lib/calc';
import { globalCapReached } from '@/lib/globalUsage';
import { callGemini, parseJsonLoose } from '@/lib/gemini';
import { NUTRIENT_KEYS, type FoodItem } from '@/lib/items';

// AIコーチ相談: 本人の実データ（摂取推移・栄養素・気分・メモ・体重）を根拠に質問へ答える。
// 「気分がすぐれない」→ 直近のカロリー不足・栄養素・昨日のメモ（酒等）から仮説を提示する。
export const preferredRegion = 'hnd1';

function addDays(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const NUTRIENT_LABEL: Record<string, [string, string, number]> = {
  // key: [表示名, 単位, 1日の目安]
  salt: ['食塩相当量', 'g', 7.5], fib: ['食物繊維', 'g', 21], sug: ['糖類', 'g', 25],
  k: ['カリウム', 'mg', 3000], ca: ['カルシウム', 'mg', 750], mg: ['マグネシウム', 'mg', 370],
  fe: ['鉄', 'mg', 7.5], zn: ['亜鉛', 'mg', 11], vd: ['ビタミンD', 'μg', 8.5], vc: ['ビタミンC', 'mg', 100],
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const [{ data: { user } }, bodyRaw] = await Promise.all([
    supabase.auth.getUser(),
    req.json().catch(() => null),
  ]);
  if (!user) return NextResponse.json({ ok: false, error: 'ログインが必要です。' }, { status: 401 });
  if (!bodyRaw) return NextResponse.json({ ok: false, error: '不正なリクエストです。' }, { status: 400 });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'サーバーにAI用のAPIキーが未設定です。' }, { status: 500 });

  const question = String(bodyRaw.question ?? '').slice(0, 500).trim();
  if (!question) return NextResponse.json({ ok: false, error: '質問を入力してください。' }, { status: 400 });
  const history: { role: string; text: string }[] = Array.isArray(bodyRaw.history) ? bodyRaw.history.slice(-6) : [];

  // 使用回数（食事AI解析と同じ日次上限を共有）
  const today = todayJST();
  const unlimited = isUnlimited(user.email);
  const [usageRes, capReached] = await Promise.all([
    supabase.from('ai_usage').select('count').eq('user_id', user.id).eq('date', today).maybeSingle(),
    globalCapReached(),
  ]);
  const used = usageRes.data?.count ?? 0;
  if (!unlimited && used >= AI_DAILY_LIMIT) {
    return NextResponse.json({ ok: false, error: `本日のAI利用回数（${AI_DAILY_LIMIT}回）を使い切りました。明日また使えます。` }, { status: 429 });
  }
  if (capReached) {
    return NextResponse.json({ ok: false, error: '本日はサービス全体のAI利用上限に達しました。明日また使えます。' }, { status: 429 });
  }

  // ===== 本人データを収集して要約（直近28日） =====
  const from28 = addDays(today, -28);
  const from7 = addDays(today, -7);
  const [entriesRes, logsRes, goalRes, profRes] = await Promise.all([
    supabase.from('entries').select('date,intake,p,f,c,weight,mood,ex,adj,food_text').gte('date', from28).lte('date', today).order('date', { ascending: true }),
    supabase.from('logs').select('date,items,text,mood').gte('date', from7).order('at', { ascending: true }),
    supabase.from('goals').select('target_weight,target_date').maybeSingle(),
    supabase.from('profiles').select('sex,height_cm,age,life_factor,init_weight').eq('id', user.id).maybeSingle(),
  ]);
  const entries = entriesRes.data || [];
  const logRows = logsRes.data || [];
  const prof = profRes.data;
  if (!prof) return NextResponse.json({ ok: false, error: 'プロフィールが見つかりません。' }, { status: 400 });

  // 日次の目安と収支
  const weights = entries.filter((e) => e.weight != null);
  const latestW = weights.length ? Number(weights[weights.length - 1].weight) : Number(prof.init_weight) || 70;
  const bmr = mifflinBMR(prof.sex, latestW, Number(prof.height_cm), Number(prof.age));
  const base = Math.round(bmr * Number(prof.life_factor));
  const day = (e: typeof entries[number]) => {
    const target = base + (EX_ADD[(e.ex as ExLevel) || 'オフ'] ?? 0) + (Number(e.adj) || 0);
    const intake = e.intake == null ? null : Number(e.intake);
    return { date: String(e.date), intake, diff: intake == null ? null : Math.round(intake - target), p: e.p == null ? null : Number(e.p), mood: e.mood ? String(e.mood) : '', memo: e.food_text ? String(e.food_text).slice(0, 60) : '' };
  };
  const days = entries.map(day);
  const last7 = days.filter((d) => d.date > from7);
  const prev21 = days.filter((d) => d.date <= from7);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const wDelta = weights.length >= 2 ? (Number(weights[weights.length - 1].weight) - Number(weights[0].weight)).toFixed(1) : null;

  // 栄養素の直近平均（品目に栄養素が付いている記録のみ・無ければ「不明」）
  const nutTotals: Record<string, { sum: number; days: Set<string> }> = {};
  for (const r of logRows) {
    for (const it of ((r.items as FoodItem[]) || [])) {
      for (const k of NUTRIENT_KEYS) {
        const v = it[k];
        if (typeof v === 'number' && v > 0) {
          if (!nutTotals[k]) nutTotals[k] = { sum: 0, days: new Set() };
          nutTotals[k].sum += v;
          nutTotals[k].days.add(String(r.date));
        }
      }
    }
  }
  const nutLines = NUTRIENT_KEYS.map((k) => {
    const t = nutTotals[k];
    const [label, unit, ref] = NUTRIENT_LABEL[k];
    if (!t || t.days.size === 0) return `${label}: データなし`;
    const perDay = Math.round((t.sum / t.days.size) * 10) / 10;
    return `${label}: 約${perDay}${unit}/日 (目安${ref}${unit}・記録${t.days.size}日分)`;
  }).join(' / ');

  const dayLines = days.slice(-7).map((d) =>
    `${d.date.slice(5)}: 摂取${d.intake ?? '未記録'}${d.diff != null ? `(収支${d.diff > 0 ? '+' : ''}${d.diff})` : ''} P${d.p ?? '-'}g ${d.mood ? `気分:${d.mood} ` : ''}${d.memo ? `メモ:${d.memo}` : ''}`
  ).join('\n');

  const dataBlock =
    `【本人データ（直近28日・今日=${today}）】\n` +
    `維持カロリー目安: ${base}kcal/日（基礎代謝${Math.round(bmr)}）\n` +
    (goalRes.data ? `目標: ${goalRes.data.target_weight}kgまで（${goalRes.data.target_date}まで）\n` : '目標: 未設定\n') +
    `直近7日: 平均摂取${avg(last7.map((d) => d.intake)) ?? '記録なし'}kcal・平均収支${avg(last7.map((d) => d.diff)) ?? '-'}kcal・P平均${avg(last7.map((d) => d.p)) ?? '-'}g・未記録${last7.filter((d) => d.intake == null).length}日\n` +
    `その前3週間: 平均摂取${avg(prev21.map((d) => d.intake)) ?? '記録なし'}kcal・平均収支${avg(prev21.map((d) => d.diff)) ?? '-'}kcal\n` +
    (wDelta != null ? `体重: 28日間で${Number(wDelta) > 0 ? '+' : ''}${wDelta}kg（現在${latestW}kg）\n` : '') +
    `栄養素の推定平均: ${nutLines}\n` +
    `直近7日の日別:\n${dayLines || '（記録なし）'}`;

  const historyBlock = history.length
    ? '\n【これまでの会話】\n' + history.map((h) => `${h.role === 'user' ? '本人' : 'コーチ'}: ${String(h.text).slice(0, 200)}`).join('\n')
    : '';

  const prompt =
    'あなたはBodyLog（減量トラッカー）のパーソナルコーチです。管理栄養士と行動科学コーチの知見で、本人の記録データだけを根拠に質問へ答えます。\n' +
    dataBlock + historyBlock +
    '\n【本人からの相談】\n' + question +
    '\n\n【回答ルール】\n' +
    '- 日本語で3〜6文。データの数値を具体的に引用して仮説を示す（例:「直近7日の平均摂取が前3週間より230kcal少なく、カロリー不足の可能性があります」）\n' +
    '- 「栄養素: データなし」の項目を根拠にしない。データに無いことは「記録からは分かりませんが」と断ってから一般論を短く\n' +
    '- メモに酒・睡眠不足などの手がかりがあれば言及する\n' +
    '- 責めない・寄り添うトーン。最後に今日できる具体的な提案を1つだけ\n' +
    '- 医療的な診断・疾患名の断定はしない。深刻な不調が続く場合は受診を勧める\n' +
    '\n必ず {"answer":"回答本文"} のJSONのみを返す。';

  const r = await callGemini(key, [{ text: prompt }], 0.4);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, detail: r.detail }, { status: r.status });
  let answer = '';
  try {
    const j = parseJsonLoose(r.text) as { answer?: string };
    answer = String(j.answer || '').trim();
  } catch { /* JSON崩れ時は生テキストを使う */ }
  if (!answer) answer = r.text.trim();

  const bumpUsage = async () => {
    try { await supabase.from('ai_usage').upsert({ user_id: user.id, date: today, count: used + 1 }); } catch { /* 無視 */ }
  };
  try { after(bumpUsage); } catch { void bumpUsage(); }

  return NextResponse.json({ ok: true, answer, remaining: unlimited ? null : AI_DAILY_LIMIT - used - 1 });
}
