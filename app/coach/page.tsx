'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { cacheGet } from '@/lib/cache';
import { friendlyError } from '@/lib/errmsg';
import { hapticTap } from '@/lib/native';
import { healthSleepDays, isHealthEnabled } from '@/lib/health';
import { todayJST } from '@/lib/calc';

// AIコーチ相談タブ。本人の実データ（摂取・栄養素・体重・気分・メモ＋睡眠）を根拠に答える。
// 睡眠はヘルスケアから端末上で取得してAPIに添える（サーバーからは読めないため）。

type CoachMsg = { role: 'user' | 'ai'; text: string };
const QUICK = ['気分がすぐれないんだけど、何が原因かな', '過食しちゃった…', '体重が減らなくなってきた', '最近トレの調子が上がらない'];

function shiftDate(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function CoachPage() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [msgs, setMsgs] = useState<CoachMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sleep, setSleep] = useState<{ date: string; min: number }[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [msgs, busy]);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) { router.push('/login'); return; }
      const h = cacheGet<{ userName: string }>(`loghdr:${uid}`);
      if (h?.userName) setUserName(h.userName);
      // 睡眠（ヘルスケア・対応ビルドのみ）: 直近7日を端末で取得してコーチの文脈に添える
      if (isHealthEnabled()) {
        try {
          const today = todayJST();
          const dates = Array.from({ length: 7 }, (_, i) => shiftDate(today, -i));
          const mins = await healthSleepDays(dates);
          setSleep(dates.map((d, i) => ({ date: d, min: mins[i] ?? -1 })).filter((s) => s.min > 0));
        } catch { /* 睡眠なしでも動く */ }
      }
    })();
  }, [router]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    hapticTap();
    const hist = msgs.slice(-6);
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/coach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: hist, sleep }),
      });
      const j = await res.json();
      if (j.detail) console.log('[coach] detail:', j.detail);
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setMsgs((m) => [...m, { role: 'ai', text: String(j.answer) }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'ai', text: friendlyError(e, 'うまく答えられませんでした。通信環境を確認して、もう一度お試しください。') }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell userName={userName}>
      <div className="card">
        <h2>🧠 AIコーチ<span className="muted" style={{ fontWeight: 400, letterSpacing: 0 }}> — あなたの記録が根拠</span></h2>
        <div className="chat-log coach-page" ref={logRef}>
          {msgs.length === 0 && (
            <p className="muted" style={{ fontSize: 12.5 }}>
              直近28日の摂取・収支・栄養素・体重・気分・メモ{sleep.length > 0 ? '・睡眠' : ''}を見た上で答えます。
              下の例をタップするか、自由に書いてください。
            </p>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`chat-b ${m.role}`}>{m.text}</div>
          ))}
          {busy && <div className="chat-b ai"><span className="spin" />データを確認しています…</div>}
        </div>
        {msgs.length === 0 && (
          <div className="chips" style={{ margin: '8px 0' }}>
            {QUICK.map((q) => (
              <button key={q} className="chip" onClick={() => send(q)}>{q}</button>
            ))}
          </div>
        )}
        <div className="chat-inrow">
          <textarea rows={1} value={input} placeholder="相談してみる…"
                    onChange={(e) => setInput(e.target.value)} />
          <button className="dock-send" onClick={() => send(input)} disabled={busy || !input.trim()}>送信</button>
        </div>
        <p className="muted" style={{ fontSize: 10.5, marginTop: 6, marginBottom: 0 }}>
          医療的な診断はできません。深刻な不調が続く場合は医療機関にご相談ください。
        </p>
      </div>
    </AppShell>
  );
}
