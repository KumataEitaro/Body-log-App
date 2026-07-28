'use client';
// UI改革コンセプトA「Air」— カードレス・純白・罫線と余白のミニマル（開発時のみ・本番404）

const I = {
  pencil: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>,
  chart: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/></svg>,
  target: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>,
  gear: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></svg>,
  cam: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8a2 2 0 0 1 2-2h1.5l1.5-2h8l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.5"/></svg>,
  meal: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5 3v7a3 3 0 0 0 3 3v8"/><path d="M5 3v4M11 3v4"/><path d="M17 3c-1.5 0-3 2-3 5s1.5 5 3 5v8"/></svg>,
  run: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="14" cy="4.5" r="1.8"/><path d="M9 20l2.5-5L9 12l3-4 3 2.5 3 .5"/><path d="M6 15l2-3"/></svg>,
};

export default function ConceptA() {
  // 実機比較のため本番でも表示（静的モック・データなし）
  return (
    <div className="ca">
      <style>{`
        .ca { min-height: 100dvh; background: #fff; color: #14181f; font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", sans-serif; padding-bottom: 140px; }
        .ca * { box-sizing: border-box; }
        .ca-top { display: flex; align-items: center; justify-content: space-between; padding: 18px 24px 6px; }
        .ca-logo { font-size: 15px; font-weight: 800; letter-spacing: -0.02em; }
        .ca-avatar { width: 28px; height: 28px; border-radius: 50%; background: #eef1f4; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #6b7684; }
        .ca-date { padding: 18px 24px 2px; font-size: 21px; font-weight: 700; letter-spacing: -0.01em; }
        .ca-date small { color: #98a1ad; font-weight: 500; font-size: 13px; margin-left: 8px; }
        .ca-hero { padding: 26px 24px 6px; }
        .ca-hero-l { font-size: 12px; font-weight: 600; color: #98a1ad; }
        .ca-num { font-size: 76px; font-weight: 250; letter-spacing: -0.04em; line-height: 1.05; font-variant-numeric: tabular-nums; }
        .ca-num small { font-size: 17px; font-weight: 500; color: #98a1ad; letter-spacing: 0; margin-left: 6px; }
        .ca-bar { height: 3px; background: #f0f2f5; border-radius: 2px; margin: 18px 24px 0; overflow: hidden; }
        .ca-bar i { display: block; height: 100%; width: 76%; background: #059669; border-radius: 2px; }
        .ca-sub { display: flex; justify-content: space-between; padding: 8px 24px 0; font-size: 12px; color: #98a1ad; font-variant-numeric: tabular-nums; }
        .ca-pfc { display: grid; grid-template-columns: 1fr 1fr 1fr; margin: 26px 24px 0; border-top: 1px solid #eef1f4; }
        .ca-pfc div { padding: 14px 0 0; }
        .ca-pfc div + div { border-left: 1px solid #eef1f4; padding-left: 18px; }
        .ca-pfc b { display: block; font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
        .ca-pfc b small { font-size: 12px; color: #b6bec9; font-weight: 500; }
        .ca-pfc span { font-size: 11px; color: #98a1ad; font-weight: 600; }
        .ca-sect { margin: 34px 24px 0; padding-top: 16px; border-top: 1px solid #eef1f4; }
        .ca-sect-t { font-size: 12px; font-weight: 700; color: #98a1ad; letter-spacing: 0.06em; }
        .ca-feed { margin-top: 4px; }
        .ca-row { display: flex; align-items: baseline; gap: 14px; padding: 13px 0; border-bottom: 1px solid #f5f7f9; }
        .ca-row:last-child { border-bottom: none; }
        .ca-time { font-size: 12px; color: #b6bec9; font-variant-numeric: tabular-nums; width: 38px; flex: none; }
        .ca-what { flex: 1; font-size: 15px; display: flex; align-items: center; gap: 8px; color: #14181f; }
        .ca-what svg { color: #98a1ad; flex: none; }
        .ca-kcal { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
        .ca-kcal small { font-size: 11px; color: #b6bec9; font-weight: 500; }
        .ca-dock { position: fixed; left: 0; right: 0; bottom: 64px; background: rgba(255,255,255,0.92); backdrop-filter: blur(20px); border-top: 1px solid #eef1f4; padding: 10px 16px; display: flex; gap: 8px; align-items: center; }
        .ca-dock-in { flex: 1; height: 42px; border-radius: 21px; background: #f3f5f7; border: none; padding: 0 16px; font-size: 15px; color: #98a1ad; text-align: left; }
        .ca-dock-cam { width: 42px; height: 42px; border-radius: 50%; border: none; background: #f3f5f7; color: #6b7684; display: flex; align-items: center; justify-content: center; }
        .ca-dock-go { height: 42px; padding: 0 18px; border-radius: 21px; border: none; background: #059669; color: #fff; font-size: 14px; font-weight: 700; }
        .ca-tab { position: fixed; left: 0; right: 0; bottom: 0; height: 64px; background: rgba(255,255,255,0.92); backdrop-filter: blur(20px); border-top: 1px solid #eef1f4; display: flex; }
        .ca-tab a { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #b6bec9; font-size: 10px; font-weight: 600; text-decoration: none; }
        .ca-tab a.on { color: #059669; }
      `}</style>
      <div className="ca-top">
        <span className="ca-logo">BodyLog</span>
        <span className="ca-avatar">く</span>
      </div>
      <div className="ca-date">7月21日<small>火曜日</small></div>
      <div className="ca-hero">
        <div className="ca-hero-l">あと食べられる</div>
        <div className="ca-num">427<small>kcal</small></div>
      </div>
      <div className="ca-bar"><i /></div>
      <div className="ca-sub"><span>摂取 1,373</span><span>目標 1,800</span></div>
      <div className="ca-pfc">
        <div><b>82<small> /150g</small></b><span>たんぱく質</span></div>
        <div><b>41<small> /63g</small></b><span>脂質</span></div>
        <div><b>210<small> /250g</small></b><span>炭水化物</span></div>
      </div>
      <div className="ca-sect">
        <div className="ca-sect-t">今日の記録</div>
        <div className="ca-feed">
          <div className="ca-row"><span className="ca-time">08:12</span><span className="ca-what">{I.meal}プロテイン、ゆで卵</span><span className="ca-kcal">320<small> kcal</small></span></div>
          <div className="ca-row"><span className="ca-time">12:30</span><span className="ca-what">{I.meal}牛丼並盛、サラダ</span><span className="ca-kcal">800<small> kcal</small></span></div>
          <div className="ca-row"><span className="ca-time">18:40</span><span className="ca-what">{I.run}筋トレ 1時間</span><span className="ca-kcal" style={{ color: '#059669' }}>+150</span></div>
        </div>
      </div>
      <div className="ca-dock">
        <button className="ca-dock-cam">{I.cam}</button>
        <button className="ca-dock-in">食事・体重・気分を自由に…</button>
        <button className="ca-dock-go">解析</button>
      </div>
      <nav className="ca-tab">
        <a className="on">{I.pencil}入力</a>
        <a>{I.chart}ダッシュボード</a>
        <a>{I.target}目標</a>
        <a>{I.gear}設定</a>
      </nav>
    </div>
  );
}
