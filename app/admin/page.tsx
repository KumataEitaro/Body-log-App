'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { isUnlimited } from '@/lib/calc';

type Row = {
  email: string; name: string; signedUp: string; lastSignIn: string;
  recordDays: number; lastRecord: string | null;
  firstWeight: number | null; latestWeight: number | null; deltaKg: number | null;
  goal: string | null; aiToday: number; aiTotal: number;
  photoCount: number; lastPhoto: string | null;
};

// 管理コンソール（アプリ本体とは独立。アプリ内からのリンクは無く、直接URLでのみアクセス）
export default function AdminPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      if (!isUnlimited(user.email)) { router.push('/dashboard'); return; }
      setEmail(user.email || '');
      const res = await fetch('/api/admin/overview');
      const j = await res.json();
      if (!res.ok || !j.ok) { setErr(j.error || `HTTP ${res.status}`); return; }
      setRows(j.users);
    })();
  }, [router]);

  return (
    <>
      <div className="topbar" style={{ background: '#1a1028' }}>
        <span className="bar" style={{ background: 'var(--coral)' }} />
        <h1>BodyLog Ops</h1>
        <span className="spacer" />
        <span className="who">{email}</span>
      </div>
      <div className="wrap">
        <div className="card">
          <h2>🛠 全ユーザーの利用状況</h2>
          <p className="muted">
            管理者専用コンソール（アプリ本体からは非リンク）。体写真の画像・食事メモの本文は表示されません。
          </p>
          {err && <div className="msg err">{err}</div>}
          {!rows && !err && <p className="muted">読み込み中…</p>}
          {rows && (
            <>
              <p className="muted">登録 {rows.length}人 ／ 直近記録が新しい順 ／ このURLはブックマーク推奨</p>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>ユーザー</th><th>最終記録</th><th>記録日数</th>
                      <th>体重 開始→最新</th><th>目標</th>
                      <th>AI(今日/累計)</th><th>写真</th><th>登録日</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.email}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{r.name || '—'}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{r.email}</div>
                        </td>
                        <td className="num">{r.lastRecord ? r.lastRecord.slice(5) : '—'}</td>
                        <td className="num">{r.recordDays}日</td>
                        <td className="num">
                          {r.firstWeight != null && r.latestWeight != null
                            ? <>{r.firstWeight.toFixed(1)}→{r.latestWeight.toFixed(1)}kg
                                <span style={{ color: (r.deltaKg ?? 0) <= 0 ? 'var(--green)' : 'var(--coral)', fontWeight: 700 }}>
                                  （{(r.deltaKg ?? 0) > 0 ? '+' : ''}{r.deltaKg}）
                                </span></>
                            : '—'}
                        </td>
                        <td>{r.goal ?? '—'}</td>
                        <td className="num">{r.aiToday} / {r.aiTotal}</td>
                        <td className="num">{r.photoCount}枚{r.lastPhoto ? `（${r.lastPhoto.slice(5)}）` : ''}</td>
                        <td className="num">{r.signedUp.slice(5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
