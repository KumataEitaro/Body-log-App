'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { EX_LEVELS, EX_ADD, type ExLevel, mifflinBMR, judge, verdictClass, AI_DAILY_LIMIT, isUnlimited, todayJST } from '@/lib/calc';
import { rescaleByQty, sumItems, emptyItem } from '@/lib/items';
import { summarizeDay, dayExerciseKcal, type LogRow } from '@/lib/day';
import { computePlan, macroTargets, type Goal, type PlanEvent } from '@/lib/goal';
import { matchFoodsLocally, addServing, servingCount } from '@/lib/foods';
import BodyPhotos from '@/components/BodyPhotos';
import { hapticSuccess, hapticTap, pickPhotoNative, isNativeCameraAvailable, setTodayRecordedBadge, isNativeSync } from '@/lib/native';
import { isNativePhotosAvailable, photosAuthStatus, photosRequestAccess, photosRecents, photosFull, photosPick, photosOpenSettings, photosPresentLimitedPicker, type PhotoAuth, type RecentPhoto } from '@/lib/photos';
import { cacheGet, cacheSet } from '@/lib/cache';
import { getQueue, enqueueLog, removeFromQueue } from '@/lib/offlineQueue';
import Sheet from '@/components/Sheet';
import { detectStruggle, type StruggleKind } from '@/lib/adaptive';
import { healthPushDay, healthPullLatest, isHealthEnabled, healthActiveEnergyDays } from '@/lib/health';
import { averageActive, resolveActiveKcal, tdeeFromHealth } from '@/lib/energy';
import { friendlyError, JA_TEXT_RE } from '@/lib/errmsg';
import { widgetSync, type WidgetDay } from '@/lib/widget';

type ParsedItem = { name: string; qty: string; kcal: number; p: number; f: number; c: number };
type Parsed = {
  items: ParsedItem[];
  total: { kcal: number; p: number; f: number; c: number };
  weight: number | null;
  waist: number | null;
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
  const outUrl = canvas.toDataURL('image/jpeg', 0.72);
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.72));
  return { blob, dataUrl: outUrl, base64: outUrl.split(',')[1], mime: 'image/jpeg' };
}

