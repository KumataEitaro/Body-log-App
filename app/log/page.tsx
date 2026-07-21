'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { EX_LEVELS, EX_ADD, type ExLevel, mifflinBMR, judge, verdictClass, AI_DAILY_LIMIT, isUnlimited, todayJST } from '@/lib/calc';
import { rescaleByQty, sumItems, emptyItem } from '@/lib/items';
import { summarizeDay, dayExerciseKcal, type LogRow } from '@/lib/day';
import { computePlan, macroTargets, type Goal, type PlanEvent } from '@/lib/goal';
import { servingOf } from '@/lib/foods';
import BodyPhotos from '@/components/BodyPhotos';
import { hapticSuccess, hapticTap, pickPhotoNative, isNativeCameraAvailable, setTodayRecordedBadge } from '@/lib/native';
import { cacheGet, cacheSet } from '@/lib/cache';
import { getQueue, enqueueLog, removeFromQueue } from '@/lib/offlineQueue';
import Sheet from '@/components/Sheet';
import { detectStruggle, type StruggleKind } from '@/lib/adaptive';

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

function shiftDate(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, '0'), dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
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
  const [sheetOpen, setSheetOpen] = useState(false); // 解析結果ボトムシートの開閉
  const [editingLog, setEditingLog] = useState<(LogRow & { id: string; at: string }) | null>(null); // 保存済み記録の編集中
  const [editMode, setEditMode] = useState(false);
  const [eKcal, setEKcal] = useState(''); const [eP, setEP] = useState(''); const [eF, setEF] = useState(''); const [eC, setEC] = useState('');
  const [eEx, setEEx] = useState<ExLevel>('オフ'); const [eAdj, setEAdj] = useState('0'); const [eWeight, setEWeight] = useState(''); const [eMood, setEMood] = useState('');

  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parseMsg, setParseMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);

  // キューに残っている未同期記録を、その日のフィードに合流させる
  const withPending = useCallback((uid: string | undefined, d: string, rows: (LogRow & { id: string; at: string })[]) => {
    if (!uid) return rows;
    const pend = getQueue(uid).filter((q) => q.date === d)
      .map((q) => ({ ...q.log, id: q.localId, at: new Date(q.ts).toISOString() } as LogRow & { id: string; at: string }));
    return [...rows, ...pend];
  }, []);

  const loadDay = useCallback(async (d: string) => {
    const supabase = createClient();
    setParsed(null); setEditMode(false); setPhotos([]); setChat('');
    setParseMsg(null); setSaveMsg(null); setEditingLog(null); setSheetOpen(false);

    // ① まずキャッシュを即表示（オフライン・低速回線でも前回の状態が見える）
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (uid) {
      const cached = cacheGet<{ logs: (LogRow & { id: string; at: string })[]; entry: Record<string, unknown> | null }>(`logs:${uid}:${d}`);
      if (cached) {
        setDayLogs(withPending(uid, d, cached.logs || []));
        setLegacyEntry(cached.entry ?? null);
      }
    }

    // ② 裏で最新を取得して差し替え＋キャッシュ更新
    const [logsRes, entryRes] = await Promise.all([
      supabase.from('logs').select('*').eq('date', d).order('at', { ascending: true }),
      supabase.from('entries').select('*').eq('date', d).maybeSingle(),
    ]);
    // 通信不能（オフライン等）の失敗ならキャッシュ表示を維持して終了
    if (logsRes.data === null && (!navigator.onLine || /fetch|network/i.test(String(logsRes.error?.message || '')))) return;
    const logs = logsRes.data; const entry = entryRes.data;
    const rows = (logs as (LogRow & { id: string; at: string })[]) || [];
    const legacy = (!logs || logs.length === 0) && entry ? entry : null;
    setDayLogs(withPending(uid, d, rows));
    setLegacyEntry(legacy);
    if (uid && logs !== null) cacheSet(`logs:${uid}:${d}`, { logs: rows, entry: legacy });
  }, [withPending]);

  useEffect(() => {
    (async () => {
      const supabase = createClient();

      // ① キャッシュを即表示（プロフィール・チップ・目標など）
      const { data: { session } } = await supabase.auth.getSession();
      const cachedUid = session?.user?.id;
      if (cachedUid) {
        const h = cacheGet<{
          profile: Profile; userName: string; latestWeight: number | null;
          remaining: number | null; unlimited: boolean; myFoods: MyFood[];
          goal: Goal | null; futureEvents: (PlanEvent & { id: string })[];
        }>(`loghdr:${cachedUid}`);
        if (h) {
          setProfile(h.profile); setUserName(h.userName); setLatestWeight(h.latestWeight);
          setRemaining(h.remaining); setUnlimited(h.unlimited); setMyFoods(h.myFoods || []);
          setGoal(h.goal); setFutureEvents(h.futureEvents || []);
        }
        loadDay(todayJST()); // キャッシュ分を即描画（待たずに次へ）
        flushOffline();      // 未同期の記録があれば送信
      }

      // ② 裏で最新を取得
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!navigator.onLine && cachedUid) return; // オフラインはキャッシュ表示のまま
        router.push('/login'); return;
      }
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (!prof) { if (!navigator.onLine) return; router.push('/onboarding'); return; }
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
      // 次回起動を即表示にするためのヘッダキャッシュ
      cacheSet(`loghdr:${user.id}`, {
        profile: prof,
        userName: prof.display_name || user.email || '',
        latestWeight: w && w.length ? Number(w[0].weight) : null,
        remaining: AI_DAILY_LIMIT - (usage?.count ?? 0),
        unlimited: isUnlimited(user.email),
        myFoods: (foods as MyFood[]) || [],
        goal: g ?? null,
        futureEvents: (evs as (PlanEvent & { id: string })[]) || [],
      });
      if (!cachedUid) flushOffline();
      await loadDay(todayJST());
    })();
  }, [router, loadDay]);

  // 通信回復時に未同期の記録を自動送信
  const dateRef = useRef(date);
  useEffect(() => { dateRef.current = date; }, [date]);
  useEffect(() => {
    const onOnline = () => { flushOffline(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ネイティブアプリ: 今日未記録ならアイコンにバッジを付ける
  useEffect(() => {
    if (date === todayJST()) {
      setTodayRecordedBadge(dayLogs.length > 0 || !!legacyEntry);
    }
  }, [dayLogs, legacyEntry, date]);

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

  // 今日の目標PFCと残り（計画目標カロリー基準。目標未設定なら維持カロリー基準）
  const macroBase = planIntake ?? target;
  const macros = profile ? macroTargets(weightForBmr, macroBase, goal?.protein_per_kg, goal?.fat_per_kg, goal?.fat_max_g) : null;
  const eatenP = Math.round(summary.p ?? 0);
  const eatenF = Math.round(summary.f ?? 0);
  const eatenC = Math.round(summary.c ?? 0);

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
      setSheetOpen(true); // 結果はボトムシートで確認
      setParseMsg(null);
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
    setEditMode(false); setParseMsg(null); setSaveMsg(null);
    setSheetOpen(true); // 編集内容をシートで開く
  }
  function cancelEditLog() {
    setEditingLog(null); setParsed(null); setChat(''); setPhotos([]); setSaveMsg(null); setParseMsg(null);
    setSheetOpen(false);
  }

  function addFromFood(fd: MyFood) {
    hapticTap();
    // よく使う量が設定されていればその量で追加（例: 全量1800kcalの鍋→丼1杯300kcal）
    const sv = servingOf(fd);
    const item: ParsedItem = { name: fd.name, qty: sv.qty, kcal: sv.kcal, p: sv.p, f: sv.f, c: sv.c };
    if (parsed) {
      setItems([...parsed.items, item]);
    } else {
      setParsed({ items: [item], total: sumItems([item]), weight: null, ex: null, adj: 0, mood: null, questions: [] });
    }
    setSheetOpen(true); // 追加内容をシートで確認
  }

  // 日次サマリーをentriesへ反映（ダッシュボードはこの行を見る）
  async function syncDaySummary(userId: string, d: string, updateState = true) {
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
    if (logs !== null) cacheSet(`logs:${userId}:${d}`, { logs: rows, entry: null });
    if (updateState) setDayLogs(withPending(userId, d, rows));
    return rows;
  }

  // オフライン中に貯めた記録をサーバへ送信（起動時と通信回復時に呼ばれる）
  async function flushOffline() {
    if (!navigator.onLine) return;
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;
    const queue = getQueue(uid);
    if (queue.length === 0) return;
    const dates = new Set<string>();
    let sent = 0;
    for (const q of queue) {
      const { error } = await supabase.from('logs').insert({ user_id: uid, date: q.date, ...q.log });
      if (!error) { removeFromQueue(uid, q.localId); dates.add(q.date); sent++; }
      else if (/fetch|network/i.test(error.message)) break; // まだ繋がらない→次の機会に
      else { removeFromQueue(uid, q.localId); } // データ不正等は破棄（無限再送を防ぐ）
    }
    for (const d of dates) await syncDaySummary(uid, d, d === dateRef.current);
    if (sent > 0) setSaveMsg({ cls: 'ok', text: `📶 通信が回復したため、オフライン中の記録 ${sent}件を同期しました。` });
  }

  // オフライン保存: 端末のキューに積んでフィードへ楽観的に表示
  function queueOfflineSave(uid: string) {
    if (!parsed) return;
    const hasMeal = parsed.items.length > 0 || parsed.total.kcal > 0;
    const newLog: LogRow = {
      items: parsed.items,
      kcal: hasMeal ? parsed.total.kcal : null,
      p: hasMeal ? parsed.total.p : null, f: hasMeal ? parsed.total.f : null, c: hasMeal ? parsed.total.c : null,
      weight: parsed.weight,
      ex: parsed.ex, adj: parsed.adj,
      mood: parsed.mood || '', text: chat,
      photo_urls: [],
    };
    const q = enqueueLog(uid, date, newLog);
    setDayLogs((prev) => [...prev, { ...newLog, id: q.localId, at: new Date().toISOString() } as LogRow & { id: string; at: string }]);
    hapticSuccess();
    setSaveMsg({ cls: 'ok', text: `📡 オフラインのため端末に保存しました。通信が回復すると自動で同期されます。${photos.length ? '（写真はオフライン保存の対象外です）' : ''}` });
    setChat(''); setPhotos([]); setParsed(null); setEditMode(false); setParseMsg(null);
  }

  async function save() {
    if (!date || !parsed) return;
    setSaving(true); setSaveMsg(null);
    const supabase = createClient();
    // getUser()はネットワーク必須のため、オフラインでも動くgetSession()を使う
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (!user) { setSaving(false); router.push('/login'); return; }

    try {
      // ===== オフライン: 端末に保存して通信回復後に自動送信 =====
      if (!navigator.onLine && !editingLog) {
        queueOfflineSave(user.id);
        return;
      }

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
        hapticSuccess();
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
        hapticSuccess();
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
      hapticSuccess();
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
      const msg = e instanceof Error ? e.message : String(e);
      // 回線断による失敗ならオフライン保存に切り替える（新規記録のみ）
      if (!editingLog && (/fetch|network|load failed/i.test(msg) || !navigator.onLine)) {
        queueOfflineSave(user.id);
      } else {
        setSaveMsg({ cls: 'err', text: '保存失敗: ' + msg });
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteLog(log: LogRow & { id: string }) {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (!user) return;
    // 未同期（オフライン保存）の記録はキューから取り消すだけ
    if (log.id.startsWith('local-')) {
      removeFromQueue(user.id, log.id);
      setDayLogs((prev) => prev.filter((l) => l.id !== log.id));
      setSaveMsg({ cls: 'ok', text: '未同期の記録を1件取り消しました。' });
      return;
    }
    if (log.photo_urls && log.photo_urls.length) {
      await supabase.storage.from('meals').remove(log.photo_urls);
    }
    await supabase.from('logs').delete().eq('id', log.id);
    await syncDaySummary(user.id, date);
    setSaveMsg({ cls: 'ok', text: '1件削除しました（合計は再計算済み）。' });
  }

  const remainLabel = unlimited ? '' : remaining == null ? '' : `（今日あと${Math.max(0, remaining)}回）`;

  // ===== 「つらい」「爆食」のサイン検知 → 目標カロリー緩和のリコメンド =====
  const [struggle, setStruggle] = useState<StruggleKind>(null);
  useEffect(() => {
    if (date !== todayJST()) { setStruggle(null); return; }
    try {
      // 一度「このまま続ける」を選んだら3日間は出さない
      const snooze = localStorage.getItem('bodylog-struggle-snooze');
      if (snooze && Date.now() - new Date(snooze + 'T00:00:00').getTime() < 3 * 86400000) { setStruggle(null); return; }
    } catch { /* 無視 */ }
    setStruggle(detectStruggle(dayLogs.flatMap((l) => [String(l.mood || ''), String(l.text || '')])));
  }, [dayLogs, date]);

  function snoozeStruggle() {
    try { localStorage.setItem('bodylog-struggle-snooze', todayJST()); } catch { /* 無視 */ }
    setStruggle(null);
  }

  // 目標日を1週間延ばして毎日の必要赤字を緩める
  async function loosenGoal() {
    if (!goal) return;
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;
    const newDate = shiftDate(goal.target_date, 7);
    const { error } = await supabase.from('goals').update({ target_date: newDate }).eq('user_id', uid);
    if (error) { setSaveMsg({ cls: 'err', text: '更新に失敗しました: ' + error.message }); return; }
    hapticSuccess();
    setGoal({ ...goal, target_date: newDate });
    snoozeStruggle();
    setSaveMsg({ cls: 'ok', text: `🕊 目標日を1週間延ばしました（${newDate}まで）。毎日の目標カロリーが少し緩みます。無理せず続けましょう！` });
  }

  const loosenDelta = (() => {
    if (!goal || !plan || !profile) return null;
    const loosened = computePlan({ ...goal, target_date: shiftDate(goal.target_date, 7) }, todayJST(), weightForBmr, futureEvents, goal.absorb_days);
    if (!loosened) return null;
    return Math.max(0, plan.requiredDailyWithEvents - loosened.requiredDailyWithEvents);
  })();

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
      {/* ===== 日付ナビ（‹ 日付 › ＋ 今日へ） ===== */}
      <div className="datenav">
        <button className="arrow" onClick={() => { const d = shiftDate(date, -1); setDate(d); loadDay(d); }} title="前日">‹</button>
        <input type="date" value={date} onChange={(e) => { setDate(e.target.value); loadDay(e.target.value); }} />
        <button className="arrow" onClick={() => { const d = shiftDate(date, 1); setDate(d); loadDay(d); }} title="翌日">›</button>
        {date !== todayJST() && (
          <button className="today-chip" onClick={() => { const d = todayJST(); setDate(d); loadDay(d); }}>今日へ</button>
        )}
      </div>

      {/* ===== 今日あと食べられるkcal（ヒーロー表示） ===== */}
      {profile && (() => {
        const heroLeft = planLeft ?? left; // 計画があれば計画基準、なければ維持基準
        return (
          <div className="card daybar">
            <div className="hero-label">
              今日あと食べられる{plan ? '（計画）' : '（維持）'}
              {dayVerdict && <span className={`pill ${verdictClass(dayVerdict)}`} style={{ marginLeft: 8 }}>{dayVerdict}</span>}
            </div>
            {(() => {
              const goalKcal = planIntake ?? target;
              const ratio = goalKcal > 0 ? Math.min(1, Math.max(0, eaten / goalKcal)) : 0;
              const R = 52, CIRC = 2 * Math.PI * R;
              const over = heroLeft < 0;
              return (
                <div className="ring-wrap">
                  <svg viewBox="0 0 120 120">
                    <circle className="ring-bg" cx="60" cy="60" r={R} />
                    <circle className={`ring-fg ${over ? 'over' : ''}`} cx="60" cy="60" r={R}
                            strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - ratio)} />
                  </svg>
                  <div className="ring-center">
                    <div className={`ring-label ${over ? 'over' : ''}`}>{over ? '超過' : '残り'}</div>
                    <div className={`ring-num num ${over ? 'over' : ''}`}>{Math.abs(heroLeft).toLocaleString()}</div>
                    <div className="ring-unit">kcal</div>
                    <div className="ring-sub num">目標: {goalKcal.toLocaleString()} / 摂取: {eaten.toLocaleString()}</div>
                  </div>
                </div>
              );
            })()}
            {todayEvent && (
              <div className="hero-cheat">🍺 今日はチートデイ「{todayEvent.title}」— +{Math.round(Number(todayEvent.extra_kcal)).toLocaleString()}kcalまで想定内</div>
            )}
            {macros && (
              <div className="macro-bars">
                {[
                  { key: 'p', label: '🍗 Protein', eaten: eatenP, tgt: macros.p },
                  { key: 'f', label: '🥑 Fat', eaten: eatenF, tgt: macros.f },
                  { key: 'c', label: '🍚 Carbs', eaten: eatenC, tgt: macros.c },
                ].map((m) => {
                  const over = m.eaten > m.tgt;
                  const pct = m.tgt > 0 ? Math.min(100, (m.eaten / m.tgt) * 100) : 0;
                  return (
                    <div key={m.key}>
                      <div className="macro-bar-head">
                        <span className="macro-bar-label">{m.label}</span>
                        <span className="macro-bar-val num"><b>{m.eaten}</b>/{m.tgt}g</span>
                      </div>
                      <div className="macro-track">
                        <div className={`macro-fill ${m.key} ${over ? 'over' : ''}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
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

      {/* ===== 解析結果（保存前の確認）— iOSボトムシート ===== */}
      <Sheet open={sheetOpen && !!parsed} onClose={() => (editingLog ? cancelEditLog() : setSheetOpen(false))}>
        {parsed && (
        <div>
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

          {/* クイック追加チップ（シート下部・1タップで品目追加） */}
          {!editingLog && myFoods.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>⚡ よく使う品目を追加</div>
              <div className="chips">
                {myFoods.slice(0, 8).map((fd) => (
                  <button key={fd.id} className="chip" onClick={() => addFromFood(fd)}>＋ {fd.name}</button>
                ))}
              </div>
            </div>
          )}

          <button className="btn-primary" style={{ marginTop: 14 }} onClick={save} disabled={saving}>
            {saving ? <><span className="spin" />保存中…</> : editingLog ? '編集を保存する（上書き）' : 'この内容で保存する'}
          </button>
        </div>
        )}
      </Sheet>

      {saveMsg && <div className={`msg ${saveMsg.cls}`} style={{ marginBottom: 12 }}>{saveMsg.text}</div>}

      {/* ===== つらい/爆食のサイン検知 → 目標緩和のリコメンド ===== */}
      {struggle && goal && (
        <div className="card" style={{ border: '1.5px solid var(--amber)' }}>
          <h2>{struggle === 'binge' ? '🍔 食べ過ぎた日があっても大丈夫' : '😮‍💨 無理していませんか？'}</h2>
          <p className="muted" style={{ margin: '0 0 8px' }}>
            {struggle === 'binge'
              ? '今日の記録に「爆食・食べ過ぎ」のサインがありました。1日の失敗は挽回できます。ただ、毎日の目標がきつすぎるサインかもしれません。'
              : '今日の記録に「つらい」のサインがありました。減量は続けられるペースがいちばん大事です。'}
            目標日を1週間延ばすと、毎日の目標カロリーが{loosenDelta != null && loosenDelta > 0 ? `約${Math.round(loosenDelta).toLocaleString()}kcal` : '少し'}緩みます。
          </p>
          <div className="row2">
            <button className="btn-primary" onClick={loosenGoal}>🕊 1週間延ばして緩める</button>
            <button className="btn-ghost" onClick={snoozeStruggle}>大丈夫、このまま続ける</button>
          </div>
        </div>
      )}

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
            <div className="feed-icon">{l.kcal != null ? '🍽' : (l.ex && l.ex !== 'オフ') || Number(l.adj) ? '🏃' : l.weight != null ? '⚖️' : '📝'}</div>
            <div className="feed-body">
              <div>{logSummaryText(l)}{l.id.startsWith('local-') && <span className="pending-tag" title="通信回復後に自動同期されます">⏳未同期</span>}</div>
              <div className="muted feed-text">
                <span className="num">{timeJST(l.at)}</span>
                {l.text ? <>　{String(l.text).slice(0, 60)}</> : null}
              </div>
            </div>
            {!l.id.startsWith('local-') && <button className="item-edit" onClick={() => startEditLog(l)} title="この記録を編集">✎</button>}
            <button className="item-del" onClick={() => deleteLog(l)} title={l.id.startsWith('local-') ? 'この未同期記録を取り消す' : 'この記録を削除'}>×</button>
          </div>
        ))}
      </div>

      {/* ===== 体写真（日々の入力はこのタブに統一） ===== */}
      <BodyPhotos profile={profile} latestWeight={latestWeight}
                  goalNote={goal?.note ?? null} targetBf={goal?.target_bf ?? null} />

      {/* ドックに隠れないための余白 */}
      <div className="dock-spacer" />

      {/* ===== フローティングAI入力ドック（タブバーの上・メッセージアプリ風） ===== */}
      <div className="dock">
        <div className="dock-inner">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden
                 onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />

          {/* 添付済み写真 */}
          {photos.length > 0 && (
            <div className="dock-photos">
              {photos.map((p, i) => (
                <div className="thumb" key={i}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.dataUrl} alt="" />
                  <button className="thumb-x" onClick={() => setPhotos((arr) => arr.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* 保存前の内容があるのに閉じている時は戻れるピルを出す */}
          {parsed && !sheetOpen && (
            <button className="resume-pill" onClick={() => setSheetOpen(true)}>
              📋 保存前の記録があります — タップして確認・保存
            </button>
          )}

          {/* マイ食品チップ（横スクロール・1タップで記録開始） */}
          {myFoods.length > 0 && !parsed && (
            <div className="chip-strip">
              {myFoods.map((fd) => (
                <button key={fd.id} className="chip" onClick={() => addFromFood(fd)}>＋ {fd.name}</button>
              ))}
            </div>
          )}

          {parseMsg && <div className={`msg ${parseMsg.cls}`} style={{ marginTop: 0, marginBottom: 8 }}>{parseMsg.text}</div>}

          <div className="dock-row">
            <button className="dock-cam" title="写真を追加" onClick={async () => {
              // 判定は同期で行う（awaitを挟むとclick()がユーザー操作扱いされず無反応になる）
              if (isNativeCameraAvailable()) {
                const p = await pickPhotoNative();
                if (p) setPhotos((arr) => (arr.length < 4 ? [...arr, p] : arr));
              } else {
                fileRef.current?.click();
              }
            }}>📷</button>
            <textarea rows={1} value={chat} placeholder="食事・体重・気分を自由に…"
                      onChange={(e) => {
                        setChat(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
                      }} />
            <button className="dock-send" onClick={parse} disabled={parsing || (!unlimited && remaining === 0)}>
              {parsing ? <><span className="spin" />解析中</> : '✨ AI解析'}
            </button>
          </div>
          <div className="dock-hint num">
            {!unlimited && remaining === 0
              ? `本日のAI解析（${AI_DAILY_LIMIT}回）を使い切りました。明日リセットされます`
              : `写真だけでもOK・自由な言葉で ${remainLabel}`}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
