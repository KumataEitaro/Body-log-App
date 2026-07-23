'use client';
import { useState } from 'react';

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

export type DayMark = { logged: boolean; over: boolean };

function keyOf(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * 月グリッドのカレンダー。日付タップで onSelect(dateKey)。
 * 記録あり=緑ドット / 目標超過=赤ドット / 今日=強調。
 */
export default function Calendar({
  today, marks, selected, onSelect,
}: {
  today: string;
  marks: Map<string, DayMark>;
  selected: string | null;
  onSelect: (dateKey: string) => void;
}) {
  const [y0, m0] = today.split('-').map(Number);
  const [view, setView] = useState({ y: y0, m: m0 - 1 }); // m: 0-11

  const first = new Date(view.y, view.m, 1);
  const lastDate = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: lastDate }, (_, i) => i + 1)];
  const monthLabel = `${view.y}年${view.m + 1}月`;

  function shiftMonth(n: number) {
    const d = new Date(view.y, view.m + n, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  }

  return (
    <div>
      <div className="cal-head">
        <button className="cal-nav" onClick={() => shiftMonth(-1)} aria-label="前の月">‹</button>
        <span className="cal-month">{monthLabel}</span>
        <button className="cal-nav" onClick={() => shiftMonth(1)} aria-label="次の月">›</button>
      </div>
      <div className="cal-grid">
        {DOW.map((d, i) => (
          <div key={d} className="cal-dow" style={i === 0 ? { color: 'var(--coral)' } : i === 6 ? { color: 'var(--blue)' } : undefined}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} />;
          const k = keyOf(view.y, view.m, day);
          const mk = marks.get(k);
          const isToday = k === today;
          const isSel = k === selected;
          const future = k > today;
          return (
            <button key={k} className={`cal-cell ${isSel ? 'sel' : ''} ${future ? 'future' : ''}`} onClick={() => onSelect(k)} disabled={future}>
              <span className={`cal-num ${isToday ? 'today' : ''}`}>{day}</span>
              <span className={`cal-dot ${!mk?.logged ? 'none' : mk.over ? 'over' : 'ok'}`} />
            </button>
          );
        })}
      </div>
      <div className="chart-legend" style={{ justifyContent: 'center', marginTop: 4 }}>
        <span><i style={{ background: 'var(--green)', borderRadius: '50%' }} />記録あり</span>
        <span><i style={{ background: 'var(--coral)', borderRadius: '50%' }} />目標超過</span>
        <span className="muted">日付をタップで詳細・編集</span>
      </div>
    </div>
  );
}
