'use client';
// 開発専用: 新ダッシュボードUIをログインなしで確認するモック（本番は404）。
import { useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import AppShell from '@/components/AppShell';
import ProgressChart from '@/components/ProgressChart';
import Calendar, { type DayMark } from '@/components/Calendar';
import Sheet from '@/components/Sheet';
import type { Goal } from '@/lib/goal';

export default function DevDashboardPreview() {
  const [daySel, setDaySel] = useState<string | null>(null);
  if (process.env.NODE_ENV === 'production') notFound();

  // 30日分のモックデータ
  const { weights, points, marks } = useMemo(() => {
    const weights: { date: string; weight: number }[] = [];
    const points: { date: string; diff: number }[] = [];
    const marks = new Map<string, DayMark>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(2026, 6, 21 - i);
      const k = `2026-07-${String(d.getDate()).padStart(2, '0')}`;
      if (d.getMonth() !== 6) continue;
      weights.push({ date: k, weight: 75 - (29 - i) * 0.06 + (i % 3 === 0 ? 0.3 : -0.1) });
      const diff = i % 6 === 0 ? 250 : -350 + (i % 4) * 40;
      points.push({ date: k, diff });
      marks.set(k, { logged: true, over: diff > 100, photo: i % 7 === 0 });
    }
    return { weights, points, marks };
  }, []);

  const goal: Goal = {
    start_date: '2026-06-21', start_weight: 76.5, target_date: '2026-09-01', target_weight: 70,
    target_bf: 15, note: '腹筋を割る', absorb_days: null, protein_per_kg: 2, fat_per_kg: 0.9, fat_max_g: null,
  } as Goal;

  return (
    <AppShell userName="くまた">
      <div className="card summary">
        <div className="summary-hero">
          <div>
            <div className="summary-hero-l">目標との進捗</div>
            <div className="summary-state" style={{ color: 'var(--green)' }}>3日 先行 🎉</div>
            <div className="summary-hero-sub num">標準 74.2 / 実測 73.5kg（−0.7kg）</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="summary-hero-l">おすすめ摂取</div>
            <div className="summary-state num" style={{ fontSize: 22 }}>1,650<small style={{ fontSize: 12, color: 'var(--sub)' }}> kcal</small></div>
            <div className="summary-hero-sub num">必要赤字 500/日</div>
          </div>
        </div>
        <div className="summary-divider" />
        <div className="summary-stats">
          <div className="s-stat"><div className="s-lbl">体重</div><div className="s-val num">73.5<small>kg</small></div><div className="s-delta" style={{ color: 'var(--green)' }}>▼3.0kg</div></div>
          <div className="s-stat"><div className="s-lbl">ウエスト</div><div className="s-val num">79.0<small>cm</small></div><div className="s-delta" style={{ color: 'var(--green)' }}>▼4.0cm</div></div>
          <div className="s-stat"><div className="s-lbl">累計収支</div><div className="s-val num" style={{ color: 'var(--green)' }}>-9.2<small>k kcal</small></div><div className="s-delta muted" style={{ fontWeight: 400 }}>脂肪 約1.3kg</div></div>
          <div className="s-stat"><div className="s-lbl">直近7日 収支</div><div className="s-val num" style={{ color: 'var(--green)' }}>-2,100</div><div className="s-delta muted" style={{ fontWeight: 400 }}>標準比 -600</div></div>
          <div className="s-stat"><div className="s-lbl">目安kcal/日</div><div className="s-val num">2,150</div><div className="s-delta muted" style={{ fontWeight: 400 }}>基礎 1,540</div></div>
          <div className="s-stat"><div className="s-lbl">目標まで</div><div className="s-val num">3.5<small>kg</small></div><div className="s-delta muted" style={{ fontWeight: 400 }}>あと42日</div></div>
        </div>
      </div>

      <div className="card">
        <h2>体重の推移と計画 <span className="muted" style={{ fontWeight: 400 }}>— 背景＝カロリー収支の積み上げ</span></h2>
        <ProgressChart goal={goal} weights={weights} points={points} events={[]} today="2026-07-21" />
      </div>

      <div className="card">
        <h2>📅 カレンダー</h2>
        <Calendar today="2026-07-21" marks={marks} selected={daySel} onSelect={setDaySel} />
      </div>

      <Sheet open={daySel != null} onClose={() => setDaySel(null)}>
        {daySel && (
          <div>
            <div className="day-detail-head">
              <h2 style={{ margin: 0 }}>{daySel.replace(/-/g, '/')} の記録</h2>
              <span className="btn-ghost" style={{ padding: '7px 14px' }}>✎ この日を編集</span>
            </div>
            <div className="day-detail-kcal num">1,820<small style={{ fontSize: 13, color: 'var(--sub)', fontWeight: 600 }}> kcal 摂取</small></div>
            <div className="day-macro num"><span>P <b>128</b>g</span><span>F <b>52</b>g</span><span>C <b>190</b>g</span><span>⚖ <b>73.5</b>kg</span><span>📏 <b>79.0</b>cm</span></div>
            <div className="feed-row"><div className="feed-icon">🍽</div><div className="feed-body"><div>プロテイン、ゆで卵 320kcal</div><div className="muted feed-text num">08:12</div></div></div>
            <div className="feed-row"><div className="feed-icon">🍽</div><div className="feed-body"><div>牛丼並盛、サラダ 800kcal</div><div className="muted feed-text num">12:30</div></div></div>
            <div className="feed-row"><div className="feed-icon">🏃</div><div className="feed-body"><div>運動 通常</div><div className="muted feed-text num">18:40</div></div></div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, margin: '12px 0 6px' }}>📸 この日の写真</div>
            <div className="photo-row">
              <div style={{ textAlign: 'center' }}>
                <div className="thumb bphoto" style={{ background: 'var(--teal-weak)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📷</div>
                <div className="muted" style={{ fontSize: 11 }}>体脂肪 18%</div>
              </div>
            </div>
          </div>
        )}
      </Sheet>
    </AppShell>
  );
}
