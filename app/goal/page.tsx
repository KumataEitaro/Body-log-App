'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { todayJST } from '@/lib/calc';
import { cacheGet } from '@/lib/cache';
import { progressStatus, type Goal } from '@/lib/goal';
import { trainingSeries } from '@/lib/training';

// 目標タブのハブ画面。体重変化目標と筋トレ重量目標の2枚のカードから各詳細へ分岐する。

type TGoal = { id: string; name: string; target_kg: number; target_date: string | null };

export default function GoalHubPage() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [goal, setGoal] = useState<Goal | null>(null);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [tGoals, setTGoals] = useState<TGoal[] | null>(null); // null=テーブル未作成 or 読込前
  const [bests, setBests] = useState<Map<string, number>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) { router.push('/login'); return; }
      const h = cacheGet<{ userName: string }>(`loghdr:${uid}`);
      if (h?.userName) setUserName(h.userName);
      const [gRes, wRes, tgRes, histRes] = await Promise.all([
        supabase.from('goals').select('*').maybeSingle(),
        supabase.from('entries').select('weight,date').not('weight', 'is', null).order('date', { ascending: false }).limit(1),
        supabase.from('training_goals').select('id,name,target_kg,target_date').order('created_at', { ascending: true }),
        supabase.from('logs').select('date,text').like('text', '🏋️%').order('at', { ascending: false }).limit(200),
      ]);
      if (gRes.data) setGoal(gRes.data);
      if (wRes.data?.length) setLatestWeight(Number(wRes.data[0].weight));
      setTGoals(tgRes.error ? null : ((tgRes.data as TGoal[]) || []));
      const series = trainingSeries((histRes.data as { date: string; text: string }[]) || []);
      const b = new Map<string, number>();
      for (const [name, pts] of series) b.set(name, Math.max(...pts.map((p) => p.maxKg)));
      setBests(b);
      setLoaded(true);
    })();
  }, [router]);

  const status = goal && latestWeight != null ? progressStatus(goal, todayJST(), latestWeight) : null;

  return (
    <AppShell userName={userName}>
      {/* 体重変化目標 */}
      <Link href="/goal/weight" style={{ display: 'block', color: 'inherit' }}>
        <div className="card hub-card">
          <h2>🎯 体重変化の目標<span className="hub-arrow">›</span></h2>
          {goal ? (
            <>
              <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="stat"><div className="stat-l">目標</div>
                  <div className="stat-v num">{Number(goal.target_weight).toFixed(1)}<small> kg</small></div></div>
                <div className="stat"><div className="stat-l">現在</div>
                  <div className="stat-v num">{latestWeight != null ? latestWeight.toFixed(1) : '—'}<small> kg</small></div></div>
              </div>
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
                {goal.target_date}まで
                {status && (status.state === 'ahead' ? ` ・ ${Math.abs(status.diffDays)}日先行 🎉` : status.state === 'behind' ? ` ・ ${Math.abs(status.diffDays)}日遅れ` : ' ・ 順調 👍')}
                {latestWeight != null && ` ・ あと${Math.max(0, latestWeight - Number(goal.target_weight)).toFixed(1)}kg`}
              </p>
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>{loaded ? '未設定 — タップして「いつまでに何kg」を決めましょう' : '読み込み中…'}</p>
          )}
        </div>
      </Link>

      {/* 筋トレ重量目標 */}
      <Link href="/goal/training" style={{ display: 'block', color: 'inherit' }}>
        <div className="card hub-card">
          <h2>🏋️ 筋トレ重量の目標<span className="hub-arrow">›</span></h2>
          {tGoals === null && loaded && (
            <p className="muted" style={{ margin: 0 }}>初回セットアップが必要です — タップして手順を確認</p>
          )}
          {tGoals !== null && tGoals.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>{loaded ? '未設定 — タップして種目と目標重量を決めましょう' : '読み込み中…'}</p>
          )}
          {tGoals !== null && tGoals.slice(0, 3).map((tg) => {
            const best = bests.get(tg.name) ?? 0;
            const pct = Math.min(100, Math.round((best / Number(tg.target_kg)) * 100));
            return (
              <div key={tg.id} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 700 }}>
                  <span>{tg.name}{pct >= 100 && ' 🎉'}</span>
                  <span className="num">{best > 0 ? best : '—'} / {Number(tg.target_kg)}kg</span>
                </div>
                <div className="hub-bar"><i style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
          {tGoals !== null && tGoals.length > 3 && <p className="muted" style={{ margin: 0, fontSize: 11 }}>ほか{tGoals.length - 3}件</p>}
        </div>
      </Link>
    </AppShell>
  );
}
