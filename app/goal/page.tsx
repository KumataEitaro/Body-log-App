'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { todayJST } from '@/lib/calc';
import { type Goal, type PlanEvent } from '@/lib/goal';
import { hapticSuccess } from '@/lib/native';

type Profile = { sex: 'male' | 'female'; height_cm: number; age: number; init_weight: number | null; life_factor: number; display_name: string };
type EventRow = PlanEvent & { id: string };

export default function GoalPage() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);

  // 目標フォーム
  const [gDate, setGDate] = useState('');
  const [gWeight, setGWeight] = useState('');
  const [gBf, setGBf] = useState('');
  const [gNote, setGNote] = useState('');
  const [gAbsorb, setGAbsorb] = useState(''); // ''=目標日まで均等 / '7'|'14'|'30'=N日で取り返す
  const [gProtein, setGProtein] = useState('2.0'); // たんぱく質: 体重1kgあたりg
  const [gFat, setGFat] = useState('0.9');         // 脂質: 体重1kgあたりg
  const [gFatMax, setGFatMax] = useState('');      // 脂質の絶対上限(g/日・任意)
  const [goalMsg, setGoalMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);

  // イベントフォーム
  const [evDate, setEvDate] = useState('');
  const [evTitle, setEvTitle] = useState('');
  const [evKcal, setEvKcal] = useState('800');

  const [busy, setBusy] = useState(false);

  const today = todayJST();

  async function loadAll() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (!prof) { router.push('/onboarding'); return; }
    setProfile(prof);
    setUserName(prof.display_name || user.email || '');

    const [{ data: g }, { data: evs }, { data: ws }] = await Promise.all([
      supabase.from('goals').select('*').maybeSingle(),
      supabase.from('events').select('*').order('date', { ascending: true }),
      supabase.from('entries').select('weight').not('weight', 'is', null).order('date', { ascending: false }).limit(1),
    ]);
    if (g) {
      setGoal(g);
      setGDate(g.target_date); setGWeight(g.target_weight != null ? String(g.target_weight) : '');
      setGBf(g.target_bf != null ? String(g.target_bf) : ''); setGNote(g.note || '');
      setGAbsorb(g.absorb_days != null ? String(g.absorb_days) : '');
      if (g.protein_per_kg != null) setGProtein(String(g.protein_per_kg));
      if (g.fat_per_kg != null) setGFat(String(g.fat_per_kg));
      if (g.fat_max_g != null) setGFatMax(String(g.fat_max_g));
    }
    setEvents((evs as EventRow[]) || []);
    if (ws && ws.length) setLatestWeight(Number(ws[0].weight));
  }

  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function saveGoal() {
    if (!gDate || !gWeight) { setGoalMsg({ cls: 'err', text: '目標日と目標体重は必須です。' }); return; }
    setBusy(true); setGoalMsg(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const startWeight = goal?.start_weight ?? latestWeight ?? Number(profile?.init_weight) ?? 0;
    const base = {
      user_id: user.id,
      target_date: gDate,
      target_weight: Number(gWeight),
      target_bf: gBf === '' ? null : Number(gBf),
      note: gNote,
      start_date: goal?.start_date ?? today,
      start_weight: startWeight,
      absorb_days: gAbsorb === '' ? null : Number(gAbsorb),
      updated_at: new Date().toISOString(),
    };
    let { error } = await supabase.from('goals').upsert({
      ...base,
      protein_per_kg: Number(gProtein) || null,
      fat_per_kg: Number(gFat) || null,
      fat_max_g: gFatMax === '' ? null : Number(gFatMax) || null,
    });
    // DB未更新（PFC列がまだ無い）環境ではPFC抜きで保存
    if (error && /protein_per_kg|fat_per_kg|fat_max_g|column|schema/.test(error.message)) {
      ({ error } = await supabase.from('goals').upsert(base));
    }
    setBusy(false);
    if (error) { setGoalMsg({ cls: 'err', text: error.message }); return; }
    hapticSuccess();
    const isFirstGoal = !goal;
    await loadAll();
    if (isFirstGoal) {
      // 初回セットアップの流れ: プロフィール→目標→入力へ
      router.push('/log');
      return;
    }
    setGoalMsg({ cls: 'ok', text: '目標を保存し、計画を再計算しました（必要赤字・摂取カロリー目標・入力画面の🎯行に反映済み）。' });
  }

  async function addEvent() {
    if (!evDate) return;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('events').insert({
      user_id: user.id, date: evDate, title: evTitle || '飲み会', extra_kcal: Number(evKcal) || 800,
    });
    setEvDate(''); setEvTitle(''); setEvKcal('800');
    await loadAll();
  }
  async function delEvent(id: string) {
    const supabase = createClient();
    await supabase.from('events').delete().eq('id', id);
    await loadAll();
  }

  const futureEvents = events.filter((e) => e.date >= today);

  return (
    <AppShell userName={userName}>
      {goal ? (
        <p className="muted" style={{ margin: '0 0 10px' }}>
          進捗（標準進捗 vs 実績・グラフ）は<Link href="/dashboard">ダッシュボード</Link>、日々の入力（食事・体重・写真）は<Link href="/log">入力タブ</Link>。ここでは目標とチートデイを設定します。
        </p>
      ) : (
        <div className="msg ok" style={{ marginTop: 0 }}>
          🎯 ステップ2/2: 目標を設定しましょう（いつまでに何kg）。設定すると毎日の摂取カロリー計画と進捗グラフが自動で作られます。あとから変更もできます。
        </div>
      )}

      {/* ===== 目標設定 ===== */}
      <div className="card">
        <h2>🎯 目標</h2>
        <div className="row2">
          <div><label>目標日</label><input type="date" value={gDate} onChange={(e) => setGDate(e.target.value)} /></div>
          <div><label>目標体重 (kg)</label><input type="number" step="0.1" className="num" value={gWeight} onChange={(e) => setGWeight(e.target.value)} /></div>
        </div>
        <div className="row2">
          <div><label>目標体脂肪率 (%) 任意</label><input type="number" step="0.5" className="num" value={gBf} onChange={(e) => setGBf(e.target.value)} /></div>
          <div><label>なりたい姿（自由記述）</label><input value={gNote} onChange={(e) => setGNote(e.target.value)} placeholder="例）腹筋を割りたい" /></div>
        </div>
        <div className="row2">
          <div>
            <label>たんぱく質目標（体重1kgあたり g）</label>
            <input type="number" step="0.1" className="num" value={gProtein} onChange={(e) => setGProtein(e.target.value)} placeholder="2.0" />
          </div>
          <div>
            <label>脂質目標（体重1kgあたり g）</label>
            <input type="number" step="0.1" className="num" value={gFat} onChange={(e) => setGFat(e.target.value)} placeholder="0.9" />
          </div>
        </div>
        <label>脂質の1日上限（g・任意）</label>
        <input type="number" step="1" className="num" value={gFatMax} onChange={(e) => setGFatMax(e.target.value)}
               placeholder="例: 50（体重×係数より低い場合はこちらが目標に）" />
        <p className="muted" style={{ margin: '4px 0 0' }}>
          炭水化物は自動計算（計画カロリー − P×4kcal − F×9kcal の残り）。減量中の目安: P 1.6〜2.2 ／ F 0.8〜1.0
        </p>
        <label>チートデイ超過の取り返し方</label>
        <select value={gAbsorb} onChange={(e) => setGAbsorb(e.target.value)}>
          <option value="">目標日まで均等でならす（先回りで貯金するタイプ）</option>
          <option value="7">チートデイ後7日で取り返す（おすすめ・翌週集中型）</option>
          <option value="14">チートデイ後14日で取り返す（ゆるやか型）</option>
          <option value="30">チートデイ後30日で取り返す（超ゆるやか型）</option>
        </select>
        {goal && <p className="muted">開始: {goal.start_date}（{goal.start_weight}kg）から計測中。目標を変えても開始点は維持されます。</p>}
        <button className="btn-primary" style={{ marginTop: 10 }} onClick={saveGoal} disabled={busy}>目標を保存</button>
        {goalMsg && <div className={`msg ${goalMsg.cls}`}>{goalMsg.text}</div>}
      </div>

      {/* ===== チートデイ設定 ===== */}
      <div className="card">
        <h2>🍺 チートデイ設定</h2>
        <p className="muted">
          飲み会・外食など「食べる日」を先に登録しておくと、その超過分を計画に織り込みます。
          取り返し方は上の目標設定で選べます（目標日まで均等 or 後◯日で集中回収）。
        </p>
        {futureEvents.map((e) => (
          <div className="feed-row" key={e.id}>
            <div className="feed-time num">{e.date.slice(5)}</div>
            <div className="feed-body">🍺 {e.title} <span className="muted">見込み +{Number(e.extra_kcal).toLocaleString()}kcal</span></div>
            <button className="item-del" onClick={() => delEvent(e.id)}>×</button>
          </div>
        ))}
        <div className="row3" style={{ marginTop: 8 }}>
          <div><label>日付</label><input type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)} /></div>
          <div><label>名前</label><input value={evTitle} onChange={(e) => setEvTitle(e.target.value)} placeholder="飲み会" /></div>
          <div><label>見込み超過kcal</label><input type="number" className="num" value={evKcal} onChange={(e) => setEvKcal(e.target.value)} /></div>
        </div>
        <button className="btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={addEvent} disabled={busy || !evDate}>チートデイを追加</button>
      </div>

      <p className="muted">📸 体写真のアップ（体脂肪率のAI判定）は<Link href="/log">入力タブ</Link>に移動しました。</p>
    </AppShell>
  );
}
