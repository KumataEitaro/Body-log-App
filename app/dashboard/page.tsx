'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { mifflinBMR, targetKcal, judge, FAT_KCAL_PER_KG, WEEKLY_STD, todayJST, type ExLevel, type Verdict } from '@/lib/calc';
import { progressStatus, computePlan, type Goal, type PlanEvent } from '@/lib/goal';
import { summarizeDay, type LogRow } from '@/lib/day';
import { type ChartEvent } from '@/components/ProgressChart';
import InteractiveChart from '@/components/InteractiveChart';
import Calendar, { type DayMark } from '@/components/Calendar';
import Sheet from '@/components/Sheet';
import Link from 'next/link';
import { cacheGet, cacheSet } from '@/lib/cache';
import { reviewMaintenance, lifeFactorFor, REVIEW_INTERVAL_DAYS, KCAL_PER_KG, type MaintReview } from '@/lib/adaptive';
import { buildItemDays, foodWeightEffects, type FoodEffect } from '@/lib/insights';
import { healthActiveEnergyDays, isHealthEnabled } from '@/lib/health';

type Row = {
  date: string; label: string; day: string; ex: ExLevel; adj: number;
  intake: number | null; weight: number | null; waist: number | null;
  target: number; bmrDay?: number; diff: number | null; verdict: Verdict | null;
};

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

type Kpi = {
  latestWeight: number | null; weightDelta: number | null;
  waistNow: number | null; waistDelta: number | null;
  sum7: number; std7: number; range7: string;
  sumAll: number; fatKg: number; base: number; bmr: number;
  unrecorded: number; // 開始日〜昨日のうち食事が未記録の日数（±0換算されている日）
};

type DayPhoto = { id: string; path: string; bf_est: number | null; assessment: string; url?: string };

