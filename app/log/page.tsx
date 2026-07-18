'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { EX_LEVELS, EX_ADD, type ExLevel, mifflinBMR, judge, verdictClass, AI_DAILY_LIMIT, isUnlimited, todayJST } from '@/lib/calc';
import { rescaleByQty, sumItems, emptyItem } from '@/lib/items';
import { summarizeDay, dayExerciseKcal, type LogRow } from '@/lib/day';
import { computePlan, type Goal, type PlanEvent } from '@/lib/goal';
import { servingOf } from '@/lib/foods';
import BodyPhotos from '@/components/BodyPhotos';

type ParsedItem = { name: string; qty: string; kcal: number; p: number; f: number; c: number };
type Parsed = {
  items: ParsedItem[];
  total: { kcal: number; p: number; f: number; c: number };
  weight: number | null;
  ex: ExLevel | null;
  adj: number;
  mood: string | null;
  questions?: string[];
};
type MyFood = {
  id: string; name: string; kind: string; unit: string; kcal: number; p: number; f: number; c: number;
  serving_label: string | null; serving_ratio: number | null;
};
type NewPhoto = { blob: Blob; dataUrl: string; base64: string; mime: string };
type Profile = { sex: 'male' | 'female'; height_cm: number; age: number; init_weight: number | null; life_factor: number; display_name: string };

const PLACEHOLDER =
  '1回分の記録を書いて保存 → 1日に何度でも追加できます。例）\n' +
  '昼は牛丼並盛とサラダ。\n' +
  '体重75.2kg。ジムで筋トレ1時間。';

async function resizeImage(file: File): Promise<NewPhoto> {
  const dataUrl: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img: HTMLImageElement = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  const MAX = 1024;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const outUrl = canvas.toDataURL('image/jpeg', 0.82);
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.82));
  return { blob, dataUrl: outUrl, base64: outUrl.split(',')[1], mime: 'image/jpeg' };
}

