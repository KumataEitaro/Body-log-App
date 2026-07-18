'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { mifflinBMR, LIFE_FACTOR_DEFAULT, EX_LEVELS } from '@/lib/calc';
import { LANGS, findLang } from '@/lib/langs';
import { LANG_KEY } from '@/components/DomTranslator';

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
    })();
  }, [router]);

  async function saveProfile() {
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
        <h2>マイ食品</h2>
        <p className="muted">作り置き・毎日食べるものの登録は「食品」タブに移動しました。AIチャットで材料を書くだけで登録できます。</p>
        <a className="btn-ghost" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 8 }} href="/foods">🍲 マイ食品ページを開く</a>
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
    </AppShell>
  );
}
