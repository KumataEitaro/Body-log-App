'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { mifflinBMR, targetKcal, judge, FAT_KCAL_PER_KG, WEEKLY_STD, todayJST, type ExLevel, type Verdict } from '@/lib/calc';
import { progressStatus, computePlan, type Goal, type PlanEvent } from '@/lib/goal';
import { summarizeDay, type LogRow } from '@/lib/day';
import ProgressChart, { type ChartEvent } from '@/components/ProgressChart';
import Calendar, { type DayMark } from '@/components/Calendar';
import Sheet from '@/components/Sheet';
import Link from 'next/link';
import { cacheGet, cacheSet } from '@/lib/cache';
import { reviewMaintenance, lifeFactorFor, REVIEW_INTERVAL_DAYS, type MaintReview } from '@/lib/adaptive';

type Row = {
  date: string; label: string; day: string; ex: ExLevel; adj: number;
  intake: number | null; weight: number | null; waist: number | null;
  target: number; diff: number | null; verdict: Verdict | null;
};

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

type Kpi = {
  latestWeight: number | null; weightDelta: number | null;
  waistNow: number | null; waistDelta: number | null;
  sum7: number; std7: number; range7: string;
  sumAll: number; fatKg: number; base: number; bmr: number;
};

function timeJST(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export default function DashboardPage() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [events, setEvents] = useState<(ChartEvent & PlanEvent)[]>([]);
  // 2週間ごとのメンテナンスカロリー見直し提案
  const [maintCard, setMaintCard] = useState<{ review: Exclude<MaintReview, { status: 'insufficient' }>; base: number; bmr: number; uid: string } | null>(null);
  const [maintBusy, setMaintBusy] = useState(false);
  // カレンダー日別詳細
  const [daySel, setDaySel] = useState<string | null>(null);
  const [dayLogs, setDayLogs] = useState<(LogRow & { id: string; at: string })[] | null>(null);

  type DashCache = {
    userName: string; rows: Row[]; kpi: Kpi;
    goal: Goal | null; events: (ChartEvent & PlanEvent)[];
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
          setGoal(c.goal); setEvents(c.events || []);
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

      const [{ data: entries }, { data: g }, { data: evs }] = await Promise.all([
        supabase.from('entries').select('*').order('date', { ascending: true }),
        supabase.from('goals').select('*').maybeSingle(),
        supabase.from('events').select('id,date,title,extra_kcal').order('date', { ascending: true }),
      ]);
      // オフライン等でentriesが取れなかった場合はキャッシュ表示を維持
      if (entries === null && !navigator.onLine) return;
      if (g) setGoal(g);
      const evList = (evs as (ChartEvent & PlanEvent)[]) || [];
      setEvents(evList);
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
          waist: e.waist == null ? null : Number(e.waist),
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
      const waists = computed.filter((r) => r.waist != null) as (Row & { waist: number })[];
      const waistNow = waists.length ? waists[waists.length - 1].waist : null;
      const waistFirst = waists.length ? waists[0].waist : null;
      const bmrNow = mifflinBMR(prof.sex, latestWeight ?? Number(prof.init_weight) ?? 70, Number(prof.height_cm), Number(prof.age));
      const kpiObj: Kpi = {
        latestWeight,
        weightDelta: latestWeight != null && firstWeight != null ? Math.round((latestWeight - firstWeight) * 10) / 10 : null,
        waistNow,
        waistDelta: waistNow != null && waistFirst != null ? Math.round((waistNow - waistFirst) * 10) / 10 : null,
        sum7, std7: sum7 - WEEKLY_STD,
        range7: last7.length ? `${last7[0].label}〜${last7[last7.length - 1].label}` : '',
        sumAll, fatKg: Math.round((sumAll / FAT_KCAL_PER_KG) * 100) / 100,
        base: Math.round(bmrNow * Number(prof.life_factor)),
        bmr: Math.round(bmrNow),
      };
      setKpi(kpiObj);
      cacheSet(`dash:${user.id}`, {
        userName: prof.display_name || user.email || '',
        rows: computed, kpi: kpiObj, goal: g ?? null, events: evList,
      } satisfies DashCache);

      // ===== 2週間ごとのメンテナンスカロリー見直し =====
      try {
        const today = todayJST();
        const key = `blmr:${user.id}`;
        let last: string | null = null;
        try { last = (JSON.parse(localStorage.getItem(key) || 'null') as { last?: string } | null)?.last ?? null; } catch { /* 無視 */ }
        if (!last && computed.length > 0) {
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
      if (accept && maintCard.review.status === 'change') { window.location.reload(); return; }
      setMaintCard(null);
    } catch (e) {
      alert('更新に失敗しました: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setMaintBusy(false);
    }
  }

  // カレンダーの日をタップ → その日の記録を取得して詳細シートを開く
  async function openDay(dateKey: string) {
    setDaySel(dateKey);
    setDayLogs(null);
    const supabase = createClient();
    const { data: logs } = await supabase.from('logs').select('*').eq('date', dateKey).order('at', { ascending: true });
    setDayLogs((logs as (LogRow & { id: string; at: string })[]) || []);
  }

  if (!rows || !kpi) {
    return <AppShell userName={userName}><p className="muted">読み込み中…</p></AppShell>;
  }

  const goalStatus = goal && kpi.latestWeight != null ? progressStatus(goal, todayJST(), kpi.latestWeight) : null;
  const plan = goal && kpi.latestWeight != null ? computePlan(goal, todayJST(), kpi.latestWeight, events, goal.absorb_days) : null;
  const recommendedIntake = plan ? Math.max(kpi.base - plan.requiredDailyWithEvents, kpi.bmr) : null;
  const wpoints = rows.filter((r) => r.weight != null).map((r) => ({ date: r.date, weight: r.weight as number }));
  const diffPoints = rows.filter((r) => r.diff != null).map((r) => ({ date: r.date, diff: r.diff as number }));
  const marks = new Map<string, DayMark>(rows.map((r) => [r.date, { logged: true, over: r.verdict === 'NG' }]));

  // 日別詳細の集計
  const daySummary = dayLogs && dayLogs.length ? summarizeDay(dayLogs) : null;

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

          {/* ===== サマリー（KPI統合） ===== */}
          <div className="card summary">
            <div className="summary-hero">
              <div>
                <div className="summary-hero-l">{goalStatus ? '目標との進捗' : '体重'}</div>
                {goalStatus ? (
                  <>
                    <div className="summary-state" style={{ color: goalStatus.state === 'behind' ? 'var(--coral)' : goalStatus.state === 'ahead' ? 'var(--green)' : 'var(--teal)' }}>
                      {goalStatus.state === 'ahead' ? `${Math.abs(goalStatus.diffDays)}日 先行 🎉` : goalStatus.state === 'behind' ? `${Math.abs(goalStatus.diffDays)}日 遅れ` : '順調 👍'}
                    </div>
                    <div className="summary-hero-sub num">標準 {goalStatus.plannedWeight.toFixed(1)} / 実測 {goalStatus.actualWeight.toFixed(1)}kg（{goalStatus.diffKg > 0 ? '+' : ''}{goalStatus.diffKg}kg）</div>
                  </>
                ) : (
                  <>
                    <div className="summary-state num">{kpi.latestWeight != null ? kpi.latestWeight.toFixed(1) : '—'}<small style={{ fontSize: 14, color: 'var(--sub)' }}> kg</small></div>
                    <div className="summary-hero-sub"><Link href="/goal">目標を設定</Link>すると進捗が表示されます</div>
                  </>
                )}
              </div>
              {plan && (
                <div style={{ textAlign: 'right' }}>
                  <div className="summary-hero-l">おすすめ摂取</div>
                  <div className="summary-state num" style={{ fontSize: 22 }}>{recommendedIntake?.toLocaleString()}<small style={{ fontSize: 12, color: 'var(--sub)' }}> kcal</small></div>
                  <div className="summary-hero-sub num">必要赤字 {plan.requiredDailyWithEvents.toLocaleString()}/日</div>
                </div>
              )}
            </div>

            <div className="summary-divider" />

            <div className="summary-stats">
              <div className="s-stat">
                <div className="s-lbl">体重</div>
                <div className="s-val num">{kpi.latestWeight != null ? kpi.latestWeight.toFixed(1) : '—'}<small>kg</small></div>
                {kpi.weightDelta != null && (
                  <div className="s-delta" style={{ color: kpi.weightDelta <= 0 ? 'var(--green)' : 'var(--coral)' }}>
                    {kpi.weightDelta <= 0 ? '▼' : '▲'}{Math.abs(kpi.weightDelta).toFixed(1)}kg
                  </div>
                )}
              </div>
              <div className="s-stat">
                <div className="s-lbl">ウエスト</div>
                <div className="s-val num">{kpi.waistNow != null ? kpi.waistNow.toFixed(1) : '—'}<small>cm</small></div>
                {kpi.waistDelta != null ? (
                  <div className="s-delta" style={{ color: kpi.waistDelta <= 0 ? 'var(--green)' : 'var(--coral)' }}>
                    {kpi.waistDelta <= 0 ? '▼' : '▲'}{Math.abs(kpi.waistDelta).toFixed(1)}cm
                  </div>
                ) : <div className="s-delta muted" style={{ fontWeight: 400 }}>入力で記録</div>}
              </div>
              <div className="s-stat">
                <div className="s-lbl">累計収支</div>
                <div className="s-val num" style={{ color: kpi.sumAll <= 0 ? 'var(--green)' : 'var(--coral)' }}>{kpi.sumAll > 0 ? '+' : ''}{(kpi.sumAll / 1000).toFixed(1)}<small>k kcal</small></div>
                <div className="s-delta muted" style={{ fontWeight: 400 }}>脂肪 約{kpi.fatKg}kg</div>
              </div>
              <div className="s-stat">
                <div className="s-lbl">直近7日 収支</div>
                <div className="s-val num" style={{ color: kpi.sum7 <= 0 ? 'var(--green)' : 'var(--coral)' }}>{kpi.sum7 > 0 ? '+' : ''}{kpi.sum7.toLocaleString()}</div>
                <div className="s-delta muted" style={{ fontWeight: 400 }}>標準比 {kpi.std7 > 0 ? '+' : ''}{kpi.std7.toLocaleString()}</div>
              </div>
              <div className="s-stat">
                <div className="s-lbl">目安kcal/日</div>
                <div className="s-val num">{kpi.base.toLocaleString()}</div>
                <div className="s-delta muted" style={{ fontWeight: 400 }}>基礎 {kpi.bmr.toLocaleString()}</div>
              </div>
              {plan && (
                <div className="s-stat">
                  <div className="s-lbl">目標まで</div>
                  <div className="s-val num">{plan.remainingKg}<small>kg</small></div>
                  <div className="s-delta muted" style={{ fontWeight: 400 }}>あと{plan.remainingDays}日</div>
                </div>
              )}
            </div>

            {plan && plan.feasibility !== 'ok' && (
              <div className={`msg ${plan.feasibility === 'hard' ? 'warn' : 'err'}`}>
                {plan.feasibility === 'hard'
                  ? '⚠ 必要赤字が1日700kcalを超えています。かなりストイックなペースです。'
                  : '🚨 必要赤字が1日1,000kcal超。目標日の見直しを検討してください（目標タブ）。'}
              </div>
            )}
          </div>

          {/* ===== 統合グラフ（体重の推移＋計画＋カロリー収支） ===== */}
          <div className="card">
            <h2>体重の推移と計画 <span className="muted" style={{ fontWeight: 400 }}>— 背景＝カロリー収支の積み上げ</span></h2>
            <ProgressChart goal={goal} weights={wpoints} points={diffPoints} events={events} today={todayJST()} />
          </div>

          {/* ===== カレンダー（日タップで詳細・編集） ===== */}
          <div className="card">
            <h2>📅 カレンダー</h2>
            <Calendar today={todayJST()} marks={marks} selected={daySel} onSelect={openDay} />
          </div>
        </>
      )}

      {/* ===== 日別詳細シート ===== */}
      <Sheet open={daySel != null} onClose={() => setDaySel(null)}>
        {daySel && (
          <div>
            <div className="day-detail-head">
              <h2 style={{ margin: 0 }}>{daySel.replace(/-/g, '/')} の記録</h2>
              <Link href={`/log?date=${daySel}`} className="btn-ghost" style={{ textDecoration: 'none', padding: '7px 14px' }}>✎ この日を編集</Link>
            </div>
            {dayLogs === null ? (
              <p className="muted" style={{ padding: '16px 0' }}>読み込み中…</p>
            ) : daySummary ? (
              <>
                <div className="day-detail-kcal num">
                  {daySummary.intake != null ? Math.round(daySummary.intake).toLocaleString() : '—'}<small style={{ fontSize: 13, color: 'var(--sub)', fontWeight: 600 }}> kcal 摂取</small>
                </div>
                <div className="day-macro num">
                  <span>P <b>{daySummary.p != null ? Math.round(daySummary.p) : '—'}</b>g</span>
                  <span>F <b>{daySummary.f != null ? Math.round(daySummary.f) : '—'}</b>g</span>
                  <span>C <b>{daySummary.c != null ? Math.round(daySummary.c) : '—'}</b>g</span>
                  {daySummary.weight != null && <span>⚖ <b>{daySummary.weight.toFixed(1)}</b>kg</span>}
                  {daySummary.waist != null && <span>📏 <b>{daySummary.waist.toFixed(1)}</b>cm</span>}
                </div>
                {dayLogs.map((l) => {
                  const items = (l.items as { name: string }[]) || [];
                  const names = items.slice(0, 3).map((it) => it.name).filter(Boolean).join('、');
                  return (
                    <div className="feed-row" key={l.id}>
                      <div className="feed-icon">{l.kcal != null ? '🍽' : (l.ex && l.ex !== 'オフ') ? '🏃' : l.weight != null || l.waist != null ? '⚖️' : '📝'}</div>
                      <div className="feed-body">
                        <div>
                          {l.kcal != null ? `${names || '食事'} ${Math.round(Number(l.kcal)).toLocaleString()}kcal` : (l.ex && l.ex !== 'オフ') ? `運動 ${l.ex}` : l.weight != null ? `体重 ${Number(l.weight).toFixed(1)}kg` : l.waist != null ? `ウエスト ${Number(l.waist).toFixed(1)}cm` : (l.text || '記録')}
                        </div>
                        <div className="muted feed-text num">{timeJST(l.at)}</div>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              <p className="muted" style={{ padding: '16px 0' }}>この日の記録はありません。<Link href={`/log?date=${daySel}`}>この日に記録する</Link></p>
            )}
          </div>
        )}
      </Sheet>
    </AppShell>
  );
}
