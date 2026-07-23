'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { mifflinBMR, LIFE_FACTOR_DEFAULT, EX_LEVELS, todayJST } from '@/lib/calc';
import { LANGS, findLang } from '@/lib/langs';
import { LANG_KEY } from '@/components/DomTranslator';
import { getIsNative, setDailyReminder } from '@/lib/native';
import { healthAvailable, healthRequestAuth, isHealthEnabled, setHealthEnabled, healthPullLatest, healthPushDay } from '@/lib/health';
import { summarizeDay, type LogRow } from '@/lib/day';

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
    const ok = await setDailyReminder(on, h, m);
    if (on && !ok) {
      setRemindMsg({ cls: 'err', text: '通知が許可されていません。iOSの設定 > BodyLog > 通知 を許可してください。' });
      return;
    }
    setRemindOn(on); setRemindTime(time);
    localStorage.setItem('bodylog-reminder', JSON.stringify({ on, time }));
    setRemindMsg({ cls: 'ok', text: on ? `毎日 ${time} にアプリ通知でお知らせします。` : 'アプリ通知を停止しました。' });
  }

  // ===== Apple ヘルスケア連携 =====
  const [healthOK, setHealthOK] = useState(false);   // 端末でヘルスケアが使えるか
  const [healthOn, setHealthOn] = useState(false);   // 連携ON/OFF
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthMsg, setHealthMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => { healthAvailable().then((ok) => { setHealthOK(ok); setHealthOn(isHealthEnabled()); }); }, []);

  async function toggleHealth(on: boolean) {
    setHealthMsg(null);
    if (on) {
      setHealthBusy(true);
      const granted = await healthRequestAuth();
      setHealthBusy(false);
      if (!granted) {
        setHealthMsg({ cls: 'err', text: 'ヘルスケアの許可が下りませんでした。iPhoneの「設定 > プライバシーとセキュリティ > ヘルスケア > BodyLog」で項目をオンにしてください。' });
        return;
      }
      setHealthEnabled(true); setHealthOn(true);
      setHealthMsg({ cls: 'ok', text: 'ヘルスケア連携をオンにしました。保存時に自動で書き出し、下のボタンで取り込みできます。' });
    } else {
      setHealthEnabled(false); setHealthOn(false);
      setHealthMsg({ cls: 'ok', text: 'ヘルスケア連携をオフにしました。' });
    }
  }

  // ヘルスケア↔BodyLog を今すぐ双方向同期
  async function syncHealthNow() {
    setHealthBusy(true); setHealthMsg(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
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
    if (error) { setMailMsg({ cls: 'err', text: `保存に失敗しました: ${error.message}` }); return; }
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
        setLangMsg({ cls: 'err', text: `翻訳の初期化に失敗しました: ${j.error || `HTTP ${res.status}`}` });
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (!prof) { router.push('/onboarding'); return; }
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
    setMsg(error ? { cls: 'err', text: error.message } : { cls: 'ok', text: '保存しました。' });
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

  return (
    <AppShell userName={userName}>
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

      <div className="card">
        <h2>🍲 マイ食品登録</h2>
        <p className="muted">
          作り置きや毎日食べるものを登録すると、入力画面のチップから1タップで記録できます。
          自然文＋写真（栄養成分表示の撮影OK）からAIが計算します。
        </p>
        <a className="btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 8 }} href="/foods">マイ食品を登録・管理する</a>
      </div>

      <div className="card">
        <h2>過去データの一括取込（JSON）</h2>
        <p className="muted">
          {'[{"date":"2026-06-27","ex":"通常","adj":0,"intake":2855,"weight":86.5}] のような配列を貼って取り込めます。同じ日付は上書きされます。'}
        </p>
        <textarea value={importJson} onChange={(e) => setImportJson(e.target.value)} placeholder='[{"date":"2026-06-27", ...}]' />
        <button className="btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={runImport} disabled={busy || !importJson.trim()}>取り込む</button>
        {importMsg && <div className={`msg ${importMsg.cls}`}>{importMsg.text}</div>}
      </div>

      <div className="card">
        <h2>🔔 通知</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14.5, color: 'var(--ink)', fontWeight: 400, margin: 0 }}>
          <input type="checkbox" checked={!mailOptOut} onChange={(e) => toggleMail(!e.target.checked)}
                 style={{ width: 20, height: 20, minHeight: 0 }} />
          3日間記録がないときのリマインドメールを受け取る
        </label>
        {mailMsg && <div className={`msg ${mailMsg.cls}`}>{mailMsg.text}</div>}

        {nativeApp && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14.5, color: 'var(--ink)', fontWeight: 400, margin: 0 }}>
              <input type="checkbox" checked={remindOn} onChange={(e) => applyReminder(e.target.checked, remindTime)}
                     style={{ width: 20, height: 20, minHeight: 0 }} />
              毎日決まった時刻にアプリ通知でリマインド
            </label>
            {remindOn && (
              <div style={{ marginTop: 8 }}>
                <label>通知時刻</label>
                <input type="time" value={remindTime} onChange={(e) => applyReminder(true, e.target.value)} />
              </div>
            )}
            {remindMsg && <div className={`msg ${remindMsg.cls}`}>{remindMsg.text}</div>}
          </div>
        )}
      </div>

      {healthOK && (
        <div className="card">
          <h2>❤️ Apple ヘルスケア連携</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            体重・体脂肪率・ウエスト・摂取カロリー・PFC をヘルスケアと双方向で同期します。
            スマート体重計などの記録を取り込み、BodyLogの記録も書き出せます。
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14.5, color: 'var(--ink)', fontWeight: 400, margin: 0 }}>
            <input type="checkbox" checked={healthOn} disabled={healthBusy} onChange={(e) => toggleHealth(e.target.checked)}
                   style={{ width: 20, height: 20, minHeight: 0 }} />
            ヘルスケア連携を有効にする
          </label>
          {healthOn && (
            <button className="btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={syncHealthNow} disabled={healthBusy}>
              {healthBusy ? <><span className="spin" />同期中…</> : '🔄 今すぐ同期（双方向）'}
            </button>
          )}
          {healthMsg && <div className={`msg ${healthMsg.cls}`}>{healthMsg.text}</div>}
          <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            連携をオンにすると、記録の保存時に体重・ウエスト・摂取カロリー・PFCが自動でヘルスケアへ書き出されます。
          </p>
        </div>
      )}

      <div className="card">
        <h2>📄 規約・ポリシー</h2>
        <p className="muted">
          <a href="/terms">利用規約</a> ／ <a href="/privacy">プライバシーポリシー</a>
        </p>
      </div>

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
    </AppShell>
  );
}
