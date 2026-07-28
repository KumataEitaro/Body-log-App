'use client';
// UI改革コンセプトC「Editorial」— 数字が主役のモノトーン＋エメラルド1点（開発時のみ・本番404）

const I = {
  pencil: <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>,
  chart: <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/></svg>,
  target: <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>,
  gear: <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></svg>,
  cam: <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8a2 2 0 0 1 2-2h1.5l1.5-2h8l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.5"/></svg>,
};

export default function ConceptC() {
  // 実機比較のため本番でも表示（静的モック・データなし）
  return (
    <div className="cc">
      <style>{`
        .cc { min-height: 100dvh; background: #fbfbfa; color: #0e1116; font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", sans-serif; padding-bottom: 150px; }
        .cc * { box-sizing: border-box; }
        .cc-top { display: flex; align-items: baseline; justify-content: space-between; padding: 20px 22px 0; }
        .cc-logo { font-size: 14px; font-weight: 800; letter-spacing: 0.02em; }
        .cc-date { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: #9aa1ab; }
        .cc-hero { padding: 34px 22px 0; }
        .cc-hero-l { font-size: 11px; font-weight: 800; letter-spacing: 0.18em; color: #9aa1ab; }
        .cc-num { font-size: 92px; font-weight: 700; letter-spacing: -0.05em; line-height: 1; font-variant-numeric: tabular-nums; margin-top: 6px; }
        .cc-num small { font-size: 15px; font-weight: 600; color: #9aa1ab; letter-spacing: 0; }
        .cc-line { margin: 22px 22px 0; height: 4px; background: #e9eae7; position: relative; }
        .cc-line i { position: absolute; inset: 0; width: 76%; background: #059669; }
        .cc-line b { position: absolute; left: 76%; top: -5px; width: 14px; height: 14px; border-radius: 50%; background: #059669; border: 3px solid #fbfbfa; transform: translateX(-7px); }
        .cc-meta { display: flex; justify-content: space-between; padding: 12px 22px 0; font-size: 12px; font-weight: 600; color: #6a7280; font-variant-numeric: tabular-nums; }
        .cc-pfc { margin: 28px 22px 0; font-size: 13.5px; font-weight: 600; color: #6a7280; font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }
        .cc-pfc b { color: #0e1116; font-weight: 700; }
        .cc-pfc span { margin-right: 16px; }
        .cc-h2 { margin: 40px 22px 0; font-size: 11px; font-weight: 800; letter-spacing: 0.18em; color: #9aa1ab; padding-bottom: 10px; border-bottom: 2px solid #0e1116; }
        .cc-ledger { margin: 0 22px; }
        .cc-lrow { display: flex; align-items: baseline; padding: 14px 0; border-bottom: 1px solid #e9eae7; gap: 12px; }
        .cc-ltime { font-size: 11px; font-weight: 700; color: #9aa1ab; width: 40px; flex: none; font-variant-numeric: tabular-nums; }
        .cc-lwhat { flex: 1; font-size: 15px; font-weight: 500; }
        .cc-lkcal { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .cc-lkcal small { font-size: 10px; color: #9aa1ab; }
        .cc-dock { position: fixed; left: 0; right: 0; bottom: 62px; background: rgba(251,251,250,0.94); backdrop-filter: blur(18px); border-top: 1px solid #e9eae7; padding: 10px 16px; display: flex; gap: 8px; align-items: center; }
        .cc-dock-cam { width: 42px; height: 42px; border: 1.5px solid #0e1116; border-radius: 4px; background: none; color: #0e1116; display: flex; align-items: center; justify-content: center; }
        .cc-dock-in { flex: 1; height: 42px; border: 1.5px solid #d8dad5; border-radius: 4px; background: #fff; padding: 0 12px; font-size: 15px; color: #9aa1ab; text-align: left; }
        .cc-dock-go { height: 42px; padding: 0 20px; border: none; border-radius: 4px; background: #0e1116; color: #fff; font-size: 13px; font-weight: 800; letter-spacing: 0.08em; }
        .cc-tab { position: fixed; left: 0; right: 0; bottom: 0; height: 62px; background: rgba(251,251,250,0.94); backdrop-filter: blur(18px); border-top: 1px solid #e9eae7; display: flex; }
        .cc-tab a { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #b9bfc7; font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em; text-decoration: none; }
        .cc-tab a.on { color: #0e1116; }
        .cc-tab a.on::after { content: ''; width: 4px; height: 4px; border-radius: 50%; background: #059669; }
      `}</style>
      <div className="cc-top">
        <span className="cc-logo">BodyLog</span>
        <span className="cc-date">07.21 TUE</span>
      </div>
      <div className="cc-hero">
        <div className="cc-hero-l">あと食べられる</div>
        <div className="cc-num">427<small> kcal</small></div>
      </div>
      <div className="cc-line"><i /><b /></div>
      <div className="cc-meta"><span>摂取 1,373</span><span>目標 1,800</span></div>
      <div className="cc-pfc">
        <span>P <b>82</b>/150</span>
        <span>F <b>41</b>/63</span>
        <span>C <b>210</b>/250</span>
      </div>
      <div className="cc-h2">今日の記録 — 3件</div>
      <div className="cc-ledger">
        <div className="cc-lrow"><span className="cc-ltime">08:12</span><span className="cc-lwhat">プロテイン、ゆで卵</span><span className="cc-lkcal">320<small> KCAL</small></span></div>
        <div className="cc-lrow"><span className="cc-ltime">12:30</span><span className="cc-lwhat">牛丼並盛、サラダ</span><span className="cc-lkcal">800<small> KCAL</small></span></div>
        <div className="cc-lrow"><span className="cc-ltime">18:40</span><span className="cc-lwhat">筋トレ 1時間</span><span className="cc-lkcal" style={{ color: '#059669' }}>+150</span></div>
      </div>
      <div className="cc-dock">
        <button className="cc-dock-cam">{I.cam}</button>
        <button className="cc-dock-in">食事・体重・気分を自由に…</button>
        <button className="cc-dock-go">解析</button>
      </div>
      <nav className="cc-tab">
        <a className="on">{I.pencil}入力</a>
        <a>{I.chart}ダッシュボード</a>
        <a>{I.target}目標</a>
        <a>{I.gear}設定</a>
      </nav>
    </div>
  );
}
