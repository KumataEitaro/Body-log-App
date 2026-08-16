'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { cacheGet } from '@/lib/cache';
import { friendlyError } from '@/lib/errmsg';
import { hapticSuccess } from '@/lib/native';
import { trainingSeries } from '@/lib/training';

// 筋トレ重量目標の設定画面。種目×目標重量（×目標日）を複数登録し、
// トレタブの記録から現在ベストを自動算出して進捗表示。トレタブのグラフには目標線が引かれる。

type TGoal = { id: string; name: string; target_kg: number; target_date: string | null };

export default function TrainingGoalPage() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [tGoals, setTGoals] = useState<TGoal[]>([]);
  const [tableMissing, setTableMissing] = useState(false);
  const [bests, setBests] = useState<Map<string, number>>(new Map());
  const [names, setNames] = useState<string[]>([]); // 記録済み種目（入力候補）
  const [gName, setGName] = useState('');
  const [gKg, setGKg] = useState('');
  const [gDate, setGDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) { router.push('/login'); return; }
      const h = cacheGet<{ userName: string }>(`loghdr:${uid}`);
      if (h?.userName) setUserName(h.userName);
      const [tgRes, histRes] = await Promise.all([
        supabase.from('training_goals').select('id,name,target_kg,target_date').order('created_at', { ascending: true }),
        supabase.from('logs').select('date,text').like('text', '🏋️%').order('at', { ascending: false }).limit(200),
      ]);
      if (tgRes.error) {
        if (/training_goals|does not exist|schema cache/i.test(tgRes.error.message)) setTableMissing(true);
      } else {
        setTGoals((tgRes.data as TGoal[]) || []);
      }
      const series = trainingSeries((histRes.data as { date: string; text: string }[]) || []);
      const b = new Map<string, number>();
      for (const [name, pts] of series) b.set(name, Math.max(...pts.map((p) => p.maxKg)));
      setBests(b);
      setNames([...series.keys()]);
    })();
  }, [router]);

  async function addGoal() {
    const name = gName.trim();
    const kg = Number(gKg);
    if (!name || !(kg > 0)) { setMsg({ cls: 'err', text: '種目名と目標重量(kg)を入力してください。' }); return; }
    setBusy(true); setMsg(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { data, error } = await supabase.from('training_goals')
        .upsert({ user_id: uid, name, target_kg: kg, target_date: gDate || null }, { onConflict: 'user_id,name' })
        .select('id,name,target_kg,target_date').single();
      if (error) { setMsg({ cls: 'err', text: friendlyError(new Error(error.message), '保存に失敗しました。もう一度お試しください。') }); return; }
      hapticSuccess();
      setTGoals((prev) => [...prev.filter((g) => g.name !== name), data as TGoal]);
      setMsg({ cls: 'ok', text: `「${name} ${kg}kg」を目標に設定しました。トレタブのグラフに目標線が表示されます。` });
      setGName(''); setGKg(''); setGDate('');
    } finally {
      setBusy(false);
    }
  }

  async function removeGoal(id: string) {
    const supabase = createClient();
    await supabase.from('training_goals').delete().eq('id', id);
    setTGoals((prev) => prev.filter((g) => g.id !== id));
  }

  return (
    <AppShell userName={userName}>
      <p style={{ margin: '0 0 10px' }}><Link href="/goal" className="muted">‹ 目標一覧へ</Link></p>

      {tableMissing && (
        <div className="card" style={{ border: '1.5px solid var(--amber)' }}>
          <h2>🛠 初回セットアップが必要です</h2>
          <p className="muted">
            筋トレ目標の保存用テーブルがまだデータベースにありません。
            SupabaseのSQL Editorで <b>supabase/apply-pending.sql</b> を1回実行すると使えるようになります（保留中の他の更新もまとめて適用されます）。
          </p>
        </div>
      )}

      <div className="card">
        <h2>🏋️ 筋トレ重量の目標</h2>
        {tGoals.length === 0 && !tableMissing && (
          <p className="muted">まだ目標がありません。下のフォームから追加しましょう（例: ベンチプレス 100kg）。</p>
        )}
        {tGoals.map((tg) => {
          const best = bests.get(tg.name) ?? 0;
          const pct = Math.min(100, Math.round((best / Number(tg.target_kg)) * 100));
          return (
            <div key={tg.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13.5, fontWeight: 700 }}>
                <span>{tg.name}{pct >= 100 && ' 🎉達成!'}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="num">{best > 0 ? `ベスト ${best}` : '記録なし'} / {Number(tg.target_kg)}kg（{pct}%）</span>
                  <button className="item-del" onClick={() => removeGoal(tg.id)} title="この目標を削除">×</button>
                </span>
              </div>
              <div className="hub-bar big"><i style={{ width: `${pct}%` }} /></div>
              {tg.target_date && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{tg.target_date}まで</div>}
            </div>
          );
        })}
      </div>

      {!tableMissing && (
        <div className="card">
          <h2>＋ 目標を追加</h2>
          <label>種目名</label>
          <input list="ex-names" value={gName} onChange={(e) => setGName(e.target.value)} placeholder="ベンチプレス" />
          <datalist id="ex-names">
            {names.map((n) => <option key={n} value={n} />)}
          </datalist>
          <div className="row2">
            <div><label>目標重量(kg)</label><input type="number" inputMode="decimal" className="num" value={gKg} onChange={(e) => setGKg(e.target.value)} placeholder="100" /></div>
            <div><label>目標日（任意）</label><input type="date" value={gDate} onChange={(e) => setGDate(e.target.value)} /></div>
          </div>
          {msg && <div className={`msg ${msg.cls}`}>{msg.text}</div>}
          <button className="btn-primary" style={{ marginTop: 10 }} onClick={addGoal} disabled={busy}>
            {busy ? <><span className="spin" />保存中…</> : '目標を保存する'}
          </button>
        </div>
      )}
    </AppShell>
  );
}
