'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { mifflinBMR, targetKcal, judge, verdictClass, FAT_KCAL_PER_KG, WEEKLY_STD, todayJST, type ExLevel, type Verdict } from '@/lib/calc';
import { progressStatus, computePlan, type Goal, type PlanEvent } from '@/lib/goal';
import WeightChart, { type ChartEvent, type BfPoint } from '@/components/WeightChart';
import CumChart from '@/components/CumChart';
import Link from 'next/link';
import { cacheGet, cacheSet } from '@/lib/cache';
import { reviewMaintenance, lifeFactorFor, REVIEW_INTERVAL_DAYS, type MaintReview } from '@/lib/adaptive';

type Row = {
  date: string; label: string; day: string; ex: ExLevel; adj: number;
  intake: number | null; weight: number | null;
  target: number; diff: number | null; verdict: Verdict | null;
};

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

type Kpi = {
  latestWeight: number | null; weightDelta: number | null;
  sum7: number; std7: number; range7: string;
  sumAll: number; fatKg: number; rangeAll: string; base: number; bmr: number;
};

export default function DashboardPage() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [events, setEvents] = useState<(ChartEvent & PlanEvent)[]>([]);
  const [bfPoints, setBfPoints] = useState<BfPoint[]>([]);
  // 2週間ごとのメンテナンスカロリー見直し提案
  const [maintCard, setMaintCard] = useState<{ review: Exclude<MaintReview, { status: 'insufficient' }>; base: number; bmr: number; uid: string } | null>(null);
  const [maintBusy, setMaintBusy] = useState(false);

  type DashCache = {
    userName: string; rows: Row[]; kpi: Kpi;
    goal: Goal | null; events: (ChartEvent & PlanEvent)[]; bfPoints: BfPoint[];
  };

  useEffect(() => {
    (async () => {
      const supabase = createClient();

      // ① キャッシュを即表示（起動直後・オフラインでも前回のダッシュボードが見える）
      const { data: { session } } = await supabase.auth.getSession();
      const cachedUid = session?.user?.id;
      if (cachedUid) {
        const c = cacheGet<DashCache>(`dash:${cachedUid}`);
        if (c) {
          setUserName(c.userName); setRows(c.rows); setKpi(c.kpi);
          setGoal(c.goal); setEvents(c.events || []); setBfPoints(c.bfPoints || []);
        }
      }

      // ② 裏で最新を取得して差し替え
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!navigator.onLine && cachedUid) return; // オフラインはキャッシュ表示のまま
        router.push('/login'); return;
      }
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (!prof) { if (!navigator.onLine) return; router.push('/onboarding'); return; }
      setUserName(prof.display_name || user.email || '');

      const [{ data: entries }, { data: g }, { data: evs }, { data: phs }] = await Promise.all([
        supabase.from('entries').select('*').order('date', { ascending: true }),
        supabase.from('goals').select('*').maybeSingle(),
        supabase.from('events').select('id,date,title,extra_kcal').order('date', { ascending: true }),
        supabase.from('body_photos').select('date,bf_est').not('bf_est', 'is', null).order('date', { ascending: true }),
      ]);
      // オフライン等でentriesが取れなかった場合はキャッシュ表示を維持
      if (entries === null && !navigator.onLine) return;
      if (g) setGoal(g);
      const evList = (evs as (ChartEvent & PlanEvent)[]) || [];
      const bfList = ((phs as { date: string; bf_est: number }[]) || []).map((p) => ({ date: p.date, bf: Number(p.bf_est) }));
      setEvents(evList);
      setBfPoints(bfList);
      const list = entries || [];

      // 体重の直近値をBMRに反映（さかのぼって最後に記録された体重を使う）
      let runningWeight: number = Number(prof.init_weight) || 70;
      const computed: Row[] = list.map((e) => {
        if (e.weight != null) runningWeight = Number(e.weight);
        const bmr = mifflinBMR(prof.sex, runningWeight, Number(prof.height_cm), Number(prof.age));
        const target = targetKcal(bmr, Number(prof.life_factor), e.ex as ExLevel, Number(e.adj) || 0);
        const intake = e.intake == null ? null : Number(e.intake);
        const diff = intake == null ? null : Math.round((intake - target) * 10) / 10;
        const d = new Date(e.date + 'T00:00:00');
        return {
          date: e.date, label: `${d.getMonth() + 1}/${d.getDate()}`, day: DOW[d.getDay()],
          ex: e.ex as ExLevel, adj: Number(e.adj) || 0,
          intake, weight: e.weight == null ? null : Number(e.weight),
          target, diff, verdict: diff == null ? null : judge(diff),
        };
      });
      setRows(computed);

      const withDiff = computed.filter((r) => r.diff != null) as (Row & { diff: number })[];
      const last7 = withDiff.slice(-7);
      const sum7 = Math.round(last7.reduce((a, r) => a + r.diff, 0));
      const sumAll = Math.round(withDiff.reduce((a, r) => a + r.diff, 0));
      const weights = computed.filter((r) => r.weight != null) as (Row & { weight: number })[];
      const latestWeight = weights.length ? weights[weights.length - 1].weight : null;
      const firstWeight = weights.length ? weights[0].weight : null;
      const bmrNow = mifflinBMR(prof.sex, latestWeight ?? Number(prof.init_weight) ?? 70, Number(prof.height_cm), Number(prof.age));
      const kpiObj: Kpi = {
        latestWeight,
        weightDelta: latestWeight != null && firstWeight != null ? Math.round((latestWeight - firstWeight) * 10) / 10 : null,
        sum7, std7: sum7 - WEEKLY_STD,
        range7: last7.length ? `${last7[0].label}〜${last7[last7.length - 1].label}` : '',
        sumAll, fatKg: Math.round((sumAll / FAT_KCAL_PER_KG) * 100) / 100,
        rangeAll: withDiff.length ? `${withDiff[0].label}〜${withDiff[withDiff.length - 1].label}` : '',
        base: Math.round(bmrNow * Number(prof.life_factor)),
        bmr: Math.round(bmrNow),
      };
      setKpi(kpiObj);
      // 次回起動を即表示にするためキャッシュ保存
      cacheSet(`dash:${user.id}`, {
        userName: prof.display_name || user.email || '',
        rows: computed, kpi: kpiObj, goal: g ?? null, events: evList, bfPoints: bfList,
      } satisfies DashCache);

      // ===== 2週間ごとのメンテナンスカロリー見直し =====
      try {
        const today = todayJST();
        const key = `blmr:${user.id}`;
        let last: string | null = null;
        try { last = (JSON.parse(localStorage.getItem(key) || 'null') as { last?: string } | null)?.last ?? null; } catch { /* 無視 */ }
        if (!last && computed.length > 0) {
          // 初回は「記録開始日」を起点にする（すでに14日分あれば即提案される）
          last = computed[0].date;
          localStorage.setItem(key, JSON.stringify({ last }));
        }
        const daysSince = last ? Math.floor((new Date(today + 'T00:00:00').getTime() - new Date(last + 'T00:00:00').getTime()) / 86400000) : 0;
        if (last && daysSince >= REVIEW_INTERVAL_DAYS) {
          const cutoff = new Date(today + 'T00:00:00');
          cutoff.setDate(cutoff.getDate() - (REVIEW_INTERVAL_DAYS - 1));
          const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
          const period = computed.filter((r) => r.date >= cutoffKey)
            .map((r) => ({ date: r.date, intake: r.intake, target: Math.round(r.target), weight: r.weight }));
          const review = reviewMaintenance(period, kpiObj.base, kpiObj.bmr);
          if (review.status !== 'insufficient') {
            setMaintCard({ review, base: kpiObj.base, bmr: kpiObj.bmr, uid: user.id });
          }
        }
      } catch { /* 見直しは失敗しても本体に影響させない */ }
    })();
  }, [router]);

  // メンテナンスカロリーの見直しを確定/見送り
  async function resolveMaintReview(accept: boolean) {
    if (!maintCard) return;
    setMaintBusy(true);
    try {
      if (accept && maintCard.review.status === 'change') {
        const supabase = createClient();
        const lf = lifeFactorFor(maintCard.review.newBase, maintCard.bmr);
        const { error } = await supabase.from('profiles').update({ life_factor: lf }).eq('id', maintCard.uid);
        if (error) throw new Error(error.message);
      }
      localStorage.setItem(`blmr:${maintCard.uid}`, JSON.stringify({ last: todayJST() }));
      if (accept && maintCard.review.status === 'change') {
        window.location.reload(); // 新しい目安kcalで全体を再計算
        return;
      }
      setMaintCard(null);
    } catch (e) {
      alert('更新に失敗しました: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setMaintBusy(false);
    }
  }

  if (!rows || !kpi) {
    return <AppShell userName={userName}><p className="muted">読み込み中…</p></AppShell>;
  }

  const recent = rows.slice(-14);
  const wpoints = rows.filter((r) => r.weight != null).map((r) => ({ date: r.date, weight: r.weight as number }));
  const goalStatus = goal && kpi.latestWeight != null ? progressStatus(goal, todayJST(), kpi.latestWeight) : null;
  const plan = goal && kpi.latestWeight != null ? computePlan(goal, todayJST(), kpi.latestWeight, events, goal.absorb_days) : null;
  const recommendedIntake = plan ? Math.max(kpi.base - plan.requiredDailyWithEvents, kpi.bmr) : null;
  const diffs = recent.filter((r) => r.diff != null) as (Row & { diff: number })[];
  const maxAbs = Math.max(...diffs.map((r) => Math.abs(r.diff)), 1200);
  const zeroPct = 50;
  const loPct = (500 / (2 * maxAbs)) * 100 > 50 ? 0 : 50 - (500 / (2 * maxAbs)) * 100;
  const hiPct = 50 - (300 / (2 * maxAbs)) * 100;

  return (
    <AppShell userName={userName}>
      {rows.length === 0 ? (
        <div className="card center">
          <p>まだ記録がありません。</p>
          <p className="muted">「入力」タブから今日の食事を記録してみましょう。</p>
        </div>
      ) : (
        <>
          {/* ===== 2週間レビュー: メンテナンスカロリー再校正の提案 ===== */}
          {maintCard && (
            <div className="card" style={{ border: '1.5px solid var(--teal)' }}>
              <h2>🎉 2週間継続おめでとうございます！</h2>
              {maintCard.review.status === 'change' ? (
                <>
                  <p className="muted" style={{ margin: '0 0 8px' }}>
                    直近2週間の理論値（カロリー収支 {maintCard.review.expectedDelta > 0 ? '+' : ''}{maintCard.review.expectedDelta}kg 相当）と
                    実測の体重変化（{maintCard.review.actualDelta > 0 ? '+' : ''}{maintCard.review.actualDelta}kg）のズレから、
                    あなたの本当のメンテナンスカロリーを再計算しました。
                  </p>
                  <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <div className="stat"><div className="stat-l">メンテナンスカロリー</div>
                      <div className="stat-v num">{maintCard.base.toLocaleString()} → <span style={{ color: 'var(--teal)' }}>{maintCard.review.newBase.toLocaleString()}</span><small> kcal/日</small></div></div>
                    <div className="stat"><div className="stat-l">毎日の目標カロリー</div>
                      <div className="stat-v num" style={{ fontSize: 14 }}>自動で{maintCard.review.newBase > maintCard.base ? '上がります' : '下がります'}<small>（差 {maintCard.review.newBase > maintCard.base ? '+' : ''}{(maintCard.review.newBase - maintCard.base).toLocaleString()}kcal）</small></div></div>
                  </div>
                  <div className="row2" style={{ marginTop: 10 }}>
                    <button className="btn-primary" disabled={maintBusy} onClick={() => resolveMaintReview(true)}>
                      {maintBusy ? '更新中…' : '新しい値に更新する'}
                    </button>
                    <button className="btn-ghost" disabled={maintBusy} onClick={() => resolveMaintReview(false)}>今のままにする</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted" style={{ margin: '0 0 8px' }}>
                    理論値と実測の体重変化がほぼ一致しています（実測 {maintCard.review.actualDelta > 0 ? '+' : ''}{maintCard.review.actualDelta}kg / 理論 {maintCard.review.expectedDelta > 0 ? '+' : ''}{maintCard.review.expectedDelta}kg）。
                    現在のメンテナンスカロリー <b className="num">{maintCard.base.toLocaleString()}kcal</b> は妥当です。この調子！
                  </p>
                  <button className="btn-primary" disabled={maintBusy} onClick={() => resolveMaintReview(false)}>OK、続ける！</button>
                </>
              )}
              <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>目標タブでいつでも手動調整できます。次回の見直しは2週間後です。</p>
            </div>
          )}

          <div className="kpis">
            <div className="kpi emph">
              <div className="lbl">目標との進捗</div>
              {goalStatus ? (
                <>
                  <div className="big" style={{ color: goalStatus.state === 'behind' ? 'var(--coral)' : goalStatus.state === 'ahead' ? 'var(--green)' : 'var(--teal)' }}>
                    {goalStatus.state === 'ahead' ? `${Math.abs(goalStatus.diffDays)}日 先行` : goalStatus.state === 'behind' ? `${Math.abs(goalStatus.diffDays)}日 遅れ` : '順調'}
                  </div>
                  <div className="delta muted">標準 {goalStatus.plannedWeight.toFixed(1)} / 実測 {goalStatus.actualWeight.toFixed(1)}kg（{goalStatus.diffKg > 0 ? '+' : ''}{goalStatus.diffKg}kg）</div>
                </>
              ) : (
                <>
                  <div className="big">—</div>
                  <div className="delta muted"><Link href="/goal">目標タブで設定</Link>すると表示されます</div>
                </>
              )}
            </div>
            <div className="kpi emph">
              <div className="lbl">体重</div>
              <div className="big num">{kpi.latestWeight != null ? kpi.latestWeight.toFixed(1) : '—'}<span className="unit">kg</span></div>
              {kpi.weightDelta != null && (
                <div className="delta" style={{ color: kpi.weightDelta <= 0 ? 'var(--green)' : 'var(--coral)' }}>
                  {kpi.weightDelta <= 0 ? '▼' : '▲'} {Math.abs(kpi.weightDelta).toFixed(1)}kg（記録開始比）
                </div>
              )}
            </div>
            <div className="kpi emph">
              <div className="lbl">直近7日 収支（{kpi.range7}）</div>
              <div className="big num">{kpi.sum7 > 0 ? '+' : ''}{kpi.sum7.toLocaleString()}<span className="unit">kcal</span></div>
              <div className="delta" style={{ color: kpi.sum7 > 0 ? 'var(--coral)' : 'var(--green)' }}>
                標準比 {kpi.std7 > 0 ? '+' : ''}{kpi.std7.toLocaleString()}
              </div>
            </div>
            <div className="kpi">
              <div className="lbl">累計収支（{kpi.rangeAll}）</div>
              <div className="big num">{kpi.sumAll > 0 ? '+' : ''}{kpi.sumAll.toLocaleString()}<span className="unit">kcal</span></div>
              <div className="delta" style={{ color: kpi.sumAll < 0 ? 'var(--green)' : 'var(--coral)' }}>
                脂肪換算 約 {kpi.fatKg}kg
              </div>
            </div>
            <div className="kpi">
              <div className="lbl">目安kcal（通常生活）</div>
              <div className="big num">{kpi.base.toLocaleString()}<span className="unit">kcal/日</span></div>
              <div className="delta muted">基礎代謝 {kpi.bmr.toLocaleString()}kcal × 生活係数。運動日は自動加算</div>
            </div>
          </div>

          {plan && (
            <div className="card">
              <h2>🎯 標準進捗 vs 実績 <span className="muted" style={{ fontWeight: 400 }}>— 目標の変更は目標タブから</span></h2>
              <div className="kpis" style={{ marginBottom: plan.feasibility === 'ok' ? 0 : 10 }}>
                <div className="kpi">
                  <div className="lbl">残り</div>
                  <div className="big num">{plan.remainingKg}<span className="unit">kg / {plan.remainingDays}日</span></div>
                  <div className="delta muted">総赤字 {plan.remainingDeficit.toLocaleString()}kcal</div>
                </div>
                <div className="kpi">
                  <div className="lbl">必要な赤字/日（チートデイ込み）</div>
                  <div className="big num">{plan.requiredDailyWithEvents.toLocaleString()}<span className="unit">kcal</span></div>
                  <div className="delta muted">
                    {plan.mode === 'spread'
                      ? `チートデイなし換算 ${plan.requiredDaily.toLocaleString()}${plan.eventsExtra ? ` ／ 🍺+${plan.eventsExtra.toLocaleString()}を残り${plan.remainingDays}日で吸収` : ''}`
                      : `ベース ${plan.requiredDaily.toLocaleString()} ／ 取り返し: 後${plan.absorbDays}日${plan.absorbToday ? `（今日+${plan.absorbToday}）` : ''}`}
                  </div>
                </div>
                <div className="kpi">
                  <div className="lbl">通常日のおすすめ摂取</div>
                  <div className="big num">{recommendedIntake?.toLocaleString()}<span className="unit">kcal/日</span></div>
                  <div className="delta muted">目安 {kpi.base.toLocaleString()} − 必要赤字</div>
                </div>
              </div>
              {plan.feasibility !== 'ok' && (
                <div className={`msg ${plan.feasibility === 'hard' ? 'warn' : 'err'}`} style={{ marginTop: 0 }}>
                  {plan.feasibility === 'hard'
                    ? '⚠ 必要赤字が1日700kcalを超えています。かなりストイックなペースです。'
                    : '🚨 必要赤字が1日1,000kcalを超えています。目標日の見直しを検討してください（目標タブ）。'}
                </div>
              )}
            </div>
          )}

          {wpoints.length > 0 && (
            <div className="card">
              <h2>体重・体脂肪率の推移と計画</h2>
              <WeightChart goal={goal} weights={wpoints} events={events} today={todayJST()}
                           bfPoints={bfPoints} targetBf={goal?.target_bf ?? null} />
            </div>
          )}

          {rows.some((r) => r.diff != null) && (
            <div className="card">
              <h2>カロリー収支の積み上げ <span className="muted" style={{ fontWeight: 400 }}>— どれだけ得したか</span></h2>
              <CumChart
                points={rows.filter((r) => r.diff != null).map((r) => ({ date: r.date, diff: r.diff as number }))}
                today={todayJST()} />
            </div>
          )}

          <div className="card">
            <h2>直近14日 実績</h2>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>日付</th><th>運動</th><th>体重</th><th>摂取</th><th>目安</th><th>差</th><th>判定</th></tr></thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.date}>
                      <td>{r.label}（{r.day}）</td>
                      <td>{r.ex}</td>
                      <td className="num">{r.weight != null ? r.weight.toFixed(1) : '—'}</td>
                      <td className="num">{r.intake != null ? r.intake.toLocaleString() : '—'}</td>
                      <td className="num">{Math.round(r.target).toLocaleString()}</td>
                      <td className={`num ${r.diff == null ? '' : r.diff > 0 ? 'diff-pos' : 'diff-neg'}`}>
                        {r.diff == null ? '—' : `${r.diff > 0 ? '+' : ''}${Math.round(r.diff).toLocaleString()}`}
                      </td>
                      <td>{r.verdict ? <span className={`pill ${verdictClass(r.verdict)}`}>{r.verdict}</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>直近14日 カロリー収支</h2>
            {diffs.map((r) => {
              const pct = (r.diff / maxAbs) * 50;
              const left = pct >= 0 ? zeroPct : zeroPct + pct;
              const width = Math.abs(pct);
              return (
                <div className="chart-row" key={r.date}>
                  <div className="muted">{r.label}</div>
                  <div className="chart-track">
                    <div className="chart-zone" style={{ left: `${loPct}%`, width: `${hiPct - loPct}%` }} />
                    <div className="chart-zero" style={{ left: `${zeroPct}%` }} />
                    <div className={`chart-bar ${verdictClass(r.verdict)}`} style={{ left: `${left}%`, width: `${width}%` }} />
                  </div>
                  <div className={`num ${r.diff > 0 ? 'diff-pos' : 'diff-neg'}`}>
                    {r.diff > 0 ? '+' : ''}{Math.round(r.diff).toLocaleString()}
                  </div>
                </div>
              );
            })}
            <div className="chart-legend">
              <span><i style={{ background: 'var(--blue)' }} />不足注意（−501以下）</span>
              <span><i style={{ background: 'var(--green)' }} />OK（−500〜−300）</span>
              <span><i style={{ background: 'var(--teal)' }} />▲（−299〜−101）</span>
              <span><i style={{ background: 'var(--amber)' }} />×（−100〜+100）</span>
              <span><i style={{ background: 'var(--coral)' }} />NG（+101以上）</span>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
