'use client';
// 開発専用: 新UIをログインなしで確認するためのモック画面。
// 本番ビルドでは表示しない（デザイン確認のためだけのページ）。
import { useState } from 'react';
import { notFound } from 'next/navigation';
import AppShell from '@/components/AppShell';
import Sheet from '@/components/Sheet';

export default function DevPreviewPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
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

      <div className="hero2">
        <div className="hero2-label">あと食べられる（計画） <span className="pill OK">OK</span></div>
        <div className="hero2-num num">427<small> kcal</small></div>
        <div className="hline"><i style={{ width: '76%' }} /><b style={{ left: '76%' }} /></div>
        <div className="hero2-meta num"><span>摂取 1,373</span><span>目標 1,800</span></div>
        <div className="hero2-pfc num">
          <span>P <b>82</b>/150</span><span>F <b>41</b>/63</span><span>C <b>210</b>/250</span>
        </div>
      </div>
      <div className="card daybar" style={{ display: 'none' }}>
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
        <h2>今日の記録<span className="muted" style={{ fontWeight: 400, letterSpacing: 0 }}> — 3件</span></h2>
        {[
          { time: '08:12', title: 'プロテイン ×1、ゆで卵 ×2', sub: '', kcal: '320', green: false },
          { time: '12:30', title: '牛丼並盛 1杯、サラダ 1皿', sub: '昼は牛丼並盛とサラダ', kcal: '800', green: false },
          { time: '18:40', title: '運動 通常', sub: 'ジムで筋トレ1時間 ・ 体重 73.5kg', kcal: '+150', green: true },
        ].map((f, i) => (
          <div className="feed-row" key={i}>
            <span className="feed-time num">{f.time}</span>
            <div className="feed-body">
              <div className="feed-title">{f.title}</div>
              {f.sub && <div className="feed-sub muted">{f.sub}</div>}
            </div>
            <b className={`feed-kcal num ${f.green ? 'pos' : ''}`}>{f.kcal}{!f.green && <small> kcal</small>}</b>
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
          <button className="btn-primary" onClick={() => setComposerOpen(true)}>✏️ コンポーザーを開く(検証)</button>
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

      {/* 入力コンポーザーのモック（/log実装と同じクラス構成・コンパクト版） */}
      <Sheet open={composerOpen} onClose={() => setComposerOpen(false)}>
        <div className="composer">
          <textarea className="composer-ta" rows={3} defaultValue=""
                    placeholder={'食事・体重・気分を自由に…\n例）昼は牛丼並盛とサラダ。体重73.5kg'} />
          <div className="pick-strip">
            <button className="pick-tile"><span className="pick-ico">📷</span><span>カメラ</span></button>
            <button className="pick-wide">
              <span className="pick-ico">🖼️</span>
              <span className="pick-wide-t">
                <b>カメラロールをここに表示</b>
                <small>「すべての写真へのアクセスを許可」がおすすめです</small>
              </span>
            </button>
            {['#dbe4dd', '#e4dbd6', '#d6dde4', '#e0d6e4', '#e4e2d6', '#d6e4e0'].map((c, i) => (
              <button className="pick-thumb-btn" key={i} style={{ background: c }} />
            ))}
            <button className="pick-tile"><span className="pick-ico">⋯</span><span>すべて</span></button>
          </div>
          <div className="chip-strip" style={{ marginTop: 8, marginBottom: 0 }}>
            <button className="chip on">プロテイン ×</button>
            <button className="chip on">ゆで卵 ×2 ×</button>
            {['サラダチキン', '野菜鍋', 'オートミール'].map((n) => (
              <button key={n} className="chip">＋ {n}</button>
            ))}
          </div>
          <button className="btn-primary" style={{ marginTop: 10 }}>✨ AI解析</button>
          <div className="dock-hint num">マイ食品＋自由入力の併用もOK （今日あと12回）</div>
        </div>
      </Sheet>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <div>
          <h2>解析結果 <span className="muted" style={{ fontWeight: 400 }}>— 確認して保存</span></h2>
          {[{ n: '牛丼並盛', q: '1杯', k: 635, p: 20, f: 20, c: 92 }, { n: 'サラダ', q: '1皿', k: 85, p: 2, f: 5, c: 8 }].map((it) => (
            <div className="item-row" key={it.n}>
              <div className="item-row-head">
                <input className="item-input name-cell" defaultValue={it.n} readOnly />
                <input className="item-input qty-cell" defaultValue={it.q} readOnly />
                <button className="item-del">×</button>
              </div>
              <div className="item-row-nums">
                {([['kcal', it.k], ['P', it.p], ['F', it.f], ['C', it.c]] as const).map(([lbl, val]) => (
                  <div key={lbl}>
                    <span className="item-num-lbl">{lbl}{lbl !== 'kcal' ? ' (g)' : ''}</span>
                    <input className="item-input num" type="number" defaultValue={val} readOnly />
                  </div>
                ))}
              </div>
            </div>
          ))}
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
