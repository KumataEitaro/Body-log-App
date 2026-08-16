'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { todayJST } from '@/lib/calc';
import { cacheGet } from '@/lib/cache';
import { syncEntriesForDate } from '@/lib/daysync';
import { friendlyError } from '@/lib/errmsg';
import { hapticSuccess, hapticTap } from '@/lib/native';
import { healthReadWorkouts, healthActiveEnergyDays, healthStepsDays, isHealthEnabled, type HealthWorkout } from '@/lib/health';
import { trainingSeries, volumeVerdict } from '@/lib/training';
import InteractiveChart from '@/components/InteractiveChart';

// トレーニング専用ページ。
// - 挙上重量（種目×kg×回×set）の入力 → 「🏋️ ベンチプレス 80kg×8×3」形式で保存（分析エンジンがパース可能）
// - 過去のトレーニング履歴
// - ヘルスケアのワークアウト・今日の活動（対応ビルドのみ・無ければ非表示）

type TRow = { name: string; kg: string; reps: string; sets: string };
type HistRow = { id: string; date: string; text: string };

function timeLabel(date: string): string {
  return date.replace(/-/g, '/');
}

export default function TrainingPage() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [tRows, setTRows] = useState<TRow[]>([{ name: '', kg: '', reps: '', sets: '' }]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [workouts, setWorkouts] = useState<HealthWorkout[]>([]);
  const [activity, setActivity] = useState<{ kcal: number | null; steps: number | null }>({ kcal: null, steps: null });
  const [goalKgMap, setGoalKgMap] = useState<Map<string, number>>(new Map()); // 種目→目標重量（グラフの目標線）

  const setTRow = (i: number, patch: Partial<TRow>) =>
    setTRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) { router.push('/login'); return; }
      const h = cacheGet<{ userName: string }>(`loghdr:${uid}`);
      if (h?.userName) setUserName(h.userName);
      const { data } = await supabase.from('logs').select('id,date,text')
        .like('text', '🏋️%').order('at', { ascending: false }).limit(40);
      setHistory((data as HistRow[]) || []);
      // 筋トレ重量目標（テーブル未作成でも静かに無視）
      const { data: tg } = await supabase.from('training_goals').select('name,target_kg');
      if (tg) setGoalKgMap(new Map(tg.map((g: { name: string; target_kg: number }) => [g.name, Number(g.target_kg)])));
      // ヘルスケア（対応ビルド・連携ONのみ。失敗は静かに無視）
      if (isHealthEnabled()) {
        healthReadWorkouts(14).then(setWorkouts).catch(() => { /* 無視 */ });
        const today = todayJST();
        healthActiveEnergyDays([today]).then((v) => setActivity((a) => ({ ...a, kcal: v[0] }))).catch(() => { /* 無視 */ });
        healthStepsDays([today]).then((v) => setActivity((a) => ({ ...a, steps: v[0] }))).catch(() => { /* 無視 */ });
      }
    })();
  }, [router]);

  function trainingText(): string {
    const parts = tRows
      .filter((r) => r.name.trim() && Number(r.kg) > 0 && Number(r.reps) > 0)
      .map((r) => `${r.name.trim()} ${Number(r.kg)}kg×${Number(r.reps)}${Number(r.sets) > 1 ? `×${Number(r.sets)}` : ''}`);
    return parts.length > 0 ? `🏋️ ${parts.join('、')}` : '';
  }

  async function save() {
    const tr = trainingText();
    if (!tr) { setMsg({ cls: 'err', text: '種目・重量(kg)・回数を入力してください。' }); return; }
    setSaving(true); setMsg(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) { router.push('/login'); return; }
      const today = todayJST();
      const { data: ins, error } = await supabase.from('logs').insert({
        user_id: uid, date: today,
        items: [], kcal: null, p: null, f: null, c: null,
        weight: null, ex: 'オフ', adj: 0, mood: '', text: tr, photo_urls: [],
      }).select('id,date,text').single();
      if (error) { setMsg({ cls: 'err', text: friendlyError(new Error(error.message), '保存に失敗しました。もう一度お試しください。') }); return; }
      await syncEntriesForDate(supabase, uid, today);
      hapticSuccess();
      setHistory((prev) => [ins as HistRow, ...prev]);
      setMsg({ cls: 'ok', text: `保存しました（${tRows.filter((r) => r.name.trim()).length}種目）。継続が最強の種目です💪` });
      setTRows([{ name: '', kg: '', reps: '', sets: '' }]);
    } finally {
      setSaving(false);
    }
  }

  const showActivity = activity.kcal != null || activity.steps != null;

  // ===== 種目ごとの進捗（挙上重量の折れ線＋ボリューム判定） =====
  const [selExercise, setSelExercise] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<'kg' | 'volume'>('kg');
  const series = trainingSeries(history);
  // 種目チップは記録日数の多い順
  const exercises = [...series.entries()].sort((a, b) => b[1].length - a[1].length).map(([n]) => n);
  const activeEx = selExercise && series.has(selExercise) ? selExercise : exercises[0] ?? null;
  const exPoints = activeEx ? series.get(activeEx)! : [];
  const verdict = volumeVerdict(exPoints);

  return (
    <AppShell userName={userName}>
      {/* 今日の活動（ヘルスケア対応ビルドのみ） */}
      {showActivity && (
        <div className="card">
          <h2>⌚ 今日の活動<span className="muted" style={{ fontWeight: 400, letterSpacing: 0 }}> — ヘルスケア実測</span></h2>
          <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="stat"><div className="stat-l">アクティブカロリー</div>
              <div className="stat-v num">{activity.kcal != null ? activity.kcal.toLocaleString() : '—'}<small> kcal</small></div></div>
            <div className="stat"><div className="stat-l">歩数</div>
              <div className="stat-v num">{activity.steps != null ? activity.steps.toLocaleString() : '—'}<small> 歩</small></div></div>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>この消費は「あと食べられる」の計算に自動反映されています</p>
        </div>
      )}

      {/* 挙上重量の入力 */}
      <div className="card">
        <h2>🏋️ 今日のトレーニングを記録</h2>
        <p className="muted" style={{ marginTop: 0 }}>種目・重量・回数・セット。挙上重量の推移や、食事×パフォーマンスの分析に使われます。</p>
        {tRows.map((r, i) => (
          <div className="train-row" key={i}>
            <input placeholder="種目（ベンチプレス）" value={r.name} onChange={(e) => setTRow(i, { name: e.target.value })} />
            <input type="number" inputMode="decimal" className="num" placeholder="kg" value={r.kg} onChange={(e) => setTRow(i, { kg: e.target.value })} />
            <input type="number" inputMode="numeric" className="num" placeholder="回" value={r.reps} onChange={(e) => setTRow(i, { reps: e.target.value })} />
            <input type="number" inputMode="numeric" className="num" placeholder="set" value={r.sets} onChange={(e) => setTRow(i, { sets: e.target.value })} />
            <button className="item-del" onClick={() => setTRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs))}>×</button>
          </div>
        ))}
        <div className="row2" style={{ marginTop: 8 }}>
          <button className="btn-ghost" onClick={() => { hapticTap(); setTRows((rs) => [...rs, { name: '', kg: '', reps: '', sets: '' }]); }}>＋ 種目を追加</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? <><span className="spin" />保存中…</> : '保存する'}
          </button>
        </div>
        {msg && <div className={`msg ${msg.cls}`}>{msg.text}</div>}
      </div>

      {/* 種目ごとの進捗（1本の折れ線＋種目選択＋ボリューム判定） */}
      {exercises.length > 0 && (
        <div className="card">
          <h2>📈 挙上重量の推移</h2>
          <div className="chips" style={{ marginBottom: 8 }}>
            {(['kg', 'volume'] as const).map((m) => (
              <button key={m} className={`chip ${chartMode === m ? 'on' : ''}`} onClick={() => setChartMode(m)}>
                {m === 'kg' ? '重量(kg)' : 'ボリューム(kg×回)'}
              </button>
            ))}
          </div>
          {exPoints.length >= 2 ? (
            <InteractiveChart
              key={`${activeEx}-${chartMode}`}
              series={exPoints.map((p) => ({ date: p.date, value: chartMode === 'kg' ? p.maxKg : p.volume }))}
              today={todayJST()} unit={chartMode === 'kg' ? 'kg' : 'kg·回'} decimals={0} minSpan={chartMode === 'kg' ? 5 : 200}
              plan={chartMode === 'kg' && activeEx && goalKgMap.has(activeEx)
                ? [{ date: exPoints[0].date, value: goalKgMap.get(activeEx)! }, { date: todayJST(), value: goalKgMap.get(activeEx)! }]
                : undefined}
            />
          ) : (
            <p className="muted">「{activeEx}」の記録が2回以上たまるとグラフが描かれます。</p>
          )}
          {/* 種目選択 */}
          <div className="chips" style={{ marginTop: 8 }}>
            {exercises.map((n) => (
              <button key={n} className={`chip ${n === activeEx ? 'on' : ''}`} onClick={() => { hapticTap(); setSelExercise(n); }}>{n}</button>
            ))}
          </div>
          {/* ボリューム判定: 直近セッション vs 直前最大3回の平均 */}
          {verdict && (
            <div className={`msg ${verdict.trend === 'down' ? 'warn' : 'ok'}`} style={{ marginTop: 10 }}>
              {verdict.trend === 'up' && `💪 ボリューム上昇中：直近 ${verdict.lastVolume.toLocaleString()}kg·回（それまでの平均 ${verdict.baseVolume.toLocaleString()} に対して +${verdict.pct}%）。順調に強くなっています`}
              {verdict.trend === 'flat' && `➡️ ボリューム維持：直近 ${verdict.lastVolume.toLocaleString()}kg·回（平均比 ${verdict.pct > 0 ? '+' : ''}${verdict.pct}%）。減量中の維持は十分な成果です`}
              {verdict.trend === 'down' && `⚠️ ボリューム低下：直近 ${verdict.lastVolume.toLocaleString()}kg·回（平均比 ${verdict.pct}%）。赤字が深すぎるサインかも。たんぱく質と睡眠を確認しましょう`}
            </div>
          )}
        </div>
      )}

      {/* ヘルスケアのワークアウト（直近14日・対応ビルドのみ） */}
      {workouts.length > 0 && (
        <div className="card">
          <h2>❤️ ワークアウト<span className="muted" style={{ fontWeight: 400, letterSpacing: 0 }}> — ヘルスケアから（直近14日）</span></h2>
          {[...workouts].reverse().slice(0, 10).map((w, i) => (
            <div className="feed-row" key={i}>
              <span className="feed-time num">{new Date(w.start).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}</span>
              <div className="feed-body">
                <div className="feed-title">{w.type} {w.minutes}分</div>
              </div>
              {w.kcal > 0 && <b className="feed-kcal num pos">+{w.kcal}</b>}
            </div>
          ))}
        </div>
      )}

      {/* 筋トレ履歴 */}
      <div className="card">
        <h2>📖 筋トレ履歴</h2>
        {history.length === 0 && <p className="muted">まだ記録がありません。今日の1セット目から始めましょう。</p>}
        {history.map((h) => (
          <div className="feed-row" key={h.id}>
            <span className="feed-time num">{timeLabel(h.date).slice(5)}</span>
            <div className="feed-body">
              <div className="feed-title">{h.text.replace(/^🏋️ /, '')}</div>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
