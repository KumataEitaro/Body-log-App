import { NextResponse, after } from 'next/server';
import { findLang } from '@/lib/langs';
import { getApiAuth } from '@/lib/supabase/apiAuth';
import { AI_DAILY_LIMIT, isUnlimited, todayJST, mifflinBMR, EX_ADD, type ExLevel } from '@/lib/calc';
import { isPremiumActive } from '@/lib/premium';
import { globalCapReached } from '@/lib/globalUsage';
import { callGemini, parseJsonLoose } from '@/lib/gemini';
import { buildCoachPrompt, COACH_ACTION_KINDS } from '@/lib/coachPrompt';
import { NUTRIENT_KEYS, type FoodItem } from '@/lib/items';
import { computePlan, macroTargets, type Goal, type PlanEvent } from '@/lib/goal';
import { PURPOSE_PRESETS } from '@/lib/purpose';

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
  const [{ supabase, user }, bodyRaw] = await Promise.all([
    getApiAuth(req),
    req.json().catch(() => null),
  ]);
  if (!user) return NextResponse.json({ ok: false, code: 'unauthorized', error: 'ログインが必要です。' }, { status: 401 });
  if (!bodyRaw) return NextResponse.json({ ok: false, error: '不正なリクエストです。' }, { status: 400 });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'サーバーにAI用のAPIキーが未設定です。' }, { status: 500 });

  const question = String(bodyRaw.question ?? '').slice(0, 500).trim();
  // 回答言語（未指定・日本語なら従来どおり日本語で返す）
  const lang = findLang(String((bodyRaw as { lang?: unknown }).lang || ''));
  const answerLang = lang && lang.code !== 'ja' ? `${lang.name}（${lang.native}）` : '';
  if (!question) return NextResponse.json({ ok: false, code: 'empty_question', error: '質問を入力してください。' }, { status: 400 });
  const history: { role: string; text: string }[] = Array.isArray(bodyRaw.history) ? bodyRaw.history.slice(-6) : [];
  // 睡眠はHealthKit＝端末でしか読めないため、クライアントが取得して添えてくる
  const sleep: { date: string; min: number }[] = Array.isArray(bodyRaw.sleep)
    ? bodyRaw.sleep.filter((s: { date?: unknown; min?: unknown }) => typeof s?.date === 'string' && typeof s?.min === 'number' && s.min > 0).slice(0, 7)
    : [];

  // 使用回数（食事AI解析と同じ日次上限を共有）
  const today = todayJST();
  const [usageRes, capReached, premRes] = await Promise.all([
    supabase.from('ai_usage').select('count').eq('user_id', user.id).eq('date', today).maybeSingle(),
    globalCapReached(),
    supabase.from('profiles').select('premium_until').eq('id', user.id).maybeSingle(),
  ]);
  const unlimited = isUnlimited(user.email) || isPremiumActive(premRes.data?.premium_until as string | null | undefined);
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
  const [entriesRes, logsRes, goalRes, profRes, evRes, foodsRes] = await Promise.all([
    supabase.from('entries').select('date,intake,p,f,c,weight,mood,ex,adj,food_text').gte('date', from28).lte('date', today).order('date', { ascending: true }),
    supabase.from('logs').select('date,items,text,mood').gte('date', from7).order('at', { ascending: true }),
    supabase.from('goals').select('*').maybeSingle(),
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('events').select('id,date,title,extra_kcal').gte('date', today).order('date', { ascending: true }),
    supabase.from('foods').select('name,unit,kcal,p,f,c').limit(24),
  ]);
  const entries = entriesRes.data || [];
  const logRows = logsRes.data || [];
  const prof = profRes.data;
  if (!prof) return NextResponse.json({ ok: false, code: 'no_profile', error: 'プロフィールが見つかりません。' }, { status: 400 });

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

  // ===== 今日のいま（残りkcal・残りPFC・食べたもの） =====
  // アプリのヒーローと同じ式で計算する（維持カロリー＋運動 − 計画の必要赤字）。
  // 「次に何を食べるか」の相談は、この残量が根拠のすべてになる。
  const goalRow = (goalRes.data ?? null) as (Goal & { protein_per_kg?: number | null; fat_per_kg?: number | null; fat_max_g?: number | null; absorb_days?: number | null }) | null;
  const todayEntry = entries.find((e) => String(e.date) === today) ?? null;
  const exAdd = (EX_ADD[(todayEntry?.ex as ExLevel) || 'オフ'] ?? 0) + (Number(todayEntry?.adj) || 0);
  const targetToday = base + exAdd;
  const planEvents = (evRes.data ?? []) as PlanEvent[];
  const plan = goalRow ? computePlan(goalRow, today, latestW, planEvents, goalRow.absorb_days) : null;
  const planBase = plan ? Math.max(targetToday - plan.requiredDailyWithEvents, Math.round(bmr)) : null;
  const todayEvent = planEvents.find((e) => String(e.date) === today) ?? null;
  const goalKcalToday = planBase != null
    ? planBase + (todayEvent ? Math.round(Number(todayEvent.extra_kcal)) : 0)
    : targetToday;
  // 目的（オンボーディングで選択）。係数が未設定の間は目的の既定値を使う
  const purpose = PURPOSE_PRESETS[String((prof as { purpose?: string | null }).purpose ?? '')] ?? null;
  const m = macroTargets(latestW, goalKcalToday,
    goalRow?.protein_per_kg ?? purpose?.p, goalRow?.fat_per_kg ?? purpose?.f, goalRow?.fat_max_g);
  const eatenK = Math.round(Number(todayEntry?.intake) || 0);
  const eatenP = Math.round(Number(todayEntry?.p) || 0);
  const eatenF = Math.round(Number(todayEntry?.f) || 0);
  const eatenC = Math.round(Number(todayEntry?.c) || 0);
  const eatenNames = logRows
    .filter((r) => String(r.date) === today)
    .flatMap((r) => ((r.items as FoodItem[]) || []).map((it) => `${it.name}${it.qty && it.qty !== '×1' ? it.qty : ''}`))
    .slice(0, 24);
  const jstHour = new Date(Date.now() + 9 * 3600_000).getUTCHours();
  const myFoods = (foodsRes.data ?? []) as { name: string; unit: string; kcal: number; p: number; f: number; c: number }[];
  const todayBlock =
    `【今日のいま（${jstHour}時時点）】\n` +
    `今日の目標: ${goalKcalToday}kcal${plan ? '（計画）' : '（維持）'} / 摂取済み: ${eatenK}kcal → 残り ${goalKcalToday - eatenK}kcal\n` +
    `残りPFC: P あと${Math.round(m.p) - eatenP}g / F あと${Math.round(m.f) - eatenF}g / C あと${Math.round(m.c) - eatenC}g\n` +
    `今日食べたもの: ${eatenNames.length ? eatenNames.join('、') : 'まだ記録なし'}\n` +
    (myFoods.length
      ? `本人のマイ食品（よく食べる定番）: ${myFoods.map((f) => `${f.name}(${f.unit} ${Math.round(f.kcal)}kcal P${Math.round(f.p)})`).join(' / ')}\n`
      : '');

  const dayLines = days.slice(-7).map((d) =>
    `${d.date.slice(5)}: 摂取${d.intake ?? '未記録'}${d.diff != null ? `(収支${d.diff > 0 ? '+' : ''}${d.diff})` : ''} P${d.p ?? '-'}g ${d.mood ? `気分:${d.mood} ` : ''}${d.memo ? `メモ:${d.memo}` : ''}`
  ).join('\n');

  const dataBlock =
    todayBlock + '\n' +
    `【本人データ（直近28日・今日=${today}）】\n` +
    `維持カロリー目安: ${base}kcal/日（基礎代謝${Math.round(bmr)}）\n` +
    (goalRes.data ? `目標: ${goalRes.data.target_weight}kgまで（${goalRes.data.target_date}まで）\n` : '目標: 未設定\n') +
    (purpose ? `本人の目的: ${purpose.label}\n` : '') +
    `直近7日: 平均摂取${avg(last7.map((d) => d.intake)) ?? '記録なし'}kcal・平均収支${avg(last7.map((d) => d.diff)) ?? '-'}kcal・P平均${avg(last7.map((d) => d.p)) ?? '-'}g・未記録${last7.filter((d) => d.intake == null).length}日\n` +
    `その前3週間: 平均摂取${avg(prev21.map((d) => d.intake)) ?? '記録なし'}kcal・平均収支${avg(prev21.map((d) => d.diff)) ?? '-'}kcal\n` +
    (wDelta != null ? `体重: 28日間で${Number(wDelta) > 0 ? '+' : ''}${wDelta}kg（現在${latestW}kg）\n` : '') +
    `栄養素の推定平均: ${nutLines}\n` +
    (sleep.length > 0
      ? `睡眠(ヘルスケア実測): ${sleep.map((s) => `${s.date.slice(5)}=${Math.round(s.min / 6) / 10}h`).join(' ')}（平均${Math.round(sleep.reduce((a, s) => a + s.min, 0) / sleep.length / 6) / 10}h）\n`
      : '睡眠: データなし\n') +
    `直近7日の日別:\n${dayLines || '（記録なし）'}`;

  const historyBlock = history.length
    ? '\n【これまでの会話】\n' + history.map((h) => `${h.role === 'user' ? '本人' : 'コーチ'}: ${String(h.text).slice(0, 200)}`).join('\n')
    : '';

  const prompt = buildCoachPrompt({ dataBlock, historyBlock, question, answerLang });

  const r = await callGemini(key, [{ text: prompt }], 0.4);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, detail: r.detail }, { status: r.status });
  let answer = '';
  let action: Record<string, unknown> | null = null;
  try {
    const j = parseJsonLoose(r.text) as { answer?: string; action?: Record<string, unknown> };
    answer = String(j.answer || '').trim();
    // actionは想定kindのみ通す（プロンプトインジェクション等での任意データ書込を防ぐ）
    if (j.action && typeof j.action === 'object' && (COACH_ACTION_KINDS as readonly string[]).includes(String(j.action.kind))) {
      action = j.action;
    }
  } catch { /* JSON崩れ時は生テキストを使う */ }
  if (!answer) answer = r.text.trim();

  const bumpUsage = async () => {
    try { await supabase.from('ai_usage').upsert({ user_id: user.id, date: today, count: used + 1 }); } catch { /* 無視 */ }
  };
  try { after(bumpUsage); } catch { void bumpUsage(); }

  return NextResponse.json({ ok: true, answer, action, remaining: unlimited ? null : AI_DAILY_LIMIT - used - 1 });
}
