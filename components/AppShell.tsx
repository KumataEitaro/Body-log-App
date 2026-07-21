'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { setupNativeChrome } from '@/lib/native';
import { cacheClearAll } from '@/lib/cache';

export default function AppShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [needGoal, setNeedGoal] = useState(false);
  const [needPhoto, setNeedPhoto] = useState(false);
  const [showNudge, setShowNudge] = useState(false);
  const [offline, setOffline] = useState(false);

  // オフライン検知（バナー表示用）
  useEffect(() => {
    setOffline(!navigator.onLine);
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // ネイティブアプリ時のステータスバー調整（ブラウザでは何もしない）
  useEffect(() => { setupNativeChrome(); }, []);

  // 目標・体写真の未入力チェック（タブ移動のたびに再確認→入力したらバッジが消える）
  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const [g, p] = await Promise.all([
          supabase.from('goals').select('user_id', { count: 'exact', head: true }),
          supabase.from('body_photos').select('id', { count: 'exact', head: true }),
        ]);
        const ng = (g.count ?? 0) === 0;
        const np = (p.count ?? 0) === 0;
        setNeedGoal(ng); setNeedPhoto(np);
        if ((ng || np) && !sessionStorage.getItem('bodylog-nudge-dismissed')) {
          setShowNudge(true);
        }
        if (!ng && !np) setShowNudge(false);
      } catch { /* オフライン等は無視 */ }
    })();
  }, [pathname]);

  function dismissNudge() {
    sessionStorage.setItem('bodylog-nudge-dismissed', '1');
    setShowNudge(false);
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    cacheClearAll(); // 共用端末での他人データ表示を防ぐ
    router.push('/login');
    router.refresh();
  }

  return (
    <>
      <div className="topbar">
        <span className="bar" />
        <h1>BodyLog</h1>
        <span className="spacer" />
        {userName ? <span className="who">{userName}</span> : null}
        <button className="link" onClick={logout}>ログアウト</button>
      </div>
      <div className="tabs">
        <Link className={`tab ${pathname === '/log' ? 'active' : ''}`} href="/log">入力{needPhoto && <span className="tab-dot" />}</Link>
        <Link className={`tab ${pathname === '/dashboard' ? 'active' : ''}`} href="/dashboard">ダッシュボード</Link>
        <Link className={`tab ${pathname === '/goal' ? 'active' : ''}`} href="/goal">目標{needGoal && <span className="tab-dot" />}</Link>
        <Link className={`tab ${pathname === '/foods' ? 'active' : ''}`} href="/foods">食品</Link>
        <Link className={`tab ${pathname === '/settings' ? 'active' : ''}`} href="/settings">設定</Link>
      </div>
      {offline && (
        <div className="offline-bar">📡 オフライン表示中 — 前回のデータを表示しています。通信回復時に自動更新されます</div>
      )}
      <div className="wrap">{children}</div>

      {/* 未入力ユーザー向けの案内ポップアップ */}
      {showNudge && (
        <div className="nudge">
          <div className="nudge-title">✨ あと少しでフル機能が使えます</div>
          <div className="nudge-body">
            {needPhoto && <div>📸 <b>体の写真</b>をアップすると、AIが体脂肪率を推定して推移をグラフ化できます（入力タブ）</div>}
            {needGoal && <div>🎯 <b>目標</b>（いつまでに何kg）を入れると、毎日の摂取カロリー計画と進捗判定が作られます（目標タブ）</div>}
          </div>
          <div className="nudge-actions">
            {needGoal && <Link href="/goal" onClick={dismissNudge} className="nudge-cta">🎯 目標を入れる</Link>}
            {needPhoto && <Link href="/log" onClick={dismissNudge} className="nudge-cta ghost">📸 写真を入れる</Link>}
            <button className="nudge-later" onClick={dismissNudge}>あとで</button>
          </div>
        </div>
      )}
    </>
  );
}
