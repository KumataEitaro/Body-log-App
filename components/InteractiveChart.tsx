'use client';
// Appleヘルスケア風インタラクティブチャート（docs/chart-redesign-spec.md 準拠）
// ・ズーム＝連続（2本指ピンチで窓幅7日〜全期間を無段階）
// ・ビン＝窓幅しきい値で多段自動切替（〜45日=日実測 / 〜240日=週平均 / それ以上=月平均）
// ・1本指横ドラッグ=パン（慣性つき）／長押し(250ms)→ドラッグ=スクラブ
// ・Y軸は表示窓のmin/max+8%パディングで自動リスケール（最小レンジ保証つき）
import { useEffect, useMemo, useRef, useState } from 'react';
import { hapticTap } from '@/lib/native';

export type ChartSample = { date: string; value: number };

type Bin = { center: number; value: number; tipMain: string; tipSub: string };
type Gran = 'd' | 'w' | 'm';

const DAY = 86400000;
// 日付文字列(YYYY-MM-DD)→UTC日インデックス。全計算をUTC日で行いTZズレを避ける
const idxOf = (date: string) => Math.round(Date.parse(date + 'T00:00:00Z') / DAY);
const dateOf = (idx: number) => new Date(idx * DAY);
const fmtMD = (idx: number) => {
  const d = dateOf(idx);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
const fmtYMD = (idx: number) => {
  const d = dateOf(idx);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

function fmtVal(v: number, decimals: number): string {
  return v.toLocaleString('ja-JP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// 1/2/5×10^n の「きれいな」目盛り刻み
function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const r = rough / pow;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * pow;
}

export default function InteractiveChart({
  series, today, unit, decimals = 1, minSpan = 2, plan,
}: {
  series: ChartSample[];
  today: string;            // YYYY-MM-DD (JST)
  unit: string;             // 'kg' | 'cm' | '%' | 'kcal'
  decimals?: number;
  minSpan?: number;         // Y軸の最小レンジ（角度の暴れ防止）
  plan?: ChartSample[];     // 計画線（2点・任意）
}) {
  const todayIdx = idxOf(today);

  // ===== ビン事前計算（日/週/月）=====
  const bins = useMemo(() => {
    const sorted = [...series].filter((s) => s.value != null && !Number.isNaN(s.value))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const daily: Bin[] = sorted.map((s) => ({
      center: idxOf(s.date), value: s.value,
      tipMain: `${fmtVal(s.value, decimals)} ${unit}`, tipSub: fmtYMD(idxOf(s.date)),
    }));
    // 週（月曜始まり）: epoch日0=木曜 → 曜日 = (idx+4)%7 (0=日)
    const wk = new Map<number, number[]>();
    const mo = new Map<string, { sum: number; n: number; y: number; m: number }>();
    for (const s of sorted) {
      const i = idxOf(s.date);
      const dow = (i + 4) % 7;                 // 0=日,1=月,…
      const wStart = i - ((dow + 6) % 7);      // 直近の月曜
      wk.set(wStart, [...(wk.get(wStart) || []), s.value]);
      const d = dateOf(i);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      const cur = mo.get(key) || { sum: 0, n: 0, y: d.getUTCFullYear(), m: d.getUTCMonth() };
      cur.sum += s.value; cur.n++;
      mo.set(key, cur);
    }
    const weekly: Bin[] = [...wk.entries()].sort((a, b) => a[0] - b[0]).map(([wStart, vals]) => {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      return {
        center: wStart + 3, value: avg,
        tipMain: `平均 ${fmtVal(avg, decimals)} ${unit}`, tipSub: `${fmtMD(wStart)}〜${fmtMD(wStart + 6)}`,
      };
    });
    const monthly: Bin[] = [...mo.values()].sort((a, b) => a.y * 12 + a.m - (b.y * 12 + b.m)).map((v) => {
      const start = Math.round(Date.UTC(v.y, v.m, 1) / DAY);
      const end = Math.round(Date.UTC(v.y, v.m + 1, 1) / DAY);
      const avg = v.sum / v.n;
      return {
        center: Math.floor((start + end) / 2), value: avg,
        tipMain: `平均 ${fmtVal(avg, decimals)} ${unit}`, tipSub: `${v.y}年${v.m + 1}月`,
      };
    });
    return { d: daily, w: weekly, m: monthly };
  }, [series, unit, decimals]);

  const firstIdx = bins.d.length ? bins.d[0].center : todayIdx - 30;
  const totalSpan = Math.max(todayIdx - firstIdx + 2, 14);

  // ===== 表示窓（end=右端の日・days=幅）=====
  const [win, setWin] = useState({ end: todayIdx + 1, days: 30 });
  const [scrub, setScrub] = useState<Bin | null>(null);
  const [w, setW] = useState(360);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => { const cw = es[0]?.contentRect.width; if (cw) setW(cw); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clampWin = (end: number, days: number) => {
    const d = Math.min(Math.max(days, 7), Math.max(totalSpan, 14));
    const eMax = todayIdx + Math.max(1, d * 0.03);
    const eMin = Math.min(firstIdx + d * 0.5, eMax);
    return { end: Math.min(Math.max(end, eMin), eMax), days: d };
  };

  // ===== レイアウト＆スケール =====
  // 描画は常にクランプ済みの窓（view）を使う（初期状態やデータ変化後も一貫させる）
  const view = clampWin(win.end, win.days);
  const H = 236, PL = 8, PR = 46, PT = 14, PB = 24;
  const plotW = Math.max(w - PL - PR, 60);
  const start = view.end - view.days;
  const xOf = (day: number) => PL + ((day - start) / view.days) * plotW;
  const dayAt = (x: number) => start + ((x - PL) / plotW) * view.days;

  const gran: Gran = view.days <= 45 ? 'd' : view.days <= 240 ? 'w' : 'm';
  const binW = gran === 'd' ? 1 : gran === 'w' ? 7 : 30;
  const visible = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => bins[gran].filter((b) => b.center >= start - binW && b.center <= view.end + binW),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bins, gran, start, view.end, binW]
  );

  // 計画線の窓内区間（Yスケールにも反映）
  const planSeg = useMemo(() => {
    if (!plan || plan.length < 2) return null;
    const p0 = { x: idxOf(plan[0].date), v: plan[0].value };
    const p1 = { x: idxOf(plan[1].date), v: plan[1].value };
    if (p1.x <= p0.x || p1.x < start || p0.x > view.end) return null;
    const at = (x: number) => p0.v + ((p1.v - p0.v) * (x - p0.x)) / (p1.x - p0.x);
    const a = Math.max(p0.x, start), b = Math.min(p1.x, view.end);
    return { a, b, va: at(a), vb: at(b) };
  }, [plan, start, view.end]);

  const yScale = useMemo(() => {
    const vals = visible.map((b) => b.value);
    if (planSeg) vals.push(planSeg.va, planSeg.vb);
    if (vals.length === 0) return { min: 0, max: 1, ticks: [] as number[] };
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max - min < minSpan) { const mid = (max + min) / 2; min = mid - minSpan / 2; max = mid + minSpan / 2; }
    const pad = (max - min) * 0.08;
    min -= pad; max += pad;
    const step = niceStep((max - min) / 3);
    const ticks: number[] = [];
    for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(Math.round(t * 1000) / 1000);
    return { min, max, ticks };
  }, [visible, planSeg, minSpan]);
  const yOf = (v: number) => PT + (1 - (v - yScale.min) / (yScale.max - yScale.min)) * (H - PT - PB);

  // ===== ジェスチャ =====
  const g = useRef({
    pts: new Map<number, { x: number; y: number }>(),
    mode: 'idle' as 'idle' | 'maybe' | 'pan' | 'pinch' | 'scrub',
    timer: 0 as ReturnType<typeof setTimeout> | 0,
    startX: 0, startWin: { end: 0, days: 0 },
    pinch: { dist: 1, days: 30, anchorDay: 0, anchorFrac: 0.5 },
    lastX: 0, lastT: 0, vel: 0,
    raf: 0,
    lastBinKey: -1, lastGran: 'd' as Gran,
  });
  const winRef = useRef(win);
  winRef.current = view;

  const localX = (e: { clientX: number }) => {
    const r = wrapRef.current?.getBoundingClientRect();
    return e.clientX - (r?.left ?? 0);
  };

  function doScrub(x: number) {
    const day = dayAt(x);
    let best: Bin | null = null, bd = Infinity;
    for (const b of visible) { const d = Math.abs(b.center - day); if (d < bd) { bd = d; best = b; } }
    if (best && bd <= binW * 2) {
      const k = best.center;
      if (k !== g.current.lastBinKey) { g.current.lastBinKey = k; hapticTap(); }
      setScrub(best);
    }
  }

  function stopMomentum() { if (g.current.raf) { cancelAnimationFrame(g.current.raf); g.current.raf = 0; } }

  function onDown(e: React.PointerEvent) {
    stopMomentum();
    const s = g.current;
    s.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* 合成イベント等では失敗する */ }
    if (s.pts.size === 1) {
      s.mode = 'maybe';
      s.startX = localX(e);
      s.startWin = { ...winRef.current };
      s.lastX = s.startX; s.lastT = performance.now(); s.vel = 0;
      s.timer = setTimeout(() => {
        if (s.mode === 'maybe' && s.pts.size === 1) { s.mode = 'scrub'; hapticTap(); doScrub(s.startX); }
      }, 250);
    } else if (s.pts.size === 2) {
      if (s.timer) clearTimeout(s.timer);
      setScrub(null);
      const [a, b] = [...s.pts.values()];
      const midX = localX({ clientX: (a.x + b.x) / 2 });
      s.mode = 'pinch';
      s.pinch = {
        dist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 20),
        days: winRef.current.days,
        anchorDay: dayAt(midX),
        anchorFrac: Math.min(Math.max((midX - PL) / plotW, 0), 1),
      };
    }
  }

  function onMove(e: React.PointerEvent) {
    const s = g.current;
    if (!s.pts.has(e.pointerId)) return;
    s.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const x = localX(e);

    if (s.mode === 'pinch' && s.pts.size === 2) {
      const [a, b] = [...s.pts.values()];
      const dist = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 20);
      const days = s.pinch.days * (s.pinch.dist / dist);
      const end = s.pinch.anchorDay + (1 - s.pinch.anchorFrac) * days;
      setWin(clampWin(end, days));
      return;
    }
    if (s.mode === 'maybe') {
      if (Math.abs(x - s.startX) > 8) { if (s.timer) clearTimeout(s.timer); s.mode = 'pan'; }
      else return;
    }
    if (s.mode === 'pan') {
      const pxPerDay = plotW / winRef.current.days;
      const end = s.startWin.end - (x - s.startX) / pxPerDay;
      setWin(clampWin(end, winRef.current.days));
      const now = performance.now();
      const dt = now - s.lastT;
      if (dt > 0) { s.vel = (x - s.lastX) / dt; s.lastX = x; s.lastT = now; }
      return;
    }
    if (s.mode === 'scrub') doScrub(x);
  }

  function onUp(e: React.PointerEvent) {
    const s = g.current;
    s.pts.delete(e.pointerId);
    if (s.timer) clearTimeout(s.timer);
    if (s.mode === 'scrub') setScrub(null);
    if (s.mode === 'pan' && Math.abs(s.vel) > 0.25) {
      // 慣性スクロール
      let vel = s.vel, last = performance.now();
      const tick = () => {
        const now = performance.now(), dt = now - last; last = now;
        vel *= Math.pow(0.94, dt / 16);
        const pxPerDay = plotW / winRef.current.days;
        const next = clampWin(winRef.current.end - (vel * dt) / pxPerDay, winRef.current.days);
        setWin(next);
        if (Math.abs(vel) > 0.02) g.current.raf = requestAnimationFrame(tick);
      };
      g.current.raf = requestAnimationFrame(tick);
    }
    if (s.pts.size === 0) s.mode = 'idle';
    else if (s.pts.size === 1) { s.mode = 'pan'; const [p] = [...s.pts.values()]; s.startX = localX({ clientX: p.x }); s.startWin = { ...winRef.current }; }
  }

  // 粒度が切り替わった瞬間のハプティクス
  useEffect(() => {
    if (g.current.lastGran !== gran) { g.current.lastGran = gran; hapticTap(); }
  }, [gran]);

  // セグメントショートカット（窓幅アニメーション）
  function animateTo(days: number) {
    stopMomentum();
    const from = { ...winRef.current };
    const to = clampWin(todayIdx + Math.max(1, days * 0.03), days);
    const t0 = performance.now(), DUR = 200;
    const tick = () => {
      const p = Math.min((performance.now() - t0) / DUR, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setWin(clampWin(from.end + (to.end - from.end) * ease, from.days + (to.days - from.days) * ease));
      if (p < 1) g.current.raf = requestAnimationFrame(tick);
    };
    g.current.raf = requestAnimationFrame(tick);
  }

  if (bins.d.length === 0) {
    return <div className="ichart-empty muted">記録がたまるとここに推移が表示されます。</div>;
  }

  // ===== 描画データ =====
  const path = visible.map((b, i) => `${i === 0 ? 'M' : 'L'}${xOf(b.center).toFixed(1)},${yOf(b.value).toFixed(1)}`).join(' ');
  const trend = visible.length >= 2 ? visible[visible.length - 1].value - visible[0].value : null;
  const segs = [
    { l: '週', d: 7 }, { l: '月', d: 30 }, { l: '6M', d: 183 }, { l: '年', d: 365 }, { l: '全', d: totalSpan },
  ];
  const activeSeg = segs.reduce((best, s) => (Math.abs(Math.log(view.days / s.d)) < Math.abs(Math.log(view.days / best.d)) ? s : best), segs[0]);
  // X軸目盛り: 窓を4等分
  const xTicks = [0.125, 0.375, 0.625, 0.875].map((f) => Math.round(start + view.days * f));

  return (
    <div className="ichart-wrap" ref={wrapRef}>
      <div className="ichart-head">
        <div className="ichart-trend num">
          {scrub ? (
            <>{scrub.tipMain}<small>{scrub.tipSub}</small></>
          ) : (
            <>{trend != null ? `${trend > 0 ? '+' : ''}${fmtVal(trend, decimals)} ${unit}` : '—'}<small>この期間の変化</small></>
          )}
        </div>
        <div className="ichart-range num">{fmtYMD(Math.round(start))}〜{fmtMD(Math.round(view.end))}</div>
      </div>

      <svg className="ichart-svg" height={H} viewBox={`0 0 ${w} ${H}`}
           onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {/* Y目盛り（右軸） */}
        {yScale.ticks.map((t) => (
          <g key={t}>
            <line x1={PL} y1={yOf(t)} x2={w - PR + 4} y2={yOf(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={w - PR + 8} y={yOf(t) + 3.5} fontSize="10" fill="var(--faint)" className="num">{fmtVal(t, decimals >= 1 && t % 1 !== 0 ? 1 : 0)}</text>
          </g>
        ))}
        {/* X目盛り */}
        {xTicks.map((d) => (
          <text key={d} x={xOf(d)} y={H - 8} fontSize="10" fill="var(--faint)" textAnchor="middle" className="num">{fmtMD(d)}</text>
        ))}
        {/* 今日ライン */}
        {todayIdx >= start && todayIdx <= view.end && (
          <line x1={xOf(todayIdx)} y1={PT} x2={xOf(todayIdx)} y2={H - PB} stroke="var(--faint)" strokeWidth="1" strokeDasharray="2 4" />
        )}
        {/* 計画線 */}
        {planSeg && (
          <line x1={xOf(planSeg.a)} y1={yOf(planSeg.va)} x2={xOf(planSeg.b)} y2={yOf(planSeg.vb)}
                stroke="var(--ink)" strokeWidth="1.4" strokeDasharray="6 5" opacity="0.35" />
        )}
        {/* 系列（粒度切替でクロスフェード） */}
        <g key={gran} className="fade-in">
          <path d={path} fill="none" stroke="var(--teal)" strokeWidth="2.2" strokeLinejoin="round" />
          {visible.map((b) => (
            <circle key={b.center} cx={xOf(b.center)} cy={yOf(b.value)}
                    r={scrub?.center === b.center ? 5 : 3}
                    fill={scrub?.center === b.center ? 'var(--teal)' : 'var(--bg)'}
                    stroke="var(--teal)" strokeWidth="1.8" />
          ))}
        </g>
        {/* スクラブ垂直ライン */}
        {scrub && <line x1={xOf(scrub.center)} y1={PT - 4} x2={xOf(scrub.center)} y2={H - PB} stroke="var(--ink)" strokeWidth="1.2" />}
      </svg>

      <div className="seg" style={{ marginTop: 10 }}>
        {segs.map((s) => (
          <button key={s.l} className={activeSeg.l === s.l ? 'active' : ''} onClick={() => animateTo(s.d)}>{s.l}</button>
        ))}
      </div>
      <p className="muted center" style={{ fontSize: 10.5, marginTop: 6, marginBottom: 0 }}>
        ピンチで拡大縮小・ドラッグで移動・長押しで値を表示{gran !== 'd' ? `（表示中: ${gran === 'w' ? '週' : '月'}平均）` : ''}
      </p>
    </div>
  );
}