function timeJST(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function addDays(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [events, setEvents] = useState<(ChartEvent & PlanEvent)[]>([]);
  // 2週間ごとのメンテナンスカロリー見直し提案
  const [maintCard, setMaintCard] = useState<{
    review: Exclude<MaintReview, { status: 'insufficient' }>; base: number; bmr: number; uid: string;
    // 記録漏れの疑い（未記録日が多い＋実測が理論より悪い）。この時はメンテ下方修正ではなく記録の穴埋めを促す
    leak: { unrecorded14: number; gapPerDay: number } | null;
  } | null>(null);
  const [maintBusy, setMaintBusy] = useState(false);
  // カレンダー日別詳細
  const [daySel, setDaySel] = useState<string | null>(null);
  const [dayLogs, setDayLogs] = useState<(LogRow & { id: string; at: string })[] | null>(null);
  const [dayPhotos, setDayPhotos] = useState<DayPhoto[]>([]);
  const [photoDates, setPhotoDates] = useState<string[]>([]);
  const [bfPoints, setBfPoints] = useState<{ date: string; value: number }[]>([]);
  // チャートの表示系列
  const [serie, setSerie] = useState<'weight' | 'waist' | 'bf' | 'intake' | 'burn'>('weight');
  // 消費カロリー系列: 直近30日はヘルスケア実測（基礎代謝＋活動）で上書き（対応ビルド・連携ONのみ）
  const [hkBurn, setHkBurn] = useState<Map<string, number>>(new Map());
  // 食材×翌日体重の傾向（品目DBから算出。データが揃うまでは非表示）
  const [foodFx, setFoodFx] = useState<FoodEffect[]>([]);

  // AIコーチ相談は専用の「相談」タブ（/coach）へ移設した

  // 消費カロリーの実測（ヘルスケア・直近30日）を裏で取得して系列に重ねる
  useEffect(() => {
    if (!isHealthEnabled()) return;
    (async () => {
      try {
        const today = todayJST();
        const dates = Array.from({ length: 30 }, (_, i) => addDays(today, -i));
        const vals = await healthActiveEnergyDays(dates);
        const m = new Map<string, number>();
        dates.forEach((d, i) => {
          const v = vals[i];
          if (v != null && v >= 50) m.set(d, Math.round(v)); // 50kcal未満はノイズ扱い
        });
        if (m.size > 0) setHkBurn(m);
      } catch { /* 実測なしでも推計で描ける */ }
    })();
  }, []);

  type DashCache = {
    userName: string; rows: Row[]; kpi: Kpi;
    goal: Goal | null; events: (ChartEvent & PlanEvent)[]; photoDates: string[];
    bfPoints?: { date: string; value: number }[];
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
          setGoal(c.goal); setEvents(c.events || []); setPhotoDates(c.photoDates || []);
          setBfPoints(c.bfPoints || []);
        }
      }

      // ② 裏で最新を取得して差し替え
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (!user) {
        if ((authErr || !navigator.onLine) && cachedUid) return; // 一時失敗はキャッシュ表示のまま
        router.push('/login'); return;
      }
      const { data: prof, error: profErr } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (!prof) { if (profErr || !navigator.onLine) return; router.push('/onboarding'); return; }
      setUserName(prof.display_name || user.email || '');

      const [{ data: entries }, { data: g }, { data: evs }, { data: phDates }, { data: itemRows }] = await Promise.all([
        supabase.from('entries').select('*').order('date', { ascending: true }),
        supabase.from('goals').select('*').maybeSingle(),
        supabase.from('events').select('id,date,title,extra_kcal').order('date', { ascending: true }),
        supabase.from('body_photos').select('date,bf_est').order('date', { ascending: true }),
        supabase.from('logs').select('date,items').order('date', { ascending: true }).limit(2000),
      ]);
      // オフライン等でentriesが取れなかった場合はキャッシュ表示を維持
      if (entries === null && !navigator.onLine) return;
      if (g) setGoal(g);
      const phList = (phDates as { date: string; bf_est: number | null }[]) || [];
      const photoDateList = [...new Set(phList.map((p) => p.date))];
      setPhotoDates(photoDateList);
      const bfList = phList.filter((p) => p.bf_est != null).map((p) => ({ date: p.date, value: Number(p.bf_est) }));
      setBfPoints(bfList);
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
          ex: e.ex as ExLevel, adj: Number(e.adj) || 0, bmrDay: Math.round(bmr),
          intake, weight: e.weight == null ? null : Number(e.weight),
          waist: e.waist == null ? null : Number(e.waist),
          target, diff, verdict: diff == null ? null : judge(diff),
        };
      });
      setRows(computed);

      // 食材×翌日体重の傾向（品目DB×体重系列。入力を変えずに貯まったデータの分析）
      try {
        const weightPts = computed.filter((r) => r.weight != null).map((r) => ({ date: r.date, weight: Number(r.weight) }));
        const fx = foodWeightEffects(buildItemDays((itemRows as { date: string; items?: { name?: string }[] }[]) || []), weightPts);
        setFoodFx(fx);
      } catch { /* 分析はベストエフォート */ }

      // 収支の原則: 記録しなかった日は「目安どおり食べた＝±0」として扱う
      // （累計は0加算なので記録日の合計と一致する。「直近7日」は暦の7日間で数える）
      const today = todayJST();
      const withDiff = computed.filter((r) => r.diff != null) as (Row & { diff: number })[];
      const byDate = new Map(computed.map((r) => [r.date, r]));
      const cal7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)); // 今日までの暦7日
      const sum7 = Math.round(cal7.reduce((a, d) => a + (byDate.get(d)?.diff ?? 0), 0));
      const sumAll = Math.round(withDiff.reduce((a, r) => a + r.diff, 0));
      const mdLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
      // 開始日〜昨日のうち「食事が未記録」の日数（＝累計収支に写っていない日）
      let unrecorded = 0;
      if (computed.length > 0) {
        const yest = addDays(today, -1);
        for (let d = computed[0].date; d <= yest; d = addDays(d, 1)) {
          const r = byDate.get(d);
          if (!r || r.intake == null) unrecorded++;
        }
      }
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
        range7: `${mdLabel(cal7[0])}〜${mdLabel(cal7[6])}`,
        sumAll, fatKg: Math.round((sumAll / FAT_KCAL_PER_KG) * 100) / 100,
        base: Math.round(bmrNow * Number(prof.life_factor)),
        bmr: Math.round(bmrNow),
        unrecorded,
      };
      setKpi(kpiObj);
      cacheSet(`dash:${user.id}`, {
        userName: prof.display_name || user.email || '',
        rows: computed, kpi: kpiObj, goal: g ?? null, events: evList, photoDates: photoDateList,
        bfPoints: bfList,
      } satisfies DashCache);

      // ===== 2週間ごとのメンテナンスカロリー見直し =====
      try {
        const key = `blmr:${user.id}`;
        let last: string | null = null;
        try { last = (JSON.parse(localStorage.getItem(key) || 'null') as { last?: string } | null)?.last ?? null; } catch { /* 無視 */ }
        if (!last && computed.length > 0) {
          last = computed[0].date;
          localStorage.setItem(key, JSON.stringify({ last }));
        }
        const daysSince = last ? Math.floor((new Date(today + 'T00:00:00').getTime() - new Date(last + 'T00:00:00').getTime()) / 86400000) : 0;
        if (last && daysSince >= REVIEW_INTERVAL_DAYS) {
          // 暦の14日間をすべて渡す。記録が無い日は「目安どおり食べた(±0)」として埋める
          const period = Array.from({ length: REVIEW_INTERVAL_DAYS }, (_, i) => {
            const d = addDays(today, i - (REVIEW_INTERVAL_DAYS - 1));
            const r = byDate.get(d);
            return r
              ? { date: d, intake: r.intake, target: Math.round(r.target), weight: r.weight }
              : { date: d, intake: null, target: kpiObj.base, weight: null };
          });
          const review = reviewMaintenance(period, kpiObj.base, kpiObj.bmr);
          if (review.status !== 'insufficient') {
            // 実測が理論より悪い方向のズレ＋未記録日が多い場合は「代謝が低い」ではなく「記録漏れ」を第一仮説にする
            // （未記録の爆食をメンテナンスカロリー低下と誤帰属すると、目標がどんどんきつくなり挫折を招く）
            const unrecorded14 = period.filter((d) => d.intake == null).length;
            const gapPerDay = Math.round(((review.actualDelta - review.expectedDelta) * KCAL_PER_KG) / REVIEW_INTERVAL_DAYS / 10) * 10;
            const leak = review.status === 'change' && review.newBase < kpiObj.base && unrecorded14 >= 3 && gapPerDay >= 100
              ? { unrecorded14, gapPerDay } : null;
            setMaintCard({ review, base: kpiObj.base, bmr: kpiObj.bmr, uid: user.id, leak });
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

  // カレンダーの日をタップ → その日の記録＋体写真を取得して詳細シートを開く
  async function openDay(dateKey: string) {
    setDaySel(dateKey);
    setDayLogs(null);
    setDayPhotos([]);
    const supabase = createClient();
    const [{ data: logs }, { data: phs }] = await Promise.all([
      supabase.from('logs').select('*').eq('date', dateKey).order('at', { ascending: true }),
      supabase.from('body_photos').select('id,path,bf_est,assessment').eq('date', dateKey).order('id', { ascending: true }),
    ]);
    setDayLogs((logs as (LogRow & { id: string; at: string })[]) || []);
    const plist = (phs as DayPhoto[]) || [];
    if (plist.length) {
      const { data: signed } = await supabase.storage.from('body').createSignedUrls(plist.map((p) => p.path), 3600);
      plist.forEach((p, i) => { p.url = signed?.[i]?.signedUrl || undefined; });
    }
    setDayPhotos(plist);
  }

  // 詳細シートから写真を削除
  async function delDayPhoto(p: DayPhoto) {
    const supabase = createClient();
    await supabase.storage.from('body').remove([p.path]);
    await supabase.from('body_photos').delete().eq('id', p.id);
    const remaining = dayPhotos.filter((x) => x.id !== p.id);
    setDayPhotos(remaining);
    // その日の写真が全て消えたらカレンダーの📷マークも外す
    if (daySel && remaining.length === 0) setPhotoDates((prev) => prev.filter((d) => d !== daySel));
  }

  if (!rows || !kpi) {
    return <AppShell userName={userName}><p className="muted">読み込み中…</p></AppShell>;
  }

  const goalStatus = goal && kpi.latestWeight != null ? progressStatus(goal, todayJST(), kpi.latestWeight) : null;
  const plan = goal && kpi.latestWeight != null ? computePlan(goal, todayJST(), kpi.latestWeight, events, goal.absorb_days) : null;
  const recommendedIntake = plan ? Math.max(kpi.base - plan.requiredDailyWithEvents, kpi.bmr) : null;
  // 食事が未記録の日は「?」で可視化する（未記録の爆食が収支を静かに壊すのを隠さない）
  const marks = new Map<string, DayMark>(rows.map((r) => [r.date, { logged: r.intake != null, over: r.verdict === 'NG', unknown: r.intake == null }]));
  if (rows.length > 0) {
    const yest = addDays(todayJST(), -1);
    for (let d = rows[0].date; d <= yest; d = addDays(d, 1)) {
      if (!marks.has(d)) marks.set(d, { logged: false, over: false, unknown: true });
    }
  }
  // 写真のある日にマークを付ける（記録が無い日でも写真だけあれば表示）
  for (const d of photoDates) {
    const m = marks.get(d);
    if (m) m.photo = true;
    else marks.set(d, { logged: false, over: false, photo: true });
  }

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
          {maintCard && maintCard.leak && maintCard.review.status === 'change' && (
            <div className="card" style={{ border: '1.5px solid var(--amber)' }}>
              <h2>🔍 記録に写っていないカロリーがありそうです</h2>
              <p className="muted" style={{ margin: '0 0 8px' }}>
                直近2週間、記録上は{maintCard.review.expectedDelta > 0 ? '+' : ''}{maintCard.review.expectedDelta}kgのはずが、
                実測は{maintCard.review.actualDelta > 0 ? '+' : ''}{maintCard.review.actualDelta}kgでした。
                体重計から逆算すると、<b className="num">1日あたり約+{maintCard.leak.gapPerDay.toLocaleString()}kcal</b>ぶんが記録に載っていない可能性があります
                （この期間の食事未記録は<b>{maintCard.leak.unrecorded14}日</b>）。
              </p>
              <p className="muted" style={{ margin: '0 0 8px' }}>
                責める話ではありません——未記録の日を埋めるだけで、数字と現実のズレは解消します。
                このままメンテナンスカロリーを下げると「記録漏れ」を「代謝が低い」と誤解して、目標が必要以上にきつくなります。
              </p>
              <div className="row2" style={{ marginTop: 10 }}>
                <Link href="/log" className="btn-primary" style={{ textAlign: 'center', display: 'block' }}>📝 未記録の日を埋める</Link>
                <button className="btn-ghost" disabled={maintBusy} onClick={() => resolveMaintReview(false)}>今回は見送る</button>
              </div>
              <p className="center" style={{ margin: '8px 0 0', fontSize: 12 }}>
                <a href="#" className="muted" onClick={(e) => { e.preventDefault(); resolveMaintReview(true); }}>
                  記録は正確なはず → メンテナンスカロリーを{maintCard.review.newBase.toLocaleString()}kcalに更新する
                </a>
              </p>
            </div>
          )}
          {maintCard && !maintCard.leak && (
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
                <div className="s-val num" style={{ color: kpi.sumAll <= 0 ? 'var(--green)' : 'var(--coral)' }}>{kpi.sumAll > 0 ? '+' : ''}{Math.abs(kpi.sumAll) >= 10000 ? (kpi.sumAll / 10000).toFixed(1) : Math.round(kpi.sumAll).toLocaleString()}<small>{Math.abs(kpi.sumAll) >= 10000 ? '万' : ''} kcal</small></div>
                <div className="s-delta muted" style={{ fontWeight: 400 }}>
                  脂肪 約{kpi.fatKg}kg{(kpi.unrecorded ?? 0) > 0 && <>・<span style={{ color: 'var(--amber)' }}>未記録{kpi.unrecorded}日=±0扱い</span></>}
                </div>
              </div>
              <div className="s-stat">
                <div className="s-lbl">直近7日 収支 <span style={{ fontWeight: 400 }}>({kpi.range7})</span></div>
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

          {/* ===== インタラクティブチャート（ピンチ/パン/スクラブ・系列切替） ===== */}
          <div className="card">
            <h2>推移</h2>
            <div className="chips" style={{ marginBottom: 10 }}>
              {([['weight', '体重'], ['waist', 'ウエスト'], ['bf', '体脂肪率'], ['intake', '摂取kcal'], ['burn', '消費kcal']] as const).map(([k, l]) => (
                <button key={k} className={`chip ${serie === k ? 'on' : ''}`} onClick={() => setSerie(k)}>{l}</button>
              ))}
            </div>
            {(() => {
              const conf = {
                weight: { data: rows.filter((r) => r.weight != null).map((r) => ({ date: r.date, value: r.weight as number })), unit: 'kg', decimals: 1, minSpan: 2 },
                waist: { data: rows.filter((r) => r.waist != null).map((r) => ({ date: r.date, value: r.waist as number })), unit: 'cm', decimals: 1, minSpan: 2 },
                bf: { data: bfPoints, unit: '%', decimals: 1, minSpan: 2 },
                intake: { data: rows.filter((r) => r.intake != null).map((r) => ({ date: r.date, value: r.intake as number })), unit: 'kcal', decimals: 0, minSpan: 400 },
                // 消費 = 実測(基礎代謝+活動)があればそれ、無ければ推計(基礎代謝×係数+運動)
                burn: { data: rows.map((r) => ({ date: r.date, value: hkBurn.has(r.date) ? (r.bmrDay ?? (kpi?.bmr ?? 0)) + hkBurn.get(r.date)! : r.target })), unit: 'kcal', decimals: 0, minSpan: 400 },
              }[serie];
              const planLine = serie === 'weight' && goal?.target_weight != null
                ? [{ date: goal.start_date, value: goal.start_weight }, { date: goal.target_date, value: goal.target_weight }]
                : undefined;
              return (
                <InteractiveChart key={serie} series={conf.data} today={todayJST()}
                                  unit={conf.unit} decimals={conf.decimals} minSpan={conf.minSpan} plan={planLine} />
              );
            })()}
          </div>

          {/* ===== カレンダー（日タップで詳細・編集） ===== */}
          <div className="card">
            <h2>📅 カレンダー</h2>
            <Calendar today={todayJST()} marks={marks} selected={daySel} onSelect={openDay} />
          </div>

          {/* ===== 食材×あなたの体の傾向（品目DBの分析・ベータ） ===== */}
          {foodFx.length >= 3 && (() => {
            const down = foodFx.filter((f) => f.effect < -0.02).slice(0, 3);
            const up = [...foodFx].reverse().filter((f) => f.effect > 0.02).slice(0, 3);
            if (down.length === 0 && up.length === 0) return null;
            const g = (kg: number) => `${kg > 0 ? '+' : ''}${Math.round(kg * 1000)}g`;
            return (
              <div className="card">
                <h2>🔬 食材とあなたの体の傾向<span className="muted" style={{ fontWeight: 400, letterSpacing: 0 }}> — ベータ</span></h2>
                <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                  よく食べる食材ごとに「食べた翌日」と「食べなかった翌日」の体重変化を比べました。
                </p>
                {down.length > 0 && (
                  <>
                    <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, margin: '8px 0 2px', color: 'var(--green)' }}>▼ 食べた翌日、下がりやすい</div>
                    {down.map((f) => (
                      <div className="feed-row" key={f.name}>
                        <div className="feed-body"><div className="feed-title">{f.name}</div>
                          <div className="feed-sub muted">食べた日{f.withN}日の平均 {g(f.withAvg)} ／ 食べない日 {g(f.withoutAvg)}</div></div>
                        <b className="feed-kcal num pos">{g(f.effect)}</b>
                      </div>
                    ))}
                  </>
                )}
                {up.length > 0 && (
                  <>
                    <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, margin: '8px 0 2px', color: 'var(--coral)' }}>▲ 食べた翌日、上がりやすい</div>
                    {up.map((f) => (
                      <div className="feed-row" key={f.name}>
                        <div className="feed-body"><div className="feed-title">{f.name}</div>
                          <div className="feed-sub muted">食べた日{f.withN}日の平均 {g(f.withAvg)} ／ 食べない日 {g(f.withoutAvg)}</div></div>
                        <b className="feed-kcal num" style={{ color: 'var(--coral)' }}>{g(f.effect)}</b>
                      </div>
                    ))}
                  </>
                )}
                <p className="muted" style={{ fontSize: 10.5, marginTop: 8, marginBottom: 0 }}>
                  ※相関であり因果ではありません（水分・塩分・食べ合わせの影響を含みます）。データが増えるほど精度が上がります。
                </p>
              </div>
            );
          })()}
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
            ) : (
              <>
                {daySummary && (
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
                )}

                {/* 体の写真 */}
                {dayPhotos.length > 0 && (
                  <>
                    <div className="muted" style={{ fontSize: 12, fontWeight: 700, margin: '12px 0 6px' }}>📸 この日の写真</div>
                    <div className="photo-row">
                      {dayPhotos.map((p) => (
                        <div key={p.id} style={{ textAlign: 'center' }}>
                          <div className="thumb bphoto">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {p.url ? <img src={p.url} alt="" /> : null}
                            <button className="thumb-x" onClick={() => delDayPhoto(p)} title="この写真を削除">×</button>
                          </div>
                          {p.bf_est != null && <div className="muted" style={{ fontSize: 11 }}>体脂肪 {p.bf_est}%</div>}
                        </div>
                      ))}
                    </div>
                    {dayPhotos.some((p) => p.assessment) && (
                      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{dayPhotos.find((p) => p.assessment)?.assessment}</p>
                    )}
                  </>
                )}

                {!daySummary && dayPhotos.length === 0 && (
                  <p className="muted" style={{ padding: '16px 0' }}>この日の記録はありません。<Link href={`/log?date=${daySel}`}>この日に記録する</Link></p>
                )}
              </>
            )}
          </div>
        )}
      </Sheet>
    </AppShell>
  );
}
