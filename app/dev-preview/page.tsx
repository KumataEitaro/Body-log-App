'use client';
// 開発専用: 新UIをログインなしで確認するためのモック画面。
// 本番ビルドでは表示しない（デザイン確認のためだけのページ）。
import { useState } from 'react';
import { notFound } from 'next/navigation';
import AppShell from '@/components/AppShell';
import Sheet from '@/components/Sheet';

export default function DevPreviewPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  if (process.env.NODE_ENV === 'production') notFound();

  const macros = [
    { key: 'p', label: '🍗 Protein', eaten: 82, tgt: 150 },
    { key: 'f', label: '🥑 Fat', eaten: 41, tgt: 63 },
    { key: 'c', label: '🍚 Carbs', eaten: 210, tgt: 250 },
  ];
  const feed = [
    { icon: '🍽', main: '🍽 牛丼並盛、サラダ 720kcal', time: '12:24', text: '昼は牛丼並盛とサラダ' },
    { icon: '🏃', main: '🏃 通常(+150)', time: '18:05', text: 'ジムで筋トレ1時間' },
    { icon: '🍽', main: '🍽 鮭の塩焼き定食 650kcal ⏳', time: '19:40', text: '' },
  ];

  return (
    <AppShell userName="くまた">
      <div className="datenav">
        <button className="arrow">‹</button>
        <input type="date" defaultValue="2026-07-21" readOnly />
        <button className="arrow">›</button>
      </div>

      {/* 2週間レビュー（お祝い＋メンテナンスカロリー変更提案） */}
      <div className="card" style={{ border: '1.5px solid var(--teal)' }}>
        <h2>🎉 2週間継続おめでとうございます！</h2>
        <p className="muted" style={{ margin: '0 0 8px' }}>
          直近2週間の理論値（カロリー収支 −0.39kg 相当）と実測の体重変化（−0.78kg）のズレから、あなたの本当のメンテナンスカロリーを再計算しました。
        </p>
        <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="stat"><div className="stat-l">メンテナンスカロリー</div>
            <div className="stat-v num">1,800 → <span style={{ color: 'var(--teal)' }}>2,000</span><small> kcal/日</small></div></div>
          <div className="stat"><div className="stat-l">毎日の目標カロリー</div>
            <div className="stat-v num" style={{ fontSize: 14 }}>自動で上がります<small>（差 +200kcal）</small></div></div>
        </div>
        <div className="row2" style={{ marginTop: 10 }}>
          <button className="btn-primary">新しい値に更新する</button>
          <button className="btn-ghost">今のままにする</button>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>目標タブでいつでも手動調整できます。次回の見直しは2週間後です。</p>
      </div>

      <div className="card daybar">
        <div className="hero-label">今日あと食べられる（計画） <span className="pill OK">OK</span></div>
        {(() => {
          const eaten = 1373, goalKcal = 1800, R = 52, CIRC = 2 * Math.PI * R;
          const ratio = Math.min(1, eaten / goalKcal);
          return (
            <div className="ring-wrap">
              <svg viewBox="0 0 120 120">
                <circle className="ring-bg" cx="60" cy="60" r={R} />
                <circle className="ring-fg" cx="60" cy="60" r={R} strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - ratio)} />
              </svg>
              <div className="ring-center">
                <div className="ring-label">残り</div>
                <div className="ring-num num">427</div>
                <div className="ring-unit">kcal</div>
                <div className="ring-sub num">目標: 1,800 / 摂取: 1,373</div>
              </div>
            </div>
          );
        })()}
        <div className="macro-bars">
          {macros.map((m) => (
            <div key={m.key}>
              <div className="macro-bar-head">
                <span className="macro-bar-label">{m.label}</span>
                <span className="macro-bar-val num"><b>{m.eaten}</b>/{m.tgt}g</span>
              </div>
              <div className="macro-track">
                <div className={`macro-fill ${m.key}`} style={{ width: `${Math.min(100, (m.eaten / m.tgt) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="daybar-sub">
          <span>摂取済み <b className="num">1,373</b></span>
          <span>目安 <b className="num">2,150</b></span>
          <span>計画目標 <b className="num">1,800</b></span>
        </div>
        <div className="daybar-fine">基礎代謝1,540×1.3＋運動150＝目安2,150 ／ 必要赤字350/日</div>
      </div>

      <div className="card">
        <h2>今日 の記録 <span className="muted" style={{ fontWeight: 400 }}>3件</span></h2>
        {feed.map((f, i) => (
          <div className="feed-row" key={i}>
            <div className="feed-icon">{f.icon}</div>
            <div className="feed-body">
              <div>{f.main.replace(' ⏳', '')}{f.main.includes('⏳') && <span className="pending-tag">⏳未同期</span>}</div>
              <div className="muted feed-text"><span className="num">{f.time}</span>{f.text ? `　${f.text}` : ''}</div>
            </div>
            <button className="item-edit">✎</button>
            <button className="item-del">×</button>
          </div>
        ))}
      </div>

      {/* つらい/爆食のサイン検知 → 目標緩和リコメンド */}
      <div className="card" style={{ border: '1.5px solid var(--amber)' }}>
        <h2>😮‍💨 無理していませんか？</h2>
        <p className="muted" style={{ margin: '0 0 8px' }}>
          今日の記録に「つらい」のサインがありました。減量は続けられるペースがいちばん大事です。目標日を1週間延ばすと、毎日の目標カロリーが約180kcal緩みます。
        </p>
        <div className="row2">
          <button className="btn-primary">🕊 1週間延ばして緩める</button>
          <button className="btn-ghost">大丈夫、このまま続ける</button>
        </div>
      </div>

      <div className="card">
        <h2>📸 体の写真（進捗チェック）</h2>
        <p className="muted">アップするとAIが体脂肪率を推定し、前回との変化を比較できます。</p>
        <div className="row2" style={{ marginTop: 8 }}>
          <button className="btn-primary">📷 写真を選ぶ</button>
          <button className="btn-ghost" onClick={() => setSheetOpen(true)}>🔍 シートを開く(検証)</button>
        </div>
      </div>

      <div className="dock-spacer" />

      <div className="dock">
        <div className="dock-inner">
          <div className="chip-strip">
            {['プロテイン', 'サラダチキン', '野菜鍋', 'ゆで卵', 'オートミール'].map((n) => (
              <button key={n} className="chip">＋ {n}</button>
            ))}
          </div>
          <div className="dock-row">
            <button className="dock-cam">📷</button>
            <textarea rows={1} placeholder="食事・体重・気分を自由に…" readOnly />
            <button className="dock-send">✨ AI解析</button>
          </div>
          <div className="dock-hint num">写真だけでもOK・自由な言葉で （今日あと12回）</div>
        </div>
      </div>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <div>
          <h2>解析結果 <span className="muted" style={{ fontWeight: 400 }}>— 確認して保存</span></h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>品目</th><th>分量</th><th>kcal</th><th>P</th><th>F</th><th>C</th><th></th></tr></thead>
              <tbody>
                <tr><td>牛丼並盛</td><td>1杯</td><td className="num">635</td><td className="num">20</td><td className="num">20</td><td className="num">92</td><td><button className="item-del">×</button></td></tr>
                <tr><td>サラダ</td><td>1皿</td><td className="num">85</td><td className="num">2</td><td className="num">5</td><td className="num">8</td><td><button className="item-del">×</button></td></tr>
              </tbody>
            </table>
          </div>
          <div className="stat-grid" style={{ marginTop: 10 }}>
            <div className="stat"><div className="stat-l">この記録の摂取</div><div className="stat-v num">720<small> kcal</small></div></div>
            <div className="stat"><div className="stat-l">P / F / C</div><div className="stat-v num">22 / 25 / 100<small> g</small></div></div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>⚡ よく使う品目を追加</div>
            <div className="chips">
              {['プロテイン', 'ゆで卵'].map((n) => <button key={n} className="chip">＋ {n}</button>)}
            </div>
          </div>
          <button className="btn-primary" style={{ marginTop: 14 }}>この内容で保存する</button>
        </div>
      </Sheet>
    </AppShell>
  );
}
