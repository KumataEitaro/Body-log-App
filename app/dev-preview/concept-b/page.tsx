'use client';
// UI改革コンセプトB「Calm Card」— ソフト白カード＋細リング。現行の正統進化（開発時のみ・本番404）

const I = {
  pencil: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>,
  chart: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/></svg>,
  target: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>,
  gear: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></svg>,
  cam: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8a2 2 0 0 1 2-2h1.5l1.5-2h8l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.5"/></svg>,
  meal: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M5 3v7a3 3 0 0 0 3 3v8"/><path d="M5 3v4M11 3v4"/><path d="M17 3c-1.5 0-3 2-3 5s1.5 5 3 5v8"/></svg>,
  run: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="14" cy="4.5" r="1.8"/><path d="M9 20l2.5-5L9 12l3-4 3 2.5 3 .5"/><path d="M6 15l2-3"/></svg>,
};

export default function ConceptB() {
  // 実機比較のため本番でも表示（静的モック・データなし）
  const R = 62, C = 2 * Math.PI * R;
  return (
    <div className="cb">
      <style>{`
        .cb { min-height: 100dvh; background: #f5f7f9; color: #1b2330; font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", sans-serif; padding: 0 14px 150px; }
        .cb * { box-sizing: border-box; }
        .cb-top { display: flex; align-items: center; justify-content: space-between; padding: 18px 8px 12px; }
        .cb-logo { font-size: 16px; font-weight: 800; letter-spacing: -0.02em; }
        .cb-date { font-size: 13px; font-weight: 600; color: #8a94a3; background: #fff; border-radius: 999px; padding: 7px 14px; box-shadow: 0 1px 2px rgba(27,35,48,0.04); }
        .cb-card { background: #fff; border-radius: 24px; padding: 22px 20px; box-shadow: 0 1px 3px rgba(27,35,48,0.05); margin-bottom: 12px; }
        .cb-ring-wrap { position: relative; width: 172px; height: 172px; margin: 4px auto 12px; }
        .cb-ring-wrap svg { transform: rotate(-90deg); }
        .cb-ring-c { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .cb-ring-l { font-size: 12px; font-weight: 600; color: #8a94a3; }
        .cb-ring-n { font-size: 40px; font-weight: 700; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; line-height: 1.1; }
        .cb-ring-u { font-size: 11px; color: #b0b8c4; font-weight: 600; }
        .cb-ring-s { font-size: 11px; color: #8a94a3; margin-top: 4px; font-variant-numeric: tabular-nums; }
        .cb-pfc { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
        .cb-pfc-h { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
        .cb-pfc-l { font-size: 11px; font-weight: 700; color: #8a94a3; }
        .cb-pfc-v { font-size: 11px; color: #b0b8c4; font-variant-numeric: tabular-nums; }
        .cb-pfc-v b { color: #1b2330; font-size: 12.5px; }
        .cb-track { height: 6px; border-radius: 999px; background: #eef1f5; overflow: hidden; }
        .cb-track i { display: block; height: 100%; border-radius: 999px; }
        .cb-sect { display: flex; justify-content: space-between; align-items: baseline; padding: 8px 8px 8px; }
        .cb-sect b { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
        .cb-sect a { font-size: 12px; color: #059669; font-weight: 600; text-decoration: none; }
        .cb-row { display: flex; align-items: center; gap: 12px; padding: 11px 0; }
        .cb-row + .cb-row { border-top: 1px solid #f2f4f7; }
        .cb-ico { width: 38px; height: 38px; border-radius: 13px; display: flex; align-items: center; justify-content: center; flex: none; }
        .cb-ico.meal { background: #e7f6f0; color: #059669; }
        .cb-ico.run { background: #eef4fd; color: #3b82f6; }
        .cb-body { flex: 1; min-width: 0; }
        .cb-body b { display: block; font-size: 14.5px; font-weight: 600; }
        .cb-body span { font-size: 12px; color: #8a94a3; font-variant-numeric: tabular-nums; }
        .cb-k { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .cb-k small { font-size: 10.5px; color: #b0b8c4; font-weight: 600; }
        .cb-dock { position: fixed; left: 14px; right: 14px; bottom: 78px; background: #fff; border-radius: 26px; box-shadow: 0 8px 30px rgba(27,35,48,0.10); padding: 8px; display: flex; gap: 6px; align-items: center; }
        .cb-dock-cam { width: 40px; height: 40px; border-radius: 50%; border: none; background: #f2f4f7; display: flex; align-items: center; justify-content: center; color: #5d6776; }
        .cb-dock-in { flex: 1; border: none; background: none; font-size: 15px; color: #8a94a3; text-align: left; padding: 0 4px; }
        .cb-dock-go { height: 40px; padding: 0 18px; border-radius: 20px; border: none; background: #059669; color: #fff; font-size: 14px; font-weight: 700; }
        .cb-tab { position: fixed; left: 0; right: 0; bottom: 0; height: 66px; background: rgba(255,255,255,0.94); backdrop-filter: blur(20px); border-top: 1px solid #eef1f5; display: flex; }
        .cb-tab a { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #b0b8c4; font-size: 10px; font-weight: 600; text-decoration: none; position: relative; }
        .cb-tab a.on { color: #059669; }
        .cb-tab a.on::before { content: ''; position: absolute; top: 8px; width: 44px; height: 30px; background: #e7f6f0; border-radius: 999px; z-index: -1; }
        .cb-tab a.on svg, .cb-tab a.on { z-index: 0; }
      `}</style>
      <div className="cb-top">
        <span className="cb-logo">BodyLog</span>
        <span className="cb-date">7月21日（火）</span>
      </div>
      <div className="cb-card" style={{ textAlign: 'center' }}>
        <div className="cb-ring-wrap">
          <svg width="172" height="172" viewBox="0 0 172 172">
            <circle cx="86" cy="86" r={R} fill="none" stroke="#eef1f5" strokeWidth="9" />
            <circle cx="86" cy="86" r={R} fill="none" stroke="#059669" strokeWidth="9" strokeLinecap="round"
                    strokeDasharray={C} strokeDashoffset={C * 0.24} />
          </svg>
          <div className="cb-ring-c">
            <span className="cb-ring-l">あと食べられる</span>
            <span className="cb-ring-n">427</span>
            <span className="cb-ring-u">kcal</span>
            <span className="cb-ring-s">目標 1,800・摂取 1,373</span>
          </div>
        </div>
        <div className="cb-pfc" style={{ textAlign: 'left' }}>
          {[{ l: 'たんぱく質', v: 82, m: 150, c: '#059669' }, { l: '脂質', v: 41, m: 63, c: '#f59e0b' }, { l: '炭水化物', v: 210, m: 250, c: '#38bdf8' }].map((p) => (
            <div key={p.l}>
              <div className="cb-pfc-h"><span className="cb-pfc-l">{p.l}</span><span className="cb-pfc-v"><b>{p.v}</b>/{p.m}</span></div>
              <div className="cb-track"><i style={{ width: `${(p.v / p.m) * 100}%`, background: p.c }} /></div>
            </div>
          ))}
        </div>
      </div>
      <div className="cb-sect"><b>今日の記録</b><a>すべて見る</a></div>
      <div className="cb-card" style={{ padding: '6px 18px' }}>
        <div className="cb-row"><span className="cb-ico meal">{I.meal}</span><span className="cb-body"><b>プロテイン、ゆで卵</b><span>08:12</span></span><span className="cb-k">320<small> kcal</small></span></div>
        <div className="cb-row"><span className="cb-ico meal">{I.meal}</span><span className="cb-body"><b>牛丼並盛、サラダ</b><span>12:30</span></span><span className="cb-k">800<small> kcal</small></span></div>
        <div className="cb-row"><span className="cb-ico run">{I.run}</span><span className="cb-body"><b>筋トレ 1時間</b><span>18:40</span></span><span className="cb-k" style={{ color: '#059669' }}>+150</span></div>
      </div>
      <div className="cb-dock">
        <button className="cb-dock-cam">{I.cam}</button>
        <button className="cb-dock-in">食事・体重・気分を自由に…</button>
        <button className="cb-dock-go">✨ 解析</button>
      </div>
      <nav className="cb-tab">
        <a className="on">{I.pencil}入力</a>
        <a>{I.chart}ダッシュボード</a>
        <a>{I.target}目標</a>
        <a>{I.gear}設定</a>
      </nav>
    </div>
  );
}