function timeJST(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

// waist列がまだ無い環境（migration-13未適用）でも壊れないよう、waistを除いたコピーを返す
function stripWaist<T extends Record<string, unknown>>(o: T): T {
  const { waist: _w, ...rest } = o;
  return rest as T;
}
function isMissingWaist(msg: string | undefined): boolean {
  return !!msg && /waist/i.test(msg);
}

function shiftDate(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, '0'), dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export default function LogPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);      // アルバム用（Webフォールバック）
  const camFileRef = useRef<HTMLInputElement>(null);   // カメラ直接起動用（Webフォールバック: capture属性）
  const composerTaRef = useRef<HTMLTextAreaElement>(null);
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
  const [composerOpen, setComposerOpen] = useState(false); // 入力コンポーザー（下から立ち上がる大きな入力欄）

  // ===== カメラロール直選択（アプリ内サムネイルグリッド） =====
  const [photoAuth, setPhotoAuth] = useState<PhotoAuth | null>(null);
  const [recents, setRecents] = useState<RecentPhoto[]>([]);
  const [thumbLoading, setThumbLoading] = useState<string | null>(null); // フルサイズ取得中のサムネイルid
  const recentsAt = useRef(0); // 直近読込時刻（60秒キャッシュ）

  async function loadRecents(force = false) {
    if (!isNativePhotosAvailable()) { setPhotoAuth('unavailable'); return; }
    const st = await photosAuthStatus();
    setPhotoAuth(st);
    if (st !== 'granted' && st !== 'limited') return;
    if (!force && Date.now() - recentsAt.current < 60000 && recents.length > 0) return;
    const list = await photosRecents(24, 160);
    recentsAt.current = Date.now();
    setRecents(list);
  }

  // コンポーザーを開いた時にカメラロールのサムネイルを用意する
  useEffect(() => {
    if (composerOpen) loadRecents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerOpen]);

  async function requestPhotoAccess() {
    const st = await photosRequestAccess();
    setPhotoAuth(st);
    if (st === 'granted' || st === 'limited') loadRecents(true);
  }

  // アクセス拒否済み → iOSの設定画面へ（写真 → すべての写真 に変更してもらう）
  async function openPhotoSettings() {
    const ok = await photosOpenSettings();
    if (!ok) setParseMsg({ cls: 'err', text: '設定を開けませんでした。iPhoneの設定 → BodyLog → 写真 から許可できます。' });
  }

  // 限定アクセス中 → 「選択した写真」を追加・変更するOSシートを開き、閉じたら一覧を更新
  async function manageLimitedPhotos() {
    await photosPresentLimitedPicker();
    loadRecents(true);
  }

  // サムネイルをタップ → フルサイズを取得して添付
  async function addFromRecent(r: RecentPhoto) {
    if (thumbLoading || photos.length >= 4) return;
    hapticTap();
    setThumbLoading(r.id);
    try {
      const full = await photosFull(r.id);
      if (full) setPhotos((arr) => (arr.length < 4 ? [...arr, full] : arr));
      else setParseMsg({ cls: 'err', text: 'この写真を読み込めませんでした。もう一度お試しください。' });
    } finally {
      setThumbLoading(null);
    }
  }

  // 「すべて」→ OSの写真グリッド（PHPicker・権限不要・プロンプトなし）
  async function openAllPhotos() {
    const r = await photosPick();
    if (r.photo) { const ph = r.photo; setPhotos((arr) => (arr.length < 4 ? [...arr, ph] : arr)); return; }
    if (r.error) { console.log('[photos] pick error:', r.error); setParseMsg({ cls: 'err', text: '写真を開けませんでした。もう一度お試しください。' }); }
  }
  const [editingLog, setEditingLog] = useState<(LogRow & { id: string; at: string }) | null>(null); // 保存済み記録の編集中
  const [editMode, setEditMode] = useState(false);
  const [eKcal, setEKcal] = useState(''); const [eP, setEP] = useState(''); const [eF, setEF] = useState(''); const [eC, setEC] = useState('');
  const [eEx, setEEx] = useState<ExLevel>('オフ'); const [eAdj, setEAdj] = useState('0'); const [eWeight, setEWeight] = useState(''); const [eWaist, setEWaist] = useState(''); const [eMood, setEMood] = useState('');

  const [parsing, setParsing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false); // シート内スケルトン表示用（解析待ち）
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
    setParseMsg(null); setSaveMsg(null); setEditingLog(null); setSheetOpen(false); setComposerOpen(false);

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

      // カレンダー等から ?date=YYYY-MM-DD で特定日を開けるようにする
      let startDate = todayJST();
      try {
        const qd = new URLSearchParams(window.location.search).get('date');
        if (qd && /^\d{4}-\d{2}-\d{2}$/.test(qd)) { startDate = qd; setDate(qd); }
      } catch { /* 無視 */ }

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
        loadDay(startDate); // キャッシュ分を即描画（待たずに次へ）
        flushOffline();      // 未同期の記録があれば送信
      }

      // ② 裏で最新を取得
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (!user) {
        // 通信・認証の一時失敗はログアウト扱いにしない（キャッシュ表示のまま次回に任せる）
        if ((authErr || !navigator.onLine) && cachedUid) return;
        router.push('/login'); return;
      }
      const { data: prof, error: profErr } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      // 取得失敗（瞬断・トークン更新中）を「未作成」と誤判定しない: 確定的に行が無い時だけオンボーディングへ
      if (!prof) { if (profErr || !navigator.onLine) return; router.push('/onboarding'); return; }
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
      await loadDay(startDate);
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
  const manualTarget = baseKcal + exTotal; // 従来式: 基礎代謝×生活係数＋手動運動加算

  // ===== ヘルスケアの実測消費から目安を推計（連携ON・データがある日のみ） =====
  // 今日=「当日実測 vs 直近7日平均」の大きい方 / 過去日=その日の実測。無ければ従来式へフォールバック
  const [hkInfo, setHkInfo] = useState<{ actual: number | null; avg: number | null } | null>(null);
  useEffect(() => {
    let dead = false;
    setHkInfo(null);
    if (!isHealthEnabled()) return;
    (async () => {
      const dates = Array.from({ length: 8 }, (_, i) => shiftDate(date, -i)); // 当日＋過去7日
      const vals = await healthActiveEnergyDays(dates);
      if (dead) return;
      setHkInfo({ actual: vals[0] != null ? Math.round(vals[0]) : null, avg: averageActive(vals.slice(1)) });
    })();
    return () => { dead = true; };
  }, [date]);
  const hkActive = profile ? resolveActiveKcal(hkInfo?.actual ?? null, hkInfo?.avg ?? null, date === todayJST()) : null;
  const targetFromHealth = hkActive != null;
  const target = targetFromHealth ? tdeeFromHealth(bmr, hkActive) : manualTarget;

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

  // アルバムを直接開く（ネイティブ=OSの写真グリッドが即表示。プロンプトは挟まない）
  async function pickFromLibrary() {
    if (isNativeCameraAvailable()) {
      const r = await pickPhotoNative('PHOTOS');
      if (r.photo) { const ph = r.photo; setPhotos((arr) => (arr.length < 4 ? [...arr, ph] : arr)); return; }
      if (!r.error) return; // ユーザーキャンセル
      console.log('[photos] library error:', r.error);
      setParseMsg({ cls: 'err', text: '写真を開けませんでした。ファイル選択に切り替えます。' });
      fileRef.current?.click();
    } else {
      fileRef.current?.click();
    }
  }

  // カメラを直接起動する（撮影orライブラリの選択画面は出さない）
  async function takePhoto() {
    if (isNativeCameraAvailable()) {
      const r = await pickPhotoNative('CAMERA');
      if (r.photo) { const ph = r.photo; setPhotos((arr) => (arr.length < 4 ? [...arr, ph] : arr)); return; }
      if (!r.error) return; // ユーザーキャンセル
      console.log('[camera] error:', r.error);
      setParseMsg({ cls: 'err', text: 'カメラを起動できませんでした。ファイル選択に切り替えます。' });
      camFileRef.current?.click();
    } else {
      camFileRef.current?.click();
    }
  }

  async function parse() {
    if (!chat.trim() && photos.length === 0) {
      setParseMsg({ cls: 'err', text: 'メモを書くか写真を追加してください。' });
      return;
    }

    // マイ食品チップで先に追加した品目は消さず、解析結果を「追記」する。
    // 記録の編集中だけは従来どおり全置換（同じテキストの再解析で品目が二重になるのを防ぐ）。
    const baseItems = editingLog ? [] : (parsed?.items ?? []);
    const prev = editingLog ? null : parsed;

    // ===== ① 辞書ローカル即答（0秒）: 写真なし＆テキストがマイ食品辞書だけで完全に解ける場合、AIを使わない =====
    if (photos.length === 0) {
      const local = matchFoodsLocally(chat, myFoods);
      if (local) {
        hapticTap();
        const items = [...baseItems, ...local];
        setParsed({
          items, total: sumItems(items),
          weight: prev?.weight ?? null, waist: prev?.waist ?? null,
          ex: prev?.ex ?? null, adj: prev?.adj ?? 0, mood: prev?.mood ?? null, questions: [],
        });
        setEditMode(false); setParseMsg(null);
        setComposerOpen(false);
        setSheetOpen(true);
        return; // AI枠も消費しない
      }
    }

    // ===== ② AI解析: シートを即開いてスケルトン表示（体感待ち時間を削減） =====
    setParsing(true); setParseMsg(null);
    setAnalyzing(true); setComposerOpen(false); setSheetOpen(true);
    try {
      const t0 = performance.now();
      const res = await fetch('/api/parse-food', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chat, images: photos.map((p) => ({ data: p.base64, mime: p.mime })), lang: localStorage.getItem('bodylog-lang') || 'ja' }),
      });
      const j = await res.json();
      if (j.timings) console.log(`[AI] client=${Math.round(performance.now() - t0)}ms server:`, j.timings);
      if (j.detail) console.log('[AI] fail detail:', j.detail); // 技術詳細は画面に出さずログのみ
      if (typeof j.remaining === 'number') setRemaining(j.remaining);
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      const aiItems: ParsedItem[] = j.result.items || [];
      const items = [...baseItems, ...aiItems];
      setParsed({
        items,
        total: items.length > 0 ? sumItems(items) : (j.result.total || { kcal: 0, p: 0, f: 0, c: 0 }),
        weight: j.result.weight ?? prev?.weight ?? null,
        waist: j.result.waist ?? prev?.waist ?? null,
        ex: EX_LEVELS.includes(j.result.ex) ? j.result.ex : (prev?.ex ?? null),
        adj: (Number(j.result.adj) || 0) || (prev?.adj ?? 0),
        mood: j.result.mood ?? prev?.mood ?? null,
        questions: Array.isArray(j.result.questions) ? j.result.questions.filter((q: unknown) => typeof q === 'string') : [],
      });
      setEditMode(false);
      setParseMsg(null);
    } catch (e) {
      setSheetOpen(false); setComposerOpen(true); // 失敗時はコンポーザーに戻してエラー表示（書いた内容は残る）
      setParseMsg({ cls: 'err', text: friendlyError(e, '通信に失敗しました。電波状況を確認して再試行してください。') });
    } finally {
      setParsing(false);
      setAnalyzing(false);
    }
  }

  function startEdit() {
    if (!parsed) return;
    setEKcal(String(Math.round(parsed.total.kcal))); setEP(String(Math.round(parsed.total.p)));
    setEF(String(Math.round(parsed.total.f))); setEC(String(Math.round(parsed.total.c)));
    setEEx(parsed.ex ?? 'オフ'); setEAdj(String(parsed.adj)); setEWeight(parsed.weight == null ? '' : String(parsed.weight));
    setEWaist(parsed.waist == null ? '' : String(parsed.waist));
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
        waist: eWaist === '' ? null : Number(eWaist),
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
      waist: l.waist == null ? null : Number(l.waist),
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

  // toComposer=true: ドック/コンポーザーのチップから → コンポーザーを開いたまま追記できる
  // toComposer=false: 解析結果シート内のクイック追加 → シートに留まる
  // 同じチップの連打は行を増やさず既存行に1回分ずつ積み増す（×1→×2→×3…）
  function addFromFood(fd: MyFood, toComposer = false) {
    hapticTap();
    const items = addServing(parsed?.items ?? [], fd);
    if (parsed) {
      setItems(items);
    } else {
      setParsed({ items, total: sumItems(items), weight: null, waist: null, ex: null, adj: 0, mood: null, questions: [] });
    }
    if (toComposer) {
      setSheetOpen(false);
      setComposerOpen(true); // 続けて自由入力・写真も足せる
    } else {
      setSheetOpen(true); // 追加内容をシートで確認
    }
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
      const entryRow = {
        user_id: userId, date: d,
        ex: s.ex, adj: s.adj,
        intake: s.intake, p: s.p, f: s.f, c: s.c,
        weight: s.weight, waist: s.waist, mood: s.mood, note: '',
        food_text: s.food_text.slice(0, 2000), photo_urls: s.photo_urls,
      };
      let { error: eErr } = await supabase.from('entries').upsert(entryRow, { onConflict: 'user_id,date' });
      if (eErr && isMissingWaist(eErr.message)) {
        ({ error: eErr } = await supabase.from('entries').upsert(stripWaist(entryRow), { onConflict: 'user_id,date' }));
      }
      // ヘルスケア連携がONなら、その日のサマリーを書き出す（ネイティブ・許可時のみ・無害）
      healthPushDay({ date: d, weight: s.weight, waist: s.waist, energy: s.intake, protein: s.p, fat: s.f, carbs: s.c });
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
      let { error } = await supabase.from('logs').insert({ user_id: uid, date: q.date, ...q.log });
      if (error && isMissingWaist(error.message)) {
        ({ error } = await supabase.from('logs').insert(stripWaist({ user_id: uid, date: q.date, ...q.log })));
      }
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
      waist: parsed.waist,
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
        waist: parsed.waist,
        ex: parsed.ex, adj: parsed.adj,
        mood: parsed.mood || '', text: chat,
        photo_urls: paths,
      };

      // ===== 編集モード: 既存の記録を上書き =====
      if (editingLog) {
        const mergedPhotos = [...(editingLog.photo_urls || []), ...paths]; // 既存写真は保持し追加分を合流
        const upRow = { ...newLog, photo_urls: mergedPhotos };
        let { error: upErr } = await supabase.from('logs').update(upRow).eq('id', editingLog.id);
        if (upErr && isMissingWaist(upErr.message)) {
          ({ error: upErr } = await supabase.from('logs').update(stripWaist(upRow)).eq('id', editingLog.id));
        }
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

      let { error } = await supabase.from('logs').insert({ user_id: user.id, date, ...newLog });
      if (error && isMissingWaist(error.message)) {
        ({ error } = await supabase.from('logs').insert(stripWaist({ user_id: user.id, date, ...newLog })));
      }

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
        const legacyRow = {
          user_id: user.id, date,
          ex: s.ex, adj: s.adj,
          intake: s.intake, p: s.p, f: s.f, c: s.c,
          weight: s.weight, waist: s.waist, mood: s.mood, note: '',
          food_text: s.food_text.slice(0, 2000), photo_urls: s.photo_urls,
        };
        let { error: e2 } = await supabase.from('entries').upsert(legacyRow, { onConflict: 'user_id,date' });
        if (e2 && isMissingWaist(e2.message)) {
          ({ error: e2 } = await supabase.from('entries').upsert(stripWaist(legacyRow), { onConflict: 'user_id,date' }));
        }
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
        console.log('[save] error:', msg);
        setSaveMsg({ cls: 'err', text: JA_TEXT_RE.test(msg) ? `保存に失敗しました: ${msg}` : '保存に失敗しました。もう一度お試しください。' });
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

  // マイ食品チップ（追加済みなら「×2」バッジを表示。タップで1回分ずつ積み増し）
  function foodChip(fd: MyFood, toComposer: boolean) {
    const cnt = parsed ? servingCount(parsed.items, fd) : null;
    const label = cnt != null ? `×${cnt % 1 === 0 ? cnt : cnt.toFixed(1)}` : null;
    return (
      <button key={fd.id} className={`chip ${label ? 'counted' : ''}`} onClick={() => addFromFood(fd, toComposer)}>
        {label ? '' : '＋ '}{fd.name}{label && <b className="chip-count num">{label}</b>}
      </button>
    );
  }

  // ヘルスケア連携（ONのとき入力ドックに取り込みチップを出す）
  const [healthEnabled, setHealthEnabled] = useState(false);
  useEffect(() => { setHealthEnabled(isHealthEnabled()); }, []);

  // ===== 体重の自動取込: 起動時＋アプリに戻った時、ヘルスケアの今日の体重を自動で記録する =====
  // （スマート体重計→ヘルスケア→BodyLogを開いた瞬間に記録済み、という体験。チップ操作は不要に）
  useEffect(() => {
    if (!healthEnabled) return;
    let busy = false;
    const isoToJstDate = (iso: string) =>
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date(iso)); // sv-SE = yyyy-MM-dd形式
    const pull = async () => {
      if (busy) return;
      busy = true;
      try {
        const latest = await healthPullLatest();
        const w = latest?.weight;
        if (w == null || !latest?.weightDate) return;
        const today = todayJST();
        if (isoToJstDate(latest.weightDate) !== today) return; // 今日測った体重だけを対象にする
        const wr = Math.round(w * 10) / 10;
        // 同じサンプルを二重登録しない（手動修正との喧嘩も防ぐ）
        const dedupeKey = `${today}:${wr}`;
        try { if (localStorage.getItem('bl-auto-weight') === dedupeKey) return; } catch { /* 無視 */ }
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const { data: e } = await supabase.from('entries').select('weight').eq('date', today).maybeSingle();
        const cur = e?.weight != null ? Number(e.weight) : null;
        if (cur != null && Math.abs(cur - wr) < 0.05) { // 既に同じ値が記録済み
          try { localStorage.setItem('bl-auto-weight', dedupeKey); } catch { /* 無視 */ }
          return;
        }
        const { error } = await supabase.from('logs').insert({
          user_id: uid, date: today, items: [], kcal: null, p: null, f: null, c: null,
          weight: wr, ex: 'オフ', adj: 0, mood: '', text: '（ヘルスケアから自動取込）', photo_urls: [],
        });
        if (error) return; // 失敗しても静かに（次のフォアグラウンドで再試行される）
        try { localStorage.setItem('bl-auto-weight', dedupeKey); } catch { /* 無視 */ }
        await syncDaySummary(uid, today, dateRef.current === today);
        setLatestWeight(wr);
        hapticTap();
        setSaveMsg({ cls: 'ok', text: `⌚ ヘルスケアから体重 ${wr.toFixed(1)}kg を自動で取り込みました。` });
      } finally {
        busy = false;
      }
    };
    pull();
    const onVis = () => { if (document.visibilityState === 'visible') pull(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [healthEnabled]);

  // ヘルスケアの最新の体重・ウエストを取り込んで保存前シートに反映
  async function pullFromHealth() {
    const latest = await healthPullLatest();
    if (!latest || (latest.weight == null && latest.waist == null)) {
      setSaveMsg({ cls: 'err', text: 'ヘルスケアから体重・ウエストを取得できませんでした。' });
      return;
    }
    setParsed((p) => ({
      items: p?.items ?? [],
      total: p?.total ?? { kcal: 0, p: 0, f: 0, c: 0 },
      weight: latest.weight != null ? Math.round(latest.weight * 10) / 10 : (p?.weight ?? null),
      waist: latest.waist != null ? Math.round(latest.waist * 10) / 10 : (p?.waist ?? null),
      ex: p?.ex ?? null, adj: p?.adj ?? 0, mood: p?.mood ?? null, questions: p?.questions ?? [],
    }));
    hapticTap();
    setSheetOpen(true);
  }

  // ===== 昨日の穴埋め（ダイエット失敗の主因＝未記録の爆食日を、翌日に低摩擦で回収する） =====
  const [backfill, setBackfill] = useState<{ date: string; binge: boolean } | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMore, setBackfillMore] = useState(false); // 「食べすぎた…」展開

  useEffect(() => {
    (async () => {
      try {
        const t = todayJST();
        if (localStorage.getItem('bl-backfill-snooze') === t) return; // 今日は「あとで」済み
        const y = shiftDate(t, -1);
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        const [{ data: e }, { data: first }] = await Promise.all([
          supabase.from('entries').select('intake,mood,food_text').eq('date', y).maybeSingle(),
          supabase.from('entries').select('date').order('date', { ascending: true }).limit(1),
        ]);
        if (!first || first.length === 0 || first[0].date > y) return; // 昨日以前に記録がない（始めたばかり）
        if (e?.intake != null) return; // 昨日の食事は記録済み
        // 昨日に気分・メモだけ残っていて爆食サインがある場合はコピーを変える
        const binge = detectStruggle([String(e?.mood || ''), String(e?.food_text || '')]) === 'binge';
        setBackfill({ date: y, binge });
      } catch { /* 無視（穴埋めは本体機能に影響させない） */ }
    })();
  }, []);

  // ±0確定 or ざっくり食べすぎ(+extra)で昨日を1行記録する
  async function backfillSave(extra: number) {
    if (!backfill || !profile || backfillBusy) return;
    setBackfillBusy(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const baseEst = Math.round(mifflinBMR(profile.sex, weightForBmr, Number(profile.height_cm), Number(profile.age)) * Number(profile.life_factor));
      const { error } = await supabase.from('logs').insert({
        user_id: uid, date: backfill.date, at: `${backfill.date}T21:00:00+09:00`,
        items: [], kcal: baseEst + extra, p: null, f: null, c: null, weight: null,
        ex: 'オフ', adj: 0, mood: '',
        text: extra > 0 ? `（あとから概算: 食べすぎ +${extra}kcal）` : '（あとから確定: だいたい目安どおり）',
        photo_urls: [],
      });
      if (error) { setSaveMsg({ cls: 'err', text: friendlyError(new Error(error.message), '保存に失敗しました。もう一度お試しください。') }); return; }
      await syncDaySummary(uid, backfill.date, false);
      hapticSuccess();
      setSaveMsg({
        cls: 'ok',
        text: extra > 0
          ? `昨日を「食べすぎ +${extra.toLocaleString()}kcal」として記録しました。1日の失敗は挽回できます。今日から立て直しましょう！`
          : '昨日を「目安どおり（±0）」で確定しました。',
      });
      setBackfill(null);
    } finally {
      setBackfillBusy(false);
    }
  }

  // ちゃんと思い出して入力: 昨日の日付に切り替えてコンポーザーを開く
  function backfillRecall() {
    if (!backfill) return;
    const d = backfill.date;
    setBackfill(null);
    setDate(d);
    loadDay(d);
    setComposerOpen(true);
  }

  function backfillSnooze() {
    try { localStorage.setItem('bl-backfill-snooze', todayJST()); } catch { /* 無視 */ }
    setBackfill(null);
  }

  // ===== ホーム画面ウィジェットへ今日のサマリーを書き出す（ネイティブ＆対応バイナリのみ） =====
  const widgetGoal = planIntake ?? target;
  const widgetPGoal = macros?.p ?? 0;

  // 中サイズ用: 昨日までの6日分の収支（±kcal・未記録=null）。日別の「正直な鏡」に使う
  const [widgetWeek, setWidgetWeek] = useState<{ days: WidgetDay[]; sum: number; unknown: number } | null>(null);
  useEffect(() => {
    if (!profile) return;
    (async () => {
      try {
        const supabase = createClient();
        const today = todayJST();
        const from = shiftDate(today, -6);
        const { data } = await supabase.from('entries').select('date,intake,ex,adj')
          .gte('date', from).lt('date', today);
        const byDate = new Map((data || []).map((r) => [String(r.date), r]));
        const DOW = ['日', '月', '火', '水', '木', '金', '土'];
        const base = Math.round(mifflinBMR(profile.sex, weightForBmr, Number(profile.height_cm), Number(profile.age)) * Number(profile.life_factor));
        const days: WidgetDay[] = [];
        let sum = 0, unknown = 0;
        for (let i = 6; i >= 1; i--) {
          const d = shiftDate(today, -i);
          const r = byDate.get(d);
          const label = DOW[new Date(d + 'T00:00:00').getDay()];
          if (r?.intake == null) { days.push({ l: label, v: null }); unknown++; continue; }
          const dayTarget = base + (EX_ADD[(r.ex as ExLevel) || 'オフ'] ?? 0) + (Number(r.adj) || 0);
          const diff = Math.round(Number(r.intake) - dayTarget);
          days.push({ l: label, v: diff });
          sum += diff;
        }
        setWidgetWeek({ days, sum: Math.round(sum), unknown });
      } catch { /* 週データはベストエフォート */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, dayLogs.length]);

  useEffect(() => {
    if (!profile || date !== todayJST()) return;
    const t = setTimeout(() => {
      widgetSync({
        date: todayJST(),
        eaten, goal: widgetGoal, left: widgetGoal - eaten,
        pEaten: eatenP, pGoal: widgetPGoal,
        todayLogged: dayLogs.some((l) => l.kcal != null),
        yUnrec: !!backfill,
        asOf: new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date()),
        days: widgetWeek?.days,
        weekSum: widgetWeek?.sum,
        weekUnknown: widgetWeek?.unknown,
      });
    }, 800); // 連続更新をまとめる
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, date, eaten, widgetGoal, eatenP, widgetPGoal, dayLogs, backfill, widgetWeek]);

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
    if (error) { setSaveMsg({ cls: 'err', text: friendlyError(new Error(error.message), '更新に失敗しました。もう一度お試しください。') }); return; }
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

  // フィード1行の表示内容（主タイトル＝品目を分量つきで、右端＝kcal、補足＝運動/体重/気分）
  function feedLine(l: LogRow): { title: string; right: string | null; rightUnit: string; rightGreen: boolean; extras: string[] } {
    const items = (l.items as ParsedItem[]) || [];
    const extras: string[] = [];
    let title = '';
    let right: string | null = null;
    let rightUnit = '';
    let rightGreen = false;

    const exKcal = (EX_ADD[(l.ex as ExLevel) || 'オフ'] ?? 0) + (Number(l.adj) || 0);
    const exText = l.ex && l.ex !== 'オフ' ? `運動${l.ex} +${exKcal}` : Number(l.adj) ? `補正${Number(l.adj) > 0 ? '+' : ''}${l.adj}` : null;

    if (l.kcal != null) {
      // 品目は分量つきで表示（例: プロテイン ×2、ごはん 180g）
      const names = items.slice(0, 3)
        .map((it) => (it.qty && String(it.qty).trim() && String(it.qty).trim() !== '×1' ? `${it.name} ${it.qty}` : it.name))
        .filter(Boolean).join('、');
      title = names || '食事';
      if (items.length > 3) title += ` ほか${items.length - 3}品`;
      right = Math.round(Number(l.kcal)).toLocaleString();
      rightUnit = 'kcal';
      if (exText) extras.push(exText);
    } else if (exText) {
      title = l.ex && l.ex !== 'オフ' ? `運動 ${l.ex}` : '運動補正';
      right = `${exKcal > 0 ? '+' : ''}${exKcal}`;
      rightGreen = true;
    }
    if (l.weight != null) {
      const s = `体重 ${Number(l.weight).toFixed(1)}kg`;
      if (!title) title = s; else extras.push(s);
    }
    if (l.waist != null) {
      const s = `ウエスト ${Number(l.waist).toFixed(1)}cm`;
      if (!title) title = s; else extras.push(s);
    }
    if (l.mood) extras.push(String(l.mood));
    if (!title) title = String(l.text || '記録').slice(0, 40);
    return { title, right, rightUnit, rightGreen, extras };
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

      {/* ===== 昨日の穴埋めカード（未記録の爆食日を翌日に回収する・責めないトーン） ===== */}
      {backfill && date === todayJST() && !editingLog && (
        <div className="card" style={{ border: '1.5px solid var(--amber)' }}>
          <h2>{backfill.binge ? '🍃 昨日の分、ざっくりだけ記録しませんか' : '📝 昨日の記録がありません'}</h2>
          <p className="muted" style={{ margin: '0 0 8px' }}>
            {backfill.binge
              ? '食べすぎた日ほど、記録すると立て直しが速くなります。ざっくりでOK。誰にも見られません。'
              : 'ざっくりでOKです。未記録の日が続くと、収支の数字と現実が少しずつズレていきます。'}
          </p>
          {!backfillMore ? (
            <div className="row2">
              <button className="btn-primary" disabled={backfillBusy} onClick={() => backfillSave(0)}>
                {backfillBusy ? <><span className="spin" />保存中…</> : 'だいたい目安どおり（±0）'}
              </button>
              <button className="btn-ghost" disabled={backfillBusy} onClick={() => setBackfillMore(true)}>食べすぎた…</button>
            </div>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 11.5, margin: '0 0 6px' }}>どれくらいオーバーした感覚ですか？（あとから直せます）</p>
              <div className="chips">
                {[500, 1000, 2000].map((n) => (
                  <button key={n} className="chip" disabled={backfillBusy} onClick={() => backfillSave(n)}>+{n.toLocaleString()}kcal くらい</button>
                ))}
                <button className="chip" onClick={backfillRecall}>思い出して入力する</button>
              </div>
            </>
          )}
          <p className="center" style={{ margin: '8px 0 0', fontSize: 12 }}>
            <a href="#" className="muted" onClick={(e) => { e.preventDefault(); backfillRecall(); }}>ちゃんと思い出して入力する</a>
            <span className="muted"> ・ </span>
            <a href="#" className="muted" onClick={(e) => { e.preventDefault(); backfillSnooze(); }}>あとで</a>
          </p>
        </div>
      )}

      {/* ===== C案ヒーロー: 巨大数字＋水平プログレスライン ===== */}
      {profile && (() => {
        const heroLeft = planLeft ?? left; // 計画があれば計画基準、なければ維持基準
        const goalKcal = planIntake ?? target;
        const pct = goalKcal > 0 ? Math.min(100, Math.max(0, (eaten / goalKcal) * 100)) : 0;
        const over = heroLeft < 0;
        return (
          <div className="hero2">
            <div className="hero2-label">
              {over ? 'オーバー' : 'あと食べられる'}{plan ? '（計画）' : '（維持）'}
              {targetFromHealth && <span className="pill tri" title="ヘルスケアの実測消費に基づく推計">⌚実測</span>}
              {dayVerdict && <span className={`pill ${verdictClass(dayVerdict)}`}>{dayVerdict}</span>}
            </div>
            <div className={`hero2-num num ${over ? 'over' : ''}`}>{Math.abs(heroLeft).toLocaleString()}<small> kcal</small></div>
            {todayEvent && (
              <div className="hero-cheat">今日はチートデイ「{todayEvent.title}」— +{Math.round(Number(todayEvent.extra_kcal)).toLocaleString()}kcalまで想定内</div>
            )}
            <div className="hline">
              <i className={over ? 'over' : ''} style={{ width: `${pct}%` }} />
              <b className={over ? 'over' : ''} style={{ left: `${pct}%` }} />
            </div>
            <div className="hero2-meta num"><span>摂取 {eaten.toLocaleString()}</span><span>目標 {goalKcal.toLocaleString()}</span></div>
            {macros && (
              <div className="hero2-pfc num">
                <span>P <b className={eatenP > macros.p ? 'over' : ''}>{eatenP}</b>/{macros.p}</span>
                <span>F <b className={eatenF > macros.f ? 'over' : ''}>{eatenF}</b>/{macros.f}</span>
                <span>C <b className={eatenC > macros.c ? 'over' : ''}>{eatenC}</b>/{macros.c}</span>
              </div>
            )}
            <div className="daybar-fine">
              {targetFromHealth
                ? `ヘルスケア実測: 基礎代謝${Math.round(bmr).toLocaleString()}＋活動${(hkActive ?? 0).toLocaleString()}＝消費${target.toLocaleString()}${hkInfo?.actual == null || (hkInfo.avg != null && hkInfo.avg > (hkInfo.actual ?? 0)) ? '（直近7日平均ベース）' : ''}`
                : `基礎代謝${Math.round(bmr).toLocaleString()}×${Number(profile.life_factor)}＋運動${exTotal.toLocaleString()}＝目安${target.toLocaleString()}`}
              {plan && ` ／ 必要赤字${plan.requiredDailyWithEvents.toLocaleString()}/日`}
              {plan && plan.mode === 'spread' && plan.absorbToday > 0 &&
                `（チートデイ+${plan.eventsExtra.toLocaleString()}を残り${plan.remainingDays}日で吸収 +${plan.absorbToday}/日）`}
              {plan && plan.mode === 'window' && plan.absorbToday > 0 &&
                `（チートデイ取り返し中 +${plan.absorbToday}/日・後${plan.absorbDays}日方式）`}
            </div>
          </div>
        );
      })()}

      {/* ===== 解析結果（保存前の確認）— iOSボトムシート ===== */}
      <Sheet open={sheetOpen && (!!parsed || analyzing)} onClose={() => (editingLog ? cancelEditLog() : setSheetOpen(false))}>
        {analyzing && (
          <div>
            <h2>AIが解析中… <span className="muted" style={{ fontWeight: 400 }}>— 数秒で品目が出ます</span></h2>
            {parsed && parsed.items.length > 0 && (
              <p className="muted" style={{ margin: '0 0 8px' }}>追加済みの{parsed.items.length}品（{parsed.items.map((it) => it.name).slice(0, 3).join('、')}{parsed.items.length > 3 ? ' ほか' : ''}）はそのまま残り、解析結果が追記されます</p>
            )}
            {photos.length > 0 && (
              <div className="photo-row" style={{ marginBottom: 10 }}>
                {photos.map((p, i) => (
                  <div className="thumb" key={i}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.dataUrl} alt="" />
                  </div>
                ))}
              </div>
            )}
            <div className="skel-row" style={{ width: '82%' }} />
            <div className="skel-row" style={{ width: '64%' }} />
            <div className="skel-row" style={{ width: '73%' }} />
            <div className="skel-row" style={{ width: '38%', height: 28, marginTop: 14 }} />
          </div>
        )}
        {!analyzing && parsed && (
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
              {/* スマホ幅で横スクロール不要の2段カード型（1行目=品目・分量・削除 / 2行目=kcal・PFC） */}
              {parsed.items.map((it, i) => (
                <div className="item-row" key={`${i}-${parsed.items.length}`}>
                  <div className="item-row-head">
                    <input className="item-input name-cell" defaultValue={it.name} placeholder="品目名"
                           onBlur={(e) => updateItemName(i, e.target.value)} />
                    <input className="item-input qty-cell" defaultValue={it.qty} placeholder="50g"
                           onBlur={(e) => applyQty(i, e.target.value)} />
                    <button className="item-del" onClick={() => removeItem(i)} title="この品目を削除">×</button>
                  </div>
                  <div className="item-row-nums">
                    {([['kcal', it.kcal], ['P', it.p], ['F', it.f], ['C', it.c]] as const).map(([lbl, val]) => (
                      <div key={lbl}>
                        <span className="item-num-lbl">{lbl}{lbl !== 'kcal' ? ' (g)' : ''}</span>
                        <input className="item-input num" type="number" inputMode="decimal" value={val}
                               onChange={(e) => updateItemNum(i, lbl === 'kcal' ? 'kcal' : lbl.toLowerCase() as 'p' | 'f' | 'c', e.target.value)} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <button className="btn-ghost" style={{ marginTop: 8 }} onClick={addItem}>＋ 品目を追加</button>
            </div>
          )}

          {!editMode ? (
            <>
              <div className="stat-grid">
                <div className="stat"><div className="stat-l">この記録の摂取</div><div className="stat-v num">{Math.round(parsed.total.kcal).toLocaleString()}<small> kcal</small></div></div>
                <div className="stat"><div className="stat-l">P / F / C</div><div className="stat-v num">{Math.round(parsed.total.p)} / {Math.round(parsed.total.f)} / {Math.round(parsed.total.c)}<small> g</small></div></div>
                <div className="stat"><div className="stat-l">体重 / ウエスト</div><div className="stat-v num">{parsed.weight != null ? parsed.weight.toFixed(1) : '—'}<small> kg</small> / {parsed.waist != null ? parsed.waist.toFixed(1) : '—'}<small> cm</small></div></div>
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
                  <div className="row2">
                    <div><label>体重(kg)</label><input type="number" step="0.1" className="num" value={eWeight} onChange={(e) => setEWeight(e.target.value)} /></div>
                    <div><label>ウエスト(cm)</label><input type="number" step="0.1" className="num" value={eWaist} onChange={(e) => setEWaist(e.target.value)} /></div>
                  </div>
                </>
              ) : (
                <>
                  <div className="row2">
                    <div><label>摂取kcal</label><input type="number" className="num" value={eKcal} onChange={(e) => setEKcal(e.target.value)} /></div>
                    <div><label>体重(kg)</label><input type="number" step="0.1" className="num" value={eWeight} onChange={(e) => setEWeight(e.target.value)} /></div>
                  </div>
                  <div className="row2">
                    <div><label>ウエスト(cm)</label><input type="number" step="0.1" className="num" value={eWaist} onChange={(e) => setEWaist(e.target.value)} /></div>
                    <div></div>
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
                {myFoods.slice(0, 8).map((fd) => foodChip(fd, false))}
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
        <h2>{date === todayJST() ? '今日の記録' : `${date.replace(/-/g, '/')}の記録`}<span className="muted" style={{ fontWeight: 400, letterSpacing: 0 }}> — {dayLogs.length + (legacyEntry ? 1 : 0)}件</span></h2>
        {legacyEntry && (
          <div className="feed-row">
            <span className="feed-time num">まとめ</span>
            <div className="feed-body">
              <div className="feed-title">
                {[
                  legacyEntry.intake != null ? `${Math.round(Number(legacyEntry.intake)).toLocaleString()}kcal` : '',
                  legacyEntry.ex && legacyEntry.ex !== 'オフ' ? `運動${String(legacyEntry.ex)}` : '',
                  legacyEntry.weight != null ? `体重 ${Number(legacyEntry.weight).toFixed(1)}kg` : '',
                  legacyEntry.mood ? String(legacyEntry.mood) : '',
                ].filter(Boolean).join(' ・ ')}
              </div>
              <div className="feed-sub muted">この日の1日まとめ記録（新しく追記すると自動でフィード形式に移行されます）</div>
            </div>
          </div>
        )}
        {dayLogs.length === 0 && !legacyEntry && (
          <p className="muted">まだ記録がありません。下の入力欄から1回分ずつ記録していきましょう。</p>
        )}
        {dayLogs.map((l) => {
          const f = feedLine(l);
          const sub = [...f.extras, l.text ? String(l.text).slice(0, 40) : ''].filter(Boolean).join(' ・ ');
          return (
            <div className="feed-row" key={l.id}>
              <span className="feed-time num">{timeJST(l.at)}</span>
              <div className="feed-body">
                <div className="feed-title">{f.title}{l.id.startsWith('local-') && <span className="pending-tag" title="通信回復後に自動同期されます">⏳未同期</span>}</div>
                {sub && <div className="feed-sub muted">{sub}</div>}
              </div>
              {f.right && <b className={`feed-kcal num ${f.rightGreen ? 'pos' : ''}`}>{f.right}{f.rightUnit ? <small> {f.rightUnit}</small> : null}</b>}
              {!l.id.startsWith('local-') && <button className="item-edit" onClick={() => startEditLog(l)} title="この記録を編集">✎</button>}
              <button className="item-del" onClick={() => deleteLog(l)} title={l.id.startsWith('local-') ? 'この未同期記録を取り消す' : 'この記録を削除'}>×</button>
            </div>
          );
        })}
      </div>

      {/* ===== 体写真（日々の入力はこのタブに統一） ===== */}
      <BodyPhotos profile={profile} latestWeight={latestWeight}
                  goalNote={goal?.note ?? null} targetBf={goal?.target_bf ?? null} />

      {/* ドックに隠れないための余白 */}
      <div className="dock-spacer" />

      {/* ===== 入力コンポーザー（下から立ち上がる・入力欄基準のコンパクトな高さ） ===== */}
      <Sheet open={composerOpen} onClose={() => setComposerOpen(false)}>
        <div className="composer">
          {/* 入力欄が主役（この高さを基準にシート全体が決まる） */}
          <textarea ref={composerTaRef} className="composer-ta" autoFocus rows={3} value={chat}
                    placeholder={'食事・体重・気分を自由に…\n例）昼は牛丼並盛とサラダ。体重73.5kg'}
                    onChange={(e) => {
                      setChat(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.min(180, Math.max(88, e.target.scrollHeight)) + 'px';
                    }} />

          {/* 写真トレイ: カメラ直接起動＋直近のカメラロールをそのまま選択（プロンプトなし） */}
          <div className="pick-strip">
            <button className="pick-tile" onClick={takePhoto}>
              <span className="pick-ico">📷</span><span>カメラ</span>
            </button>
            {photos.map((p, i) => (
              <div className="thumb pick-thumb sel" key={`sel-${i}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.dataUrl} alt="" />
                <button className="thumb-x" onClick={() => setPhotos((arr) => arr.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {/* 初回: 許可のお願いカード（フルアクセス推奨の説明つき） */}
            {photoAuth === 'notDetermined' && (
              <button className="pick-wide" onClick={requestPhotoAccess}>
                <span className="pick-ico">🖼️</span>
                <span className="pick-wide-t">
                  <b>カメラロールをここに表示</b>
                  <small>「すべての写真へのアクセスを許可」がおすすめです</small>
                </span>
              </button>
            )}
            {/* 拒否済み: 設定への導線カード */}
            {photoAuth === 'denied' && (
              <button className="pick-wide" onClick={openPhotoSettings}>
                <span className="pick-ico">🔒</span>
                <span className="pick-wide-t">
                  <b>写真へのアクセスがオフです</b>
                  <small>タップして設定を開き「すべての写真」を選んでください</small>
                </span>
              </button>
            )}
            {recents.map((r) => (
              <button className="pick-thumb-btn" key={r.id} onClick={() => addFromRecent(r)} disabled={!!thumbLoading}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.thumbUrl} alt="" />
                {thumbLoading === r.id && <span className="pick-thumb-spin"><span className="spin" /></span>}
              </button>
            ))}
            {/* 限定アクセス: 選択した写真の追加＋フルアクセスへの導線 */}
            {photoAuth === 'limited' && (
              <button className="pick-tile" onClick={manageLimitedPhotos}>
                <span className="pick-ico">＋</span><span>写真を追加</span>
              </button>
            )}
            {photoAuth === 'limited' && (
              <button className="pick-tile" onClick={openPhotoSettings}>
                <span className="pick-ico">🔓</span><span>全て表示</span>
              </button>
            )}
            {photoAuth === 'granted' && (
              <button className="pick-tile" onClick={openAllPhotos}>
                <span className="pick-ico">⋯</span><span>すべて</span>
              </button>
            )}
            {/* ネイティブなのにPhotosプラグインが無い＝旧バイナリ → 更新を明示（壊れた旧経路に流さない） */}
            {photoAuth === 'unavailable' && isNativeSync() && (
              <div className="pick-wide" style={{ borderStyle: 'solid' }}>
                <span className="pick-ico">⬆️</span>
                <span className="pick-wide-t">
                  <b>アプリの更新が必要です</b>
                  <small>TestFlight/App Storeで最新版に更新すると写真機能が使えます</small>
                </span>
              </div>
            )}
            {/* Web版は従来のアルバムタイル（ファイル選択）へ */}
            {(photoAuth === 'unavailable' || photoAuth === null) && !isNativeSync() && (
              <button className="pick-tile" onClick={pickFromLibrary}>
                <span className="pick-ico">🖼️</span><span>アルバム</span>
              </button>
            )}
          </div>
          {photoAuth === 'limited' && (
            <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>選択した写真のみ表示中。「全て表示」からフルアクセスに変更できます</div>
          )}

          {/* 追加済み品目（ダーク）＋マイ食品（ライト）を1行に。AI解析しても追加分は残る */}
          {(myFoods.length > 0 || (parsed && parsed.items.length > 0 && !editingLog)) && (
            <div className="chip-strip" style={{ marginTop: 8, marginBottom: 0 }}>
              {!editingLog && parsed?.items.map((it, i) => (
                <button className="chip on" key={`added-${i}`} onClick={() => removeItem(i)}
                        title="タップで取り消し">
                  {it.name}{it.qty && it.qty !== '×1' ? ` ${it.qty}` : ''} ×
                </button>
              ))}
              {myFoods.map((fd) => foodChip(fd, true))}
            </div>
          )}

          {parseMsg && <div className={`msg ${parseMsg.cls}`} style={{ marginBottom: 0 }}>{parseMsg.text}</div>}

          {chat.trim() || photos.length > 0 ? (
            <button className="btn-primary" style={{ marginTop: 10 }} onClick={parse}
                    disabled={parsing || (!unlimited && remaining === 0)}>
              {parsing ? <><span className="spin" />解析中…</> : '✨ AI解析'}
            </button>
          ) : (
            <button className="btn-primary" style={{ marginTop: 10 }} disabled={!parsed || parsed.items.length === 0}
                    onClick={() => { setComposerOpen(false); setSheetOpen(true); }}>
              {parsed && parsed.items.length > 0 ? '内容を確認して保存へ' : '✨ AI解析'}
            </button>
          )}
          <div className="dock-hint num">
            {!unlimited && remaining === 0
              ? `本日のAI解析（${AI_DAILY_LIMIT}回）を使い切りました。明日リセットされます`
              : `マイ食品＋自由入力の併用もOK ${remainLabel}`}
          </div>
        </div>
      </Sheet>

      {/* ===== フローティングAI入力ドック（タブバーの上・メッセージアプリ風） ===== */}
      <div className="dock">
        <div className="dock-inner">
          <input ref={fileRef} type="file" accept="image/*" multiple className="file-hidden"
                 onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
          <input ref={camFileRef} type="file" accept="image/*" capture="environment" className="file-hidden"
                 onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />

          {/* 添付済み写真 */}
          {photos.length > 0 && !composerOpen && (
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
          {parsed && !sheetOpen && !composerOpen && (
            <button className="resume-pill" onClick={() => setSheetOpen(true)}>
              📋 保存前の記録があります — タップして確認・保存
            </button>
          )}

          {/* マイ食品チップ（横スクロール・1タップで記録開始→コンポーザーが開く） */}
          {(myFoods.length > 0 || healthEnabled) && !parsed && (
            <div className="chip-strip">
              {healthEnabled && (
                <button className="chip" style={{ background: 'var(--coral-weak)', color: 'var(--coral)' }} onClick={pullFromHealth}>❤️ ヘルスケアから取り込み</button>
              )}
              {myFoods.map((fd) => (
                <button key={fd.id} className="chip" onClick={() => addFromFood(fd, true)}>＋ {fd.name}</button>
              ))}
            </div>
          )}

          {parseMsg && !composerOpen && <div className={`msg ${parseMsg.cls}`} style={{ marginTop: 0, marginBottom: 8 }}>{parseMsg.text}</div>}

          <div className="dock-row">
            {/* 📷=コンポーザーを開く（直近のカメラロールがそのまま選べる写真トレイ付き） */}
            <button className="dock-cam" title="写真を追加" onClick={() => setComposerOpen(true)}>📷</button>
            {/* タップでコンポーザーが立ち上がる（大きな入力欄で書ける） */}
            <button className="dock-fake" onClick={() => setComposerOpen(true)}>
              {chat.trim() ? <span className="dock-fake-text">{chat}</span> : '食事・体重・気分を自由に…'}
            </button>
            <button className="dock-send" onClick={() => { if (chat.trim() || photos.length) { parse(); } else { setComposerOpen(true); } }}
                    disabled={parsing || (!unlimited && remaining === 0)}>
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
