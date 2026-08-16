'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errmsg';
import { mifflinBMR, LIFE_FACTOR_DEFAULT, EX_LEVELS, todayJST } from '@/lib/calc';
import { LANGS, findLang } from '@/lib/langs';
import { LANG_KEY } from '@/components/DomTranslator';
import { getIsNative, scheduleSmartReminder, isNativeSync, isNativeCameraAvailable, readDiag } from '@/lib/native';
import { isNativePhotosAvailable, photosAuthStatus, photosBinaryInfo } from '@/lib/photos';
import { healthSelfTest, isHealthEnabled, setHealthEnabled, healthPullLatest, healthPushDay, healthPullHistory } from '@/lib/health';
import { summarizeDay, type LogRow } from '@/lib/day';
import BackBar from '@/components/BackBar';
import { User, Utensils, Bell, HeartPulse, Globe, Download, Wrench, FileText, Lock, Trash2 } from 'lucide-react';

// 設定メニュー（ハブ→各サブ画面）。1ファイル内で切替え、URLの?s=で状態を保持（戻るキー対応）
// アイコンはiOS設定アプリ風: カラー角丸スクエア背景＋白のLucideアイコン（ストローク幅統一）
const ICO = { size: 17, strokeWidth: 2, color: '#fff' } as const;
const MENU = [
  { key: 'profile', icon: <User {...ICO} />, bg: '#3b82f6', label: 'プロフィール' },
  { key: 'foods', icon: <Utensils {...ICO} />, bg: '#f97316', label: 'マイ食品', href: '/foods' },
  { key: 'notify', icon: <Bell {...ICO} />, bg: '#ef4444', label: '通知' },
  { key: 'health', icon: <HeartPulse {...ICO} />, bg: '#ec4899', label: 'ヘルスケア連携', native: true },
  { key: 'language', icon: <Globe {...ICO} />, bg: '#0ea5e9', label: '言語 / Language' },
  { key: 'import', icon: <Download {...ICO} />, bg: '#a855f7', label: '過去データの取り込み' },
  { key: 'diag', icon: <Wrench {...ICO} />, bg: '#6b7280', label: '診断（オフライン・カメラ）' },
  { key: 'terms', icon: <FileText {...ICO} />, bg: '#64748b', label: '利用規約', href: '/terms' },
  { key: 'privacy', icon: <Lock {...ICO} />, bg: '#14b8a6', label: 'プライバシーポリシー', href: '/privacy' },
  { key: 'danger', icon: <Trash2 {...ICO} />, bg: '#dc2626', label: 'アカウント削除', danger: true },
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [name, setName] = useState('');
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [height, setHeight] = useState('170');
  const [age, setAge] = useState('30');
  const [life, setLife] = useState(String(LIFE_FACTOR_DEFAULT));
  const [msg, setMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);
  const [importJson, setImportJson] = useState('');
  const [importMsg, setImportMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // ネイティブアプリのローカル通知リマインド
  const [nativeApp, setNativeApp] = useState(false);
  const [remindOn, setRemindOn] = useState(false);
  const [remindTime, setRemindTime] = useState('20:00');
  const [remindMsg, setRemindMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    getIsNative().then(setNativeApp);
    try {
      const saved = JSON.parse(localStorage.getItem('bodylog-reminder') || 'null');
      if (saved) { setRemindOn(!!saved.on); setRemindTime(saved.time || '20:00'); }
    } catch { /* 破損は無視 */ }
  }, []);
  async function applyReminder(on: boolean, time: string) {
    setRemindMsg(null);
    const [h, m] = time.split(':').map(Number);
    // 今日すでに記録済みなら、今日の分は最初から予約しない
    let todayLogged = false;
    try {
      const supabase = createClient();
      const { data: e } = await supabase.from('entries').select('date').eq('date', todayJST()).maybeSingle();
      todayLogged = !!e;
    } catch { /* 判定できなければ通知する側に倒す */ }
    const ok = await scheduleSmartReminder(on, h, m, todayLogged);
    if (on && !ok) {
      setRemindMsg({ cls: 'err', text: '通知が許可されていません。iOSの設定 > BodyLog > 通知 を許可してください。' });
      return;
    }
    setRemindOn(on); setRemindTime(time);
    localStorage.setItem('bodylog-reminder', JSON.stringify({ on, time }));
    setRemindMsg({ cls: 'ok', text: on ? `未入力の日だけ、${time} に通知します（記録済みの日は通知されません）。` : 'アプリ通知を停止しました。' });
  }

  // ===== カメラ/写真の診断（不具合調査を推測に頼らないための可視化） =====
  const [photoDiag, setPhotoDiag] = useState<string[] | null>(null);
  async function runPhotoDiag() {
    const lines: string[] = [];
    lines.push(`ネイティブアプリ: ${isNativeSync() ? 'はい' : 'いいえ（ブラウザ）'}`);
    lines.push(`カメラ機能: ${isNativeCameraAvailable() ? '利用可能' : '利用不可'}`);
    if (isNativePhotosAvailable()) {
      const info = await photosBinaryInfo();
      lines.push(`写真機能: 利用可能（アプリ v${info?.version ?? '?'} ビルド${info?.build ?? '?'}）`);
      const authLabel: Record<string, string> = {
        granted: '許可済み（フルアクセス）', limited: '限定アクセス（選択した写真のみ）',
        denied: '拒否（設定から変更できます）', notDetermined: '未確認（まだ許可を求めていません）',
        unavailable: '取得できませんでした',
      };
      const st = await photosAuthStatus();
      lines.push(`写真へのアクセス: ${authLabel[st] ?? st}`);
    } else {
      lines.push(isNativeSync() ? '写真機能: このアプリの版には未搭載（最新版へ更新してください）' : '写真機能: ブラウザ版では診断対象外');
    }
    const diag = readDiag();
    if (diag.length) lines.push(...diag.slice(0, 5).map((d) => `記録: ${d}`));
    setPhotoDiag(lines);
  }

  // ===== オフライン診断（機内モードで白画面になる問題の切り分け用） =====
  const [swDiag, setSwDiag] = useState<string[] | null>(null);
  async function runSwDiag() {
    const lines: string[] = [];
    if (!('serviceWorker' in navigator)) {
      lines.push('オフライン機能: この環境では利用できません');
    } else {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        lines.push(`オフライン機能の登録: ${regs.length > 0 ? '済み' : 'まだ（オンラインで開き直してください）'}`);
        lines.push(`この画面を制御中: ${navigator.serviceWorker.controller ? 'はい（オフライン表示OK）' : 'いいえ（アプリを完全終了→オンラインでもう一度開くと有効になります）'}`);
      } catch (e) {
        lines.push(`オフライン機能の確認に失敗: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    try {
      if ('caches' in window) {
        const has = await caches.has('bl-shell-v2');
        if (has) {
          const c = await caches.open('bl-shell-v2');
          lines.push(`オフライン用キャッシュ: ${(await c.keys()).length}件`);
        } else {
          lines.push('オフライン用キャッシュ: なし（オンラインで開き直すと作られます）');
        }
      }
    } catch { lines.push('キャッシュの確認に失敗しました'); }
    setSwDiag(lines);
  }

  // ===== Apple ヘルスケア連携 =====
  const [healthOn, setHealthOn] = useState(false);   // 連携ON/OFF
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthMsg, setHealthMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => { setHealthOn(isHealthEnabled()); }, []);

  // トグルは待たずに即切替（Appleの許可画面は裏で出す＝固まらない）
  function toggleHealth(on: boolean) {
    setHealthMsg(null);
    setHealthOn(on);
    setHealthEnabled(on);
    if (on) {
      // 各ネイティブ呼び出しを個別に必ず結果が返る形でテストし、どこで固まるか可視化
      setHealthMsg({ cls: 'ok', text: '診断を開始します…' });
      healthSelfTest((msg) => setHealthMsg({ cls: 'ok', text: msg }));
    } else {
      setHealthMsg({ cls: 'ok', text: 'ヘルスケア連携をオフにしました。' });
    }
  }

  // ヘルスケア↔BodyLog を今すぐ双方向同期
  async function syncHealthNow() {
    setHealthBusy(true); setHealthMsg(null);
    // 何が起きても25秒で必ず解除（ネットワーク/プラグイン無応答でも固まらない）
    const safety = setTimeout(() => {
      setHealthBusy(false);
      setHealthMsg({ cls: 'err', text: '同期がタイムアウトしました。通信状況を確認して、もう一度お試しください。' });
    }, 25000);
    try {
      const supabase = createClient();
      // getUser()はネットワーク必須で固まり得るため、ローカルのgetSession()を使う
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!user) { setHealthMsg({ cls: 'err', text: 'ログインが必要です。' }); return; }
      const d = todayJST();

      // ① ヘルスケア → BodyLog（最新の体重/体脂肪/ウエストを今日の記録として取り込み）
      const latest = await healthPullLatest();
      let pulled = 0;
      if (latest && (latest.weight != null || latest.waist != null)) {
        const log: Partial<LogRow> = {};
        if (latest.weight != null) log.weight = Math.round(latest.weight * 10) / 10;
        if (latest.waist != null) log.waist = Math.round(latest.waist * 10) / 10;
        const row = { user_id: user.id, date: d, items: [], kcal: null, ...log, text: 'ヘルスケアから取り込み' };
        let { error } = await supabase.from('logs').insert(row);
        if (error && /waist/i.test(error.message)) {
          const { waist: _w, ...noWaist } = row as Record<string, unknown>;
          ({ error } = await supabase.from('logs').insert(noWaist));
        }
        if (!error) pulled = 1;
      }

      // ② BodyLog → ヘルスケア（今日のサマリーを書き出し）
      const { data: logs } = await supabase.from('logs').select('*').eq('date', d).order('at', { ascending: true });
      const s = summarizeDay((logs as LogRow[]) || []);
      const pushed = await healthPushDay({
        date: d,
        weight: s.weight, waist: s.waist,
        energy: s.intake, protein: s.p, fat: s.f, carbs: s.c,
      });

      setHealthMsg({ cls: 'ok', text: `同期しました。取り込み ${pulled} 件 ／ 書き出し ${pushed} 項目（今日）。` });
    } catch (e) {
      setHealthMsg({ cls: 'err', text: '同期に失敗しました: ' + (e instanceof Error ? e.message : String(e)) });
    } finally {
      clearTimeout(safety);
      setHealthBusy(false);
    }
  }

  // ヘルスケアの過去データ（体重・ウエスト全期間）を一括取り込み
  async function importHealthHistory() {
    setHealthBusy(true); setHealthMsg(null);
    const safety = setTimeout(() => { setHealthBusy(false); setHealthMsg({ cls: 'err', text: '取込がタイムアウトしました。' }); }, 45000);
    try {
      const hist = await healthPullHistory();
      if (!hist) { setHealthMsg({ cls: 'err', text: 'ヘルスケアから取得できませんでした。連携を有効にして許可してください。' }); return; }
      // ISO時刻→JSTの日付(yyyy-mm-dd)
      const jstDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
      // 日付ごとに最新の体重/ウエストへ集約（samplesは昇順なので後勝ち＝その日の最後の値）
      const byDate = new Map<string, { weight?: number; waist?: number }>();
      for (const s of hist.weight) { const d = jstDate(s.date); byDate.set(d, { ...byDate.get(d), weight: Math.round(s.value * 10) / 10 }); }
      for (const s of hist.waist) { const d = jstDate(s.date); byDate.set(d, { ...byDate.get(d), waist: Math.round(s.value * 10) / 10 }); }
      if (byDate.size === 0) { setHealthMsg({ cls: 'ok', text: 'ヘルスケアに体重・ウエストの記録がありませんでした。' }); return; }

      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!user) { setHealthMsg({ cls: 'err', text: 'ログインが必要です。' }); return; }

      // entries（日次サマリー）へ直接upsert＝ダッシュボードの体重グラフ/カレンダーに即反映
      const rows = [...byDate.entries()].map(([date, v]) => ({ user_id: user.id, date, weight: v.weight ?? null, waist: v.waist ?? null }));
      let { error } = await supabase.from('entries').upsert(rows, { onConflict: 'user_id,date' });
      if (error && /waist/i.test(error.message)) {
        ({ error } = await supabase.from('entries').upsert(rows.map(({ waist: _w, ...r }) => r), { onConflict: 'user_id,date' }));
      }
      if (error) throw new Error(error.message);
      setHealthMsg({ cls: 'ok', text: `過去データを ${rows.length} 日分 取り込みました。ダッシュボードのグラフ・カレンダーに反映されます。` });
    } catch (e) {
      setHealthMsg({ cls: 'err', text: '取込に失敗: ' + (e instanceof Error ? e.message : String(e)) });
    } finally {
      clearTimeout(safety);
      setHealthBusy(false);
    }
  }

  // 通知設定（リマインドメールのオプトアウト）
  const [mailOptOut, setMailOptOut] = useState(false);
  const [mailMsg, setMailMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);
  async function toggleMail(next: boolean) {
    setMailMsg(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('profiles').update({ mail_opt_out: next }).eq('id', user.id);
    if (error) { setMailMsg({ cls: 'err', text: friendlyError(new Error(error.message), '保存に失敗しました。もう一度お試しください。') }); return; }
    setMailOptOut(next);
    setMailMsg({ cls: 'ok', text: next ? 'リマインドメールを停止しました。' : 'リマインドメールを受け取ります。' });
  }

  // アカウント削除
  const [delConfirm, setDelConfirm] = useState('');
  const [delMsg, setDelMsg] = useState('');
  async function deleteAccount() {
    if (delConfirm !== '削除') return;
    setBusy(true); setDelMsg('');
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      const supabase = createClient();
      await supabase.auth.signOut();
      alert('アカウントを削除しました。ご利用ありがとうございました。');
      router.push('/login');
    } catch (e) {
      setDelMsg(`削除に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // 言語設定
  const [curLang, setCurLang] = useState('ja');
  const [langQuery, setLangQuery] = useState('');
  const [langBusy, setLangBusy] = useState(false);
  const [langMsg, setLangMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    setCurLang(localStorage.getItem(LANG_KEY) || 'ja');
  }, []);
  async function chooseLang(code: string) {
    if (code === 'ja') {
      localStorage.setItem(LANG_KEY, 'ja');
      location.reload();
      return;
    }
    // その場で翻訳テスト（失敗したら切り替えず理由を表示）
    setLangBusy(true); setLangMsg(null);
    try {
      const res = await fetch('/api/i18n', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: code, texts: ['設定', '保存する', '入力', 'ダッシュボード', '目標'] }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok || !j.map || Object.keys(j.map).length === 0) {
        setLangMsg({ cls: 'err', text: friendlyError(new Error(String(j.error || res.status)), '翻訳の初期化に失敗しました。もう一度お試しください。') });
        return;
      }
      localStorage.setItem(LANG_KEY, code);
      location.reload();
    } catch (e) {
      setLangMsg({ cls: 'err', text: `翻訳の初期化に失敗しました: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setLangBusy(false);
    }
  }
  const langHits = langQuery.trim()
    ? LANGS.filter((l) =>
        l.name.toLowerCase().includes(langQuery.toLowerCase()) ||
        l.native.toLowerCase().includes(langQuery.toLowerCase()) ||
        l.code.toLowerCase().includes(langQuery.toLowerCase())
      ).slice(0, 10)
    : LANGS.slice(0, 8);

  // マイ食品の管理は /foods ページへ移動

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (!user) { if (authErr || !navigator.onLine) return; router.push('/login'); return; }
      const { data: prof, error: profErr } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (!prof) { if (profErr || !navigator.onLine) return; router.push('/onboarding'); return; }
      setUserName(prof.display_name || user.email || '');
      setName(prof.display_name || '');
      setSex(prof.sex); setHeight(String(prof.height_cm)); setAge(String(prof.age));
      setLife(String(prof.life_factor));
      setMailOptOut(!!prof.mail_opt_out);
    })();
  }, [router]);

  async function saveProfile() {
    if (Number(age) < 16) {
      setMsg({ cls: 'err', text: '本サービスは16歳以上の方のみご利用いただけます（利用規約 第3条）。' });
      return;
    }
    setBusy(true); setMsg(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('profiles').update({
      display_name: name, sex, height_cm: Number(height), age: Number(age), life_factor: Number(life),
    }).eq('id', user.id);
    setBusy(false);
    setMsg(error ? { cls: 'err', text: friendlyError(new Error(error.message), '保存に失敗しました。もう一度お試しください。') } : { cls: 'ok', text: '保存しました。' });
  }

  // 過去データ一括取込: [{date:'2026-06-27', ex:'通常', adj:0, intake:2855, p:null, f:null, c:null, weight:86.5, mood:'', note:''}]
  async function runImport() {
    setBusy(true); setImportMsg(null);
    try {
      const rows = JSON.parse(importJson);
      if (!Array.isArray(rows)) throw new Error('JSON配列を貼ってください。');
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const payload = rows.map((r: Record<string, unknown>) => ({
        user_id: user.id,
        date: r.date,
        ex: EX_LEVELS.includes(r.ex as typeof EX_LEVELS[number]) ? r.ex : 'オフ',
        adj: Number(r.adj) || 0,
        intake: r.intake == null ? null : Number(r.intake),
        p: r.p == null ? null : Number(r.p),
        f: r.f == null ? null : Number(r.f),
        c: r.c == null ? null : Number(r.c),
        weight: r.weight == null ? null : Number(r.weight),
        mood: String(r.mood || ''), note: String(r.note || ''), food_text: String(r.food_text || ''),
      }));
      const { error } = await supabase.from('entries').upsert(payload, { onConflict: 'user_id,date' });
      if (error) throw new Error(error.message);
      setImportMsg({ cls: 'ok', text: `${payload.length}件を取り込みました。` });
      setImportJson('');
    } catch (e) {
      setImportMsg({ cls: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const bmrPreview = mifflinBMR(sex, 70, Number(height) || 0, Number(age) || 0);

  // ===== ハブ⇄サブ画面の切替（?s=キーで保持・端末の戻るキーにも追従） =====
  const [section, setSection] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setSection(new URLSearchParams(window.location.search).get('s'));
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  function openSection(s: string) {
    setSection(s);
    try { window.history.pushState(null, '', `/settings?s=${s}`); } catch { /* 無視 */ }
  }
  function backToMenu() {
    setSection(null);
    try { window.history.pushState(null, '', '/settings'); } catch { /* 無視 */ }
  }
  const menuLabel = MENU.find((m) => m.key === section)?.label;

  return (
    <AppShell userName={userName}>
      {/* ===== ハブ: メニュー一覧 ===== */}
      {section === null && (
        <div className="card menu-list">
          {MENU.filter((m) => !('native' in m && m.native) || nativeApp).map((m) =>
            'href' in m && m.href ? (
              <a key={m.key} className="menu-row" href={m.href}>
                <span className="menu-ico" style={{ background: m.bg }}>{m.icon}</span>{m.label}<span className="menu-row-arrow">›</span>
              </a>
            ) : (
              <button key={m.key} className={`menu-row ${'danger' in m && m.danger ? 'danger' : ''}`} onClick={() => openSection(m.key)}>
                <span className="menu-ico" style={{ background: m.bg }}>{m.icon}</span>{m.label}<span className="menu-row-arrow">›</span>
              </button>
            ))}
        </div>
      )}

      {section !== null && <BackBar label={`設定${menuLabel ? ` — ${menuLabel}` : ''}`} onClick={backToMenu} />}

      {section === 'profile' && (
      <div className="card">
        <h2>プロフィール</h2>
        <label>表示名</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row3">
          <div>
            <label>性別</label>
            <select value={sex} onChange={(e) => setSex(e.target.value as 'male' | 'female')}>
              <option value="male">男性</option><option value="female">女性</option>
            </select>
          </div>
          <div><label>身長 (cm)</label><input type="number" value={height} onChange={(e) => setHeight(e.target.value)} /></div>
          <div><label>年齢</label><input type="number" value={age} onChange={(e) => setAge(e.target.value)} /></div>
        </div>
        <label>生活係数（デスクワーク中心 1.3）</label>
        <input type="number" step="0.05" value={life} onChange={(e) => setLife(e.target.value)} />
        <p className="muted">※基礎代謝は「最新の体重」で自動計算されます（例: 体重70kgなら約 {Math.round(bmrPreview)} kcal）</p>
        <button className="btn-primary" style={{ marginTop: 10 }} onClick={saveProfile} disabled={busy}>保存</button>
        {msg && <div className={`msg ${msg.cls}`}>{msg.text}</div>}
      </div>
      )}

      {section === 'language' && (
      <div className="card">
        <h2>🌐 言語 / Language</h2>
        <p className="muted">
          現在: <b>{findLang(curLang)?.native ?? '日本語'}</b>。
          選ぶと画面の日本語がAI翻訳で置き換わります（初回のみ翻訳に数秒。以後はキャッシュで即時）。
        </p>
        <label>言語を検索（英語名・現地語名・コード）</label>
        <input value={langQuery} onChange={(e) => setLangQuery(e.target.value)} placeholder="例: English / 한국어 / vi" />
        <div className="chips" style={{ marginTop: 8 }}>
          {langHits.map((l) => (
            <button key={l.code} className="chip" disabled={langBusy}
                    style={curLang === l.code ? { background: 'var(--teal)', color: '#fff' } : undefined}
                    onClick={() => chooseLang(l.code)}>
              {l.native}{l.native !== l.name ? `（${l.name}）` : ''}
            </button>
          ))}
        </div>
        {langBusy && <p className="muted" style={{ marginTop: 6 }}><span className="spin" />翻訳を初期化中…（数秒）</p>}
        {langMsg && <div className={`msg ${langMsg.cls}`}>{langMsg.text}</div>}
        <p className="muted" style={{ marginTop: 6 }}>全{LANGS.length}言語。AIの解析コメントも選択言語で返るようになります。</p>
      </div>
      )}

      {false && (
      <div className="card">
        <h2>🍲 マイ食品登録</h2>
        <p className="muted">
          作り置きや毎日食べるものを登録すると、入力画面のチップから1タップで記録できます。
          自然文＋写真（栄養成分表示の撮影OK）からAIが計算します。
        </p>
        <a className="btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 8 }} href="/foods">マイ食品を登録・管理する</a>
      </div>
      )}

      {section === 'import' && (
      <div className="card">
        <h2>過去データの一括取込（JSON）</h2>
        <p className="muted">
          {'[{"date":"2026-06-27","ex":"通常","adj":0,"intake":2855,"weight":86.5}] のような配列を貼って取り込めます。同じ日付は上書きされます。'}
        </p>
        <textarea value={importJson} onChange={(e) => setImportJson(e.target.value)} placeholder='[{"date":"2026-06-27", ...}]' />
        <button className="btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={runImport} disabled={busy || !importJson.trim()}>取り込む</button>
        {importMsg && <div className={`msg ${importMsg.cls}`}>{importMsg.text}</div>}
      </div>
      )}

      {section === 'notify' && (
      <div className="card">
        <h2>🔔 通知</h2>
        <label className="switch-row">
          <span className="switch-row-txt">3日間記録がないときのリマインドメールを受け取る</span>
          <span className="switch">
            <input type="checkbox" checked={!mailOptOut} onChange={(e) => toggleMail(!e.target.checked)} />
            <span className="track"><span className="thumb" /></span>
          </span>
        </label>
        {mailMsg && <div className={`msg ${mailMsg.cls}`}>{mailMsg.text}</div>}

        {nativeApp && (
          <>
            <label className="switch-row">
              <span className="switch-row-txt">毎日決まった時刻にアプリ通知でリマインド</span>
              <span className="switch">
                <input type="checkbox" checked={remindOn} onChange={(e) => applyReminder(e.target.checked, remindTime)} />
                <span className="track"><span className="thumb" /></span>
              </span>
            </label>
            {remindOn && (
              <div style={{ marginTop: 4 }}>
                <label>通知時刻</label>
                <input type="time" value={remindTime} onChange={(e) => applyReminder(true, e.target.value)} />
              </div>
            )}
            {remindMsg && <div className={`msg ${remindMsg.cls}`}>{remindMsg.text}</div>}
          </>
        )}
      </div>
      )}

      {section === 'health' && nativeApp && (
        <div className="card">
          <h2>❤️ Apple ヘルスケア連携</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            体重・体脂肪率・ウエスト・摂取カロリー・PFC をヘルスケアと双方向で同期します。
            スマート体重計などの記録を取り込み、BodyLogの記録も書き出せます。
          </p>
          <label className="switch-row">
            <span className="switch-row-txt">ヘルスケア連携を有効にする</span>
            <span className="switch">
              <input type="checkbox" checked={healthOn} onChange={(e) => toggleHealth(e.target.checked)} />
              <span className="track"><span className="thumb" /></span>
            </span>
          </label>
          {healthOn && (
            <>
            <button className="btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={syncHealthNow} disabled={healthBusy}>
              {healthBusy ? <><span className="spin" />処理中…</> : '🔄 今すぐ同期（双方向・今日）'}
            </button>
            <button className="btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={importHealthHistory} disabled={healthBusy}>
              📥 過去データを全て取り込む（体重・ウエスト）
            </button>
            </>
          )}
          {healthMsg && <div className={`msg ${healthMsg.cls}`}>{healthMsg.text}</div>}
          <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            連携をオンにすると、記録の保存時に体重・ウエスト・摂取カロリー・PFCが自動でヘルスケアへ書き出されます。
          </p>
        </div>
      )}

      {section === 'diag' && (<>
      <div className="card">
        <h2>📡 オフライン診断</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          機内モード・圏外で画面が表示されない時は、ここで状態を確認できます。
        </p>
        <button className="btn-ghost" style={{ width: '100%' }} onClick={runSwDiag}>診断を実行</button>
        {swDiag && (
          <div className="msg ok" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {swDiag.join('\n')}
          </div>
        )}
      </div>

      {nativeApp && (
        <div className="card">
          <h2>📷 カメラ・写真の診断</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            写真が選べない・カメラが起動しない時は、ここで状態を確認できます。
          </p>
          <button className="btn-ghost" style={{ width: '100%' }} onClick={runPhotoDiag}>診断を実行</button>
          {photoDiag && (
            <div className="msg ok" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {photoDiag.join('\n')}
            </div>
          )}
        </div>
      )}
      </>)}

      {false && (
      <div className="card">
        <h2>📄 規約・ポリシー</h2>
        <p className="muted">
          <a href="/terms">利用規約</a> ／ <a href="/privacy">プライバシーポリシー</a>
        </p>
      </div>
      )}

      {section === 'danger' && (
      <div className="card" style={{ borderColor: 'var(--coral)' }}>
        <h2 style={{ color: 'var(--coral)' }}>⚠ アカウント削除</h2>
        <p className="muted">
          アカウントと全てのデータ（記録・写真・目標・マイ食品）を完全に削除します。<b>この操作は取り消せません。</b>
        </p>
        <label>確認のため「削除」と入力してください</label>
        <input value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} placeholder="削除" />
        <button className="btn-primary" style={{ marginTop: 10, background: 'var(--coral)' }}
                onClick={deleteAccount} disabled={busy || delConfirm !== '削除'}>
          {busy ? <><span className="spin" />削除中…</> : 'アカウントを完全に削除する'}
        </button>
        {delMsg && <div className="msg err">{delMsg}</div>}
      </div>
      )}
    </AppShell>
  );
}