function timeJST(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export default function LogPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [userName, setUserName] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [unlimited, setUnlimited] = useState(false);
  const [myFoods, setMyFoods] = useState<MyFood[]>([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [futureEvents, setFutureEvents] = useState<(PlanEvent & { id: string })[]>([]);

  const [date, setDate] = useState(todayJST());
  const [chat, setChat] = useState('');
  const [photos, setPhotos] = useState<NewPhoto[]>([]);
  const [dayLogs, setDayLogs] = useState<(LogRow & { id: string; at: string })[]>([]);
  const [legacyEntry, setLegacyEntry] = useState<Record<string, unknown> | null>(null);

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [editingLog, setEditingLog] = useState<(LogRow & { id: string; at: string }) | null>(null); // 保存済み記録の編集中
  const [editMode, setEditMode] = useState(false);
  const [eKcal, setEKcal] = useState(''); const [eP, setEP] = useState(''); const [eF, setEF] = useState(''); const [eC, setEC] = useState('');
  const [eEx, setEEx] = useState<ExLevel>('オフ'); const [eAdj, setEAdj] = useState('0'); const [eWeight, setEWeight] = useState(''); const [eMood, setEMood] = useState('');

  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parseMsg, setParseMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);

  const loadDay = useCallback(async (d: string) => {
    const supabase = createClient();
    setParsed(null); setEditMode(false); setPhotos([]); setChat('');
    setParseMsg(null); setSaveMsg(null); setEditingLog(null);
    const [{ data: logs }, { data: entry }] = await Promise.all([
      supabase.from('logs').select('*').eq('date', d).order('at', { ascending: true }),
      supabase.from('entries').select('*').eq('date', d).maybeSingle(),
    ]);
    setDayLogs((logs as (LogRow & { id: string; at: string })[]) || []);
    // logsが未作成(クエリ失敗)や空でも、その日の旧形式記録があれば表示する
    setLegacyEntry((!logs || logs.length === 0) && entry ? entry : null);
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (!prof) { router.push('/onboarding'); return; }
      setProfile(prof);
      setUserName(prof.display_name || user.email || '');
      const { data: w } = await supabase.from('entries').select('weight,date').not('weight', 'is', null)
        .order('date', { ascending: false }).limit(1);
      if (w && w.length) setLatestWeight(Number(w[0].weight));
      setUnlimited(isUnlimited(user.email));
      const { data: usage } = await supabase.from('ai_usage').select('count').eq('date', todayJST()).maybeSingle();
      setRemaining(AI_DAILY_LIMIT - (usage?.count ?? 0));
      const { data: foods } = await supabase.from('my_foods').select('id,name,kind,unit,kcal,p,f,c,serving_label,serving_ratio')
        .order('created_at', { ascending: true }).limit(30);
      setMyFoods((foods as MyFood[]) || []);
      const [{ data: g }, { data: evs }] = await Promise.all([
        supabase.from('goals').select('*').maybeSingle(),
        supabase.from('events').select('id,date,title,extra_kcal').order('date', { ascending: true }),
      ]);
      if (g) setGoal(g);
      setFutureEvents((evs as (PlanEvent & { id: string })[]) || []);
      await loadDay(todayJST());
    })();
  }, [router, loadDay]);

  // ===== 日次サマリー・目安の内訳（画面上部に常時表示） =====
  // logsが無い日でも旧形式（1日まとめ）の記録があれば集計に含める
  const effectiveLogs: LogRow[] = dayLogs.length > 0 ? dayLogs : (legacyEntry ? [{
    kcal: legacyEntry.intake as number | null,
    p: legacyEntry.p as number | null, f: legacyEntry.f as number | null, c: legacyEntry.c as number | null,
    weight: legacyEntry.weight as number | null,
    ex: (legacyEntry.ex as ExLevel) ?? null, adj: Number(legacyEntry.adj) || 0,
    mood: String(legacyEntry.mood || ''), text: '', photo_urls: [],
  }] : []);
  const summary = summarizeDay(effectiveLogs);
  const weightForBmr = summary.weight ?? latestWeight ?? (profile?.init_weight != null ? Number(profile.init_weight) : 70);
  const bmr = profile ? mifflinBMR(profile.sex, weightForBmr, Number(profile.height_cm), Number(profile.age)) : 0;
  const baseKcal = profile ? Math.round(bmr * Number(profile.life_factor)) : 0;
  const exTotal = Math.round(dayExerciseKcal(effectiveLogs));
  const target = baseKcal + exTotal;
  const eaten = Math.round(summary.intake ?? 0);
  const left = target - eaten;
  const dayVerdict = summary.intake != null ? judge(eaten - target) : null;

  // ===== 減量計画ベースの目標摂取（目標設定時のみ） =====
  const plan = goal && profile ? computePlan(goal, todayJST(), weightForBmr, futureEvents, goal.absorb_days) : null;
  const todayEvent = futureEvents.find((e) => e.date === date) ?? null;
  // 通常日の目標 = 維持カロリー(今日の運動込み) − 必要赤字(チートデイ込み)。基礎代謝は下回らない
  const planIntakeBase = plan ? Math.max(target - plan.requiredDailyWithEvents, Math.round(bmr)) : null;
  const planIntake = planIntakeBase != null && todayEvent ? planIntakeBase + Math.round(Number(todayEvent.extra_kcal)) : planIntakeBase;
  const planLeft = planIntake != null ? planIntake - eaten : null;

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files).slice(0, 4 - photos.length);
    const resized = await Promise.all(list.map(resizeImage));
    setPhotos((p) => [...p, ...resized]);
  }

  async function parse() {
    if (!chat.trim() && photos.length === 0) {
      setParseMsg({ cls: 'err', text: 'メモを書くか写真を追加してください。' });
      return;
    }
    setParsing(true); setParseMsg(null);
    try {
      const res = await fetch('/api/parse-food', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chat, images: photos.map((p) => ({ data: p.base64, mime: p.mime })), lang: localStorage.getItem('bodylog-lang') || 'ja' }),
      });
      const j = await res.json();
      if (typeof j.remaining === 'number') setRemaining(j.remaining);
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setParsed({
        items: j.result.items || [],
        total: j.result.total || { kcal: 0, p: 0, f: 0, c: 0 },
        weight: j.result.weight ?? null,
        ex: EX_LEVELS.includes(j.result.ex) ? j.result.ex : null,
        adj: Number(j.result.adj) || 0,
        mood: j.result.mood ?? null,
        questions: Array.isArray(j.result.questions) ? j.result.questions.filter((q: unknown) => typeof q === 'string') : [],
      });
      setEditMode(false);
      setParseMsg({ cls: 'ok', text: '解析しました。内容を確認して保存してください。' });
    } catch (e) {
      setParseMsg({ cls: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setParsing(false);
    }
  }

  function startEdit() {
    if (!parsed) return;
    setEKcal(String(Math.round(parsed.total.kcal))); setEP(String(Math.round(parsed.total.p)));
    setEF(String(Math.round(parsed.total.f))); setEC(String(Math.round(parsed.total.c)));
    setEEx(parsed.ex ?? 'オフ'); setEAdj(String(parsed.adj)); setEWeight(parsed.weight == null ? '' : String(parsed.weight));
    setEMood(parsed.mood ?? '');
    setEditMode(true);
  }
  function applyEdit() {
    setParsed((p) => {
      const items = p?.items ?? [];
      const total = items.length > 0
        ? sumItems(items)
        : { kcal: Number(eKcal) || 0, p: Number(eP) || 0, f: Number(eF) || 0, c: Number(eC) || 0 };
      return {
        items, total,
        weight: eWeight === '' ? null : Number(eWeight),
        ex: eEx, adj: Number(eAdj) || 0, mood: eMood || null,
        questions: p?.questions ?? [],
      };
    });
    setEditMode(false);
  }

  // ===== 品目ごとの編集（合計は自動再計算） =====
  function setItems(items: ParsedItem[]) {
    setParsed((p) => (p ? { ...p, items, total: sumItems(items) } : p));
  }
  function updateItemNum(i: number, field: 'kcal' | 'p' | 'f' | 'c', v: string) {
    if (!parsed) return;
    setItems(parsed.items.map((it, j) => (j === i ? { ...it, [field]: Number(v) || 0 } : it)));
  }
  function updateItemName(i: number, v: string) {
    if (!parsed) return;
    setItems(parsed.items.map((it, j) => (j === i ? { ...it, name: v } : it)));
  }
  function applyQty(i: number, v: string) {
    if (!parsed) return;
    setItems(parsed.items.map((it, j) => (j === i ? rescaleByQty(it, v) : it)));
  }
  function removeItem(i: number) {
    if (!parsed) return;
    setItems(parsed.items.filter((_, j) => j !== i));
  }
  function addItem() {
    if (!parsed) return;
    setItems([...parsed.items, emptyItem()]);
  }

  // ===== 保存済み記録の編集 =====
  function startEditLog(l: LogRow & { id: string; at: string }) {
    setEditingLog(l);
    setChat(String(l.text || ''));
    setPhotos([]);
    setParsed({
      items: ((l.items as ParsedItem[]) || []),
      total: { kcal: Number(l.kcal) || 0, p: Number(l.p) || 0, f: Number(l.f) || 0, c: Number(l.c) || 0 },
      weight: l.weight == null ? null : Number(l.weight),
      ex: (l.ex as ExLevel) ?? null,
      adj: Number(l.adj) || 0,
      mood: l.mood || null,
      questions: [],
    });
    setEditMode(false); setParseMsg(null);
    setSaveMsg({ cls: 'ok', text: `${timeJST(l.at)}の記録を編集中です。修正して「編集を保存」を押してください。` });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancelEditLog() {
    setEditingLog(null); setParsed(null); setChat(''); setPhotos([]); setSaveMsg(null); setParseMsg(null);
  }

  function addFromFood(fd: MyFood) {
    // よく使う量が設定されていればその量で追加（例: 全量1800kcalの鍋→丼1杯300kcal）
    const sv = servingOf(fd);
    const item: ParsedItem = { name: fd.name, qty: sv.qty, kcal: sv.kcal, p: sv.p, f: sv.f, c: sv.c };
    if (parsed) {
      setItems([...parsed.items, item]);
    } else {
      setParsed({ items: [item], total: sumItems([item]), weight: null, ex: null, adj: 0, mood: null, questions: [] });
    }
  }

  // 日次サマリーをentriesへ反映（ダッシュボードはこの行を見る）
  async function syncDaySummary(userId: string, d: string) {
    const supabase = createClient();
    const { data: logs } = await supabase.from('logs').select('*').eq('date', d).order('at', { ascending: true });
    const rows = (logs as (LogRow & { id: string; at: string })[]) || [];
    if (rows.length === 0) {
      await supabase.from('entries').delete().eq('user_id', userId).eq('date', d);
    } else {
      const s = summarizeDay(rows);
      await supabase.from('entries').upsert({
        user_id: userId, date: d,
        ex: s.ex, adj: s.adj,
        intake: s.intake, p: s.p, f: s.f, c: s.c,
        weight: s.weight, mood: s.mood, note: '',
        food_text: s.food_text.slice(0, 2000), photo_urls: s.photo_urls,
      }, { onConflict: 'user_id,date' });
    }
    setDayLogs(rows);
    return rows;
  }

  async function save() {
    if (!date || !parsed) return;
    setSaving(true); setSaveMsg(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    try {
      // 写真アップロード
      const paths: string[] = [];
      for (const ph of photos) {
        const path = `${user.id}/${date}-${crypto.randomUUID().slice(0, 8)}.jpg`;
        const { error } = await supabase.storage.from('meals').upload(path, ph.blob, { contentType: 'image/jpeg' });
        if (!error) paths.push(path);
      }

      const hasMeal = parsed.items.length > 0 || parsed.total.kcal > 0;
      const newLog: LogRow = {
        items: parsed.items,
        kcal: hasMeal ? parsed.total.kcal : null,
        p: hasMeal ? parsed.total.p : null, f: hasMeal ? parsed.total.f : null, c: hasMeal ? parsed.total.c : null,
        weight: parsed.weight,
        ex: parsed.ex, adj: parsed.adj,
        mood: parsed.mood || '', text: chat,
        photo_urls: paths,
      };

      // ===== 編集モード: 既存の記録を上書き =====
      if (editingLog) {
        const mergedPhotos = [...(editingLog.photo_urls || []), ...paths]; // 既存写真は保持し追加分を合流
        const { error: upErr } = await supabase.from('logs')
          .update({ ...newLog, photo_urls: mergedPhotos })
          .eq('id', editingLog.id);
        if (upErr) throw new Error(upErr.message);
        const rows2 = await syncDaySummary(user.id, date);
        const s2 = summarizeDay(rows2);
        if (s2.weight != null) setLatestWeight(s2.weight);
        setSaveMsg({ cls: 'ok', text: `${timeJST(editingLog.at)}の記録を更新しました（1日の合計・ダッシュボードにも反映済み）。` });
        setEditingLog(null);
        setChat(''); setPhotos([]); setParsed(null); setEditMode(false); setParseMsg(null);
        return;
      }

      const { error } = await supabase.from('logs').insert({ user_id: user.id, date, ...newLog });

      if (error && /schema cache|does not exist/i.test(error.message)) {
        // フォールバック: logsテーブル未作成の環境では旧方式（日次まとめ）に直接合算
        const prior: LogRow[] = legacyEntry ? [{
          kcal: legacyEntry.intake as number | null,
          p: legacyEntry.p as number | null, f: legacyEntry.f as number | null, c: legacyEntry.c as number | null,
          weight: legacyEntry.weight as number | null,
          ex: (legacyEntry.ex as ExLevel) ?? null, adj: Number(legacyEntry.adj) || 0,
          mood: String(legacyEntry.mood || ''), text: String(legacyEntry.food_text || ''),
          photo_urls: (legacyEntry.photo_urls as string[]) || [],
        }] : [];
        const s = summarizeDay([...prior, newLog]);
        const { error: e2 } = await supabase.from('entries').upsert({
          user_id: user.id, date,
          ex: s.ex, adj: s.adj,
          intake: s.intake, p: s.p, f: s.f, c: s.c,
          weight: s.weight, mood: s.mood, note: '',
          food_text: s.food_text.slice(0, 2000), photo_urls: s.photo_urls,
        }, { onConflict: 'user_id,date' });
        if (e2) throw new Error(e2.message);
        const { data: entry } = await supabase.from('entries').select('*').eq('date', date).maybeSingle();
        setLegacyEntry(entry);
        setDayLogs([]);
        if (s.weight != null) setLatestWeight(s.weight);
        setSaveMsg({ cls: 'ok', text: `保存しました（この日のまとめに合算）。摂取合計 ${s.intake != null ? Math.round(s.intake).toLocaleString() : '—'}kcal` });
        setChat(''); setPhotos([]); setParsed(null); setEditMode(false); setParseMsg(null);
        return;
      }
      if (error) throw new Error(error.message);

      // 旧形式（1日まとめ）の記録が残る日に初めて追記した場合、まとめ分もフィードに移行
      if (legacyEntry && dayLogs.length === 0) {
        await supabase.from('logs').insert({
          user_id: user.id, date, at: `${date}T03:00:00+09:00`,
          items: [], kcal: legacyEntry.intake, p: legacyEntry.p, f: legacyEntry.f, c: legacyEntry.c,
          weight: legacyEntry.weight, ex: legacyEntry.ex, adj: legacyEntry.adj,
          mood: String(legacyEntry.mood || ''), text: `（旧形式から移行）${String(legacyEntry.food_text || '').slice(0, 500)}`,
          photo_urls: legacyEntry.photo_urls || [],
        });
        setLegacyEntry(null);
      }

      const rows = await syncDaySummary(user.id, date);
      const s = summarizeDay(rows);
      const w = s.weight ?? latestWeight ?? (profile?.init_weight != null ? Number(profile.init_weight) : 70);
      if (s.weight != null) setLatestWeight(s.weight);
      const b = profile ? mifflinBMR(profile.sex, w, Number(profile.height_cm), Number(profile.age)) : 0;
      const t = Math.round(b * Number(profile?.life_factor ?? 1.3)) + Math.round(dayExerciseKcal(rows));
      if (s.intake != null) {
        const diff = Math.round(s.intake - t);
        setSaveMsg({ cls: 'ok', text: `保存しました。ここまでの摂取 ${Math.round(s.intake).toLocaleString()} / 目安 ${t.toLocaleString()} / 差 ${diff > 0 ? '+' : ''}${diff.toLocaleString()}（${judge(diff)}）` });
      } else {
        setSaveMsg({ cls: 'ok', text: '保存しました。' });
      }
      // 入力欄をクリア（フィードに積まれる）
      setChat(''); setPhotos([]); setParsed(null); setEditMode(false); setParseMsg(null);
    } catch (e) {
      setSaveMsg({ cls: 'err', text: '保存失敗: ' + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setSaving(false);
    }
  }

  async function deleteLog(log: LogRow & { id: string }) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (log.photo_urls && log.photo_urls.length) {
      await supabase.storage.from('meals').remove(log.photo_urls);
    }
    await supabase.from('logs').delete().eq('id', log.id);
    await syncDaySummary(user.id, date);
    setSaveMsg({ cls: 'ok', text: '1件削除しました（合計は再計算済み）。' });
  }

  const remainLabel = unlimited ? '' : remaining == null ? '' : `（今日あと${Math.max(0, remaining)}回）`;

  function logSummaryText(l: LogRow): string {
    const parts: string[] = [];
    const items = (l.items as ParsedItem[]) || [];
    if (l.kcal != null) {
      const names = items.slice(0, 3).map((it) => it.name).filter(Boolean).join('、');
      parts.push(`🍽 ${names || '食事'}${items.length > 3 ? ' ほか' : ''} ${Math.round(Number(l.kcal)).toLocaleString()}kcal`);
    }
    if (l.ex && l.ex !== 'オフ') parts.push(`🏃 ${l.ex}(+${EX_ADD[l.ex as ExLevel] + (Number(l.adj) || 0)})`);
    else if (Number(l.adj)) parts.push(`🏃 補正${Number(l.adj) > 0 ? '+' : ''}${l.adj}`);
    if (l.weight != null) parts.push(`⚖ ${Number(l.weight).toFixed(1)}kg`);
    if (l.mood) parts.push(`😊 ${l.mood}`);
    if (parts.length === 0) parts.push(String(l.text || '').slice(0, 30) || '記録');
    return parts.join('　');
  }

  return (
    <AppShell userName={userName}>
      {/* ===== 今日あと食べられるkcal（ヒーロー表示） ===== */}
      {profile && (() => {
        const heroLeft = planLeft ?? left; // 計画があれば計画基準、なければ維持基準
        return (
          <div className="card daybar">
            <div className="hero-label">
              今日あと食べられる{plan ? '（計画）' : '（維持）'}
              {dayVerdict && <span className={`pill ${verdictClass(dayVerdict)}`} style={{ marginLeft: 8 }}>{dayVerdict}</span>}
            </div>
            <div className="hero-row">
              <span className={`hero-num num ${heroLeft < 0 ? 'over' : ''}`}>{heroLeft.toLocaleString()}</span>
              <span className="hero-unit">kcal</span>
            </div>
            {todayEvent && (
              <div className="hero-cheat">🍺 今日はチートデイ「{todayEvent.title}」— +{Math.round(Number(todayEvent.extra_kcal)).toLocaleString()}kcalまで想定内</div>
            )}
            <div className="daybar-sub">
              <span>摂取済み <b className="num">{eaten.toLocaleString()}</b></span>
              {plan && <span>維持まで <b className="num">{left.toLocaleString()}</b></span>}
              <span>目安 <b className="num">{target.toLocaleString()}</b></span>
              {planIntake != null && <span>計画目標 <b className="num">{planIntake.toLocaleString()}</b></span>}
            </div>
            <div className="daybar-fine">
              基礎代謝{Math.round(bmr).toLocaleString()}×{Number(profile.life_factor)}＋運動{exTotal.toLocaleString()}＝目安{target.toLocaleString()}
              {plan && ` ／ 必要赤字${plan.requiredDailyWithEvents.toLocaleString()}/日`}
              {plan && plan.mode === 'spread' && plan.absorbToday > 0 &&
                `（🍺+${plan.eventsExtra.toLocaleString()}を残り${plan.remainingDays}日で吸収 +${plan.absorbToday}/日）`}
              {plan && plan.mode === 'window' && plan.absorbToday > 0 &&
                `（🍺取り返し中 +${plan.absorbToday}/日・後${plan.absorbDays}日方式）`}
            </div>
          </div>
        );
      })()}

      {/* ===== 入力① 文字・写真からAIで解析するフロー ===== */}
      <div className="card">
        <label>日付</label>
        <input type="date" value={date} onChange={(e) => { setDate(e.target.value); loadDay(e.target.value); }} />

        <label>✍️ 記録を書いてAIで解析（食事・体重・運動・気分を自由に）</label>
        <textarea rows={4} value={chat} onChange={(e) => setChat(e.target.value)} placeholder={PLACEHOLDER} />

        <input ref={fileRef} type="file" accept="image/*" multiple hidden
               onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
        <div className="photo-row">
          {photos.map((p, i) => (
            <div className="thumb" key={i}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.dataUrl} alt="" />
              <button className="thumb-x" onClick={() => setPhotos((arr) => arr.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          {photos.length < 4 && (
            <button className="thumb-add" onClick={() => fileRef.current?.click()}>📷<br />写真追加</button>
          )}
        </div>

        <button className="btn-primary" style={{ marginTop: 10 }} onClick={parse} disabled={parsing || (!unlimited && remaining === 0)}>
          {parsing ? <><span className="spin" />解析中…</> : `🤖 AIで解析 ${remainLabel}`}
        </button>
        {!unlimited && remaining != null && remaining <= 3 && remaining > 0 && (
          <p className="muted center" style={{ marginTop: 6 }}>無料AI枠のため1日{AI_DAILY_LIMIT}回までです。残りわずか！</p>
        )}
        {!unlimited && remaining === 0 && (
          <p className="muted center" style={{ marginTop: 6 }}>本日のAI解析（{AI_DAILY_LIMIT}回）を使い切りました。明日リセットされます。</p>
        )}
        {parseMsg && <div className={`msg ${parseMsg.cls}`}>{parseMsg.text}</div>}
      </div>

      {/* ===== 入力② マイ食品をタップで追加するフロー（AI不要・別フロー） ===== */}
      {myFoods.length > 0 && (
        <div className="card">
          <h2>⚡ よく使う品目をタップで追加 <span className="muted" style={{ fontWeight: 400 }}>— AI不要・即時</span></h2>
          <div className="chips">
            {myFoods.map((fd) => (
              <button key={fd.id} className="chip" onClick={() => addFromFood(fd)}>
                ＋ {fd.name}
              </button>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 8 }}>タップすると下の確認画面に品目が入ります。分量（×0.5 等）はそこで調整→保存。</p>
        </div>
      )}

      {/* ===== 解析結果（保存前の確認） ===== */}
      {parsed && (
        <div className="card" style={editingLog ? { borderColor: 'var(--teal)' } : undefined}>
          <h2>
            {editingLog ? <>✎ 記録を編集中 <span className="muted" style={{ fontWeight: 400 }}>— {timeJST(editingLog.at)}の記録</span></> : <>解析結果 <span className="muted" style={{ fontWeight: 400 }}>— 確認して保存</span></>}
            {editingLog && (
              <a href="#" className="muted" style={{ float: 'right', fontWeight: 400, fontSize: 12 }}
                 onClick={(e) => { e.preventDefault(); cancelEditLog(); }}>キャンセル</a>
            )}
          </h2>

          {parsed.questions && parsed.questions.length > 0 && (
            <div className="msg warn" style={{ marginTop: 0, marginBottom: 10 }}>
              {parsed.questions.map((q, i) => <div key={i}>❓ {q}</div>)}
              <div className="muted" style={{ fontWeight: 400, marginTop: 4 }}>
                → チャット欄に分量を追記して再解析するか、「よく使う品目」から追加して分量を直してください
              </div>
            </div>
          )}

          {parsed.items.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <p className="muted" style={{ margin: '0 0 6px' }}>品目はタップで直接修正できます（分量を変えるとkcal/PFCも自動で再計算）</p>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr><th>品目</th><th>分量</th><th>kcal</th><th>P</th><th>F</th><th>C</th><th></th></tr></thead>
                  <tbody>
                    {parsed.items.map((it, i) => (
                      <tr key={`${i}-${parsed.items.length}`}>
                        <td><input className="item-input name-cell" defaultValue={it.name}
                                   onBlur={(e) => updateItemName(i, e.target.value)} /></td>
                        <td><input className="item-input qty-cell" defaultValue={it.qty} placeholder="50g"
                                   onBlur={(e) => applyQty(i, e.target.value)} /></td>
                        <td><input className="item-input num-cell num" type="number" inputMode="decimal"
                                   value={it.kcal} onChange={(e) => updateItemNum(i, 'kcal', e.target.value)} /></td>
                        <td><input className="item-input num-cell num" type="number" inputMode="decimal"
                                   value={it.p} onChange={(e) => updateItemNum(i, 'p', e.target.value)} /></td>
                        <td><input className="item-input num-cell num" type="number" inputMode="decimal"
                                   value={it.f} onChange={(e) => updateItemNum(i, 'f', e.target.value)} /></td>
                        <td><input className="item-input num-cell num" type="number" inputMode="decimal"
                                   value={it.c} onChange={(e) => updateItemNum(i, 'c', e.target.value)} /></td>
                        <td><button className="item-del" onClick={() => removeItem(i)} title="この品目を削除">×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn-ghost" style={{ marginTop: 8 }} onClick={addItem}>＋ 品目を追加</button>
            </div>
          )}

          {!editMode ? (
            <>
              <div className="stat-grid">
                <div className="stat"><div className="stat-l">この記録の摂取</div><div className="stat-v num">{Math.round(parsed.total.kcal).toLocaleString()}<small> kcal</small></div></div>
                <div className="stat"><div className="stat-l">P / F / C</div><div className="stat-v num">{Math.round(parsed.total.p)} / {Math.round(parsed.total.f)} / {Math.round(parsed.total.c)}<small> g</small></div></div>
                <div className="stat"><div className="stat-l">体重</div><div className="stat-v num">{parsed.weight != null ? parsed.weight.toFixed(1) : '—'}<small> kg</small></div></div>
                <div className="stat"><div className="stat-l">運動</div><div className="stat-v">{parsed.ex ?? '—'}{parsed.ex && parsed.ex !== 'オフ' ? ` (+${EX_ADD[parsed.ex] + parsed.adj})` : parsed.adj ? ` (補正${parsed.adj})` : ''}</div></div>
              </div>
              {parsed.mood && <p className="muted">気分: {parsed.mood}</p>}
              <p className="center" style={{ margin: '8px 0 0' }}>
                <a href="#" className="muted" onClick={(e) => { e.preventDefault(); startEdit(); }}>✎ 数値がズレていたら手直しする</a>
              </p>
            </>
          ) : (
            <>
              {parsed.items.length > 0 ? (
                <>
                  <p className="muted">摂取kcal・PFCは上の品目表から自動計算されます（品目を直接修正してください）</p>
                  <label>体重(kg)</label>
                  <input type="number" step="0.1" className="num" value={eWeight} onChange={(e) => setEWeight(e.target.value)} />
                </>
              ) : (
                <>
                  <div className="row2">
                    <div><label>摂取kcal</label><input type="number" className="num" value={eKcal} onChange={(e) => setEKcal(e.target.value)} /></div>
                    <div><label>体重(kg)</label><input type="number" step="0.1" className="num" value={eWeight} onChange={(e) => setEWeight(e.target.value)} /></div>
                  </div>
                  <div className="row3">
                    <div><label>P</label><input type="number" className="num" value={eP} onChange={(e) => setEP(e.target.value)} /></div>
                    <div><label>F</label><input type="number" className="num" value={eF} onChange={(e) => setEF(e.target.value)} /></div>
                    <div><label>C</label><input type="number" className="num" value={eC} onChange={(e) => setEC(e.target.value)} /></div>
                  </div>
                </>
              )}
              <div className="row2">
                <div>
                  <label>運動量（この記録の分）</label>
                  <select value={eEx} onChange={(e) => setEEx(e.target.value as ExLevel)}>
                    {EX_LEVELS.map((l) => <option key={l} value={l}>{l}{EX_ADD[l] ? `（+${EX_ADD[l]}）` : ''}</option>)}
                  </select>
                </div>
                <div><label>補正kcal</label><input type="number" className="num" value={eAdj} onChange={(e) => setEAdj(e.target.value)} /></div>
              </div>
              <label>気分</label><input value={eMood} onChange={(e) => setEMood(e.target.value)} />
              <button className="btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={applyEdit}>手直しを反映</button>
            </>
          )}

          <button className="btn-primary" style={{ marginTop: 14 }} onClick={save} disabled={saving}>
            {saving ? <><span className="spin" />保存中…</> : editingLog ? '編集を保存する（上書き）' : 'この内容で保存する'}
          </button>
        </div>
      )}

      {saveMsg && <div className={`msg ${saveMsg.cls}`}>{saveMsg.text}</div>}

      {/* ===== この日の記録フィード ===== */}
      <div className="card">
        <h2>{date === todayJST() ? '今日' : date} の記録 <span className="muted" style={{ fontWeight: 400 }}>{dayLogs.length + (legacyEntry ? 1 : 0)}件</span></h2>
        {legacyEntry && (
          <div className="feed-row">
            <div className="feed-time num">まとめ</div>
            <div className="feed-body">
              <div>
                {legacyEntry.intake != null ? `🍽 ${Math.round(Number(legacyEntry.intake)).toLocaleString()}kcal　` : ''}
                {legacyEntry.ex && legacyEntry.ex !== 'オフ' ? `🏃 ${String(legacyEntry.ex)}　` : ''}
                {legacyEntry.weight != null ? `⚖ ${Number(legacyEntry.weight).toFixed(1)}kg　` : ''}
                {legacyEntry.mood ? `😊 ${String(legacyEntry.mood)}` : ''}
              </div>
              <div className="muted feed-text">この日の1日まとめ記録（新しく追記すると自動でフィード形式に移行されます）</div>
            </div>
          </div>
        )}
        {dayLogs.length === 0 && !legacyEntry && (
          <p className="muted">まだ記録がありません。上から1回分ずつ記録していきましょう。</p>
        )}
        {dayLogs.map((l) => (
          <div className="feed-row" key={l.id}>
            <div className="feed-time num">{timeJST(l.at)}</div>
            <div className="feed-body">
              <div>{logSummaryText(l)}</div>
              {l.text ? <div className="muted feed-text">{String(l.text).slice(0, 80)}</div> : null}
            </div>
            <button className="item-edit" onClick={() => startEditLog(l)} title="この記録を編集">✎</button>
            <button className="item-del" onClick={() => deleteLog(l)} title="この記録を削除">×</button>
          </div>
        ))}
      </div>

      {/* ===== 体写真（日々の入力はこのタブに統一） ===== */}
      <BodyPhotos profile={profile} latestWeight={latestWeight}
                  goalNote={goal?.note ?? null} targetBf={goal?.target_bf ?? null} />
    </AppShell>
  );
}
