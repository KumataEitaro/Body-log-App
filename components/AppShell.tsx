'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { setupNativeChrome } from '@/lib/native';
import { cacheClearAll } from '@/lib/cache';

/* 下部タブバー用アイコン（SF Symbols風のシンプルなストロークSVG） */
function IconPencil() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" />
    </svg>
  );
}
function IconTarget() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.5" fill="currentColor" />
    </svg>
  );
}
function IconGear() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
    </svg>
  );
}
function IconRefresh() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
    </svg>
  );
}

// マイ食品登録は設定ページ内へ移動（タブは4つ）
const TABS = [
  { href: '/log', label: '入力', icon: <IconPencil />, dotKey: 'photo' },
  { href: '/dashboard', label: 'ダッシュボード', icon: <IconChart />, dotKey: null },
  { href: '/goal', label: '目標', icon: <IconTarget />, dotKey: 'goal' },
  { href: '/settings', label: '設定', icon: <IconGear />, dotKey: null },
] as const;

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

  function hasDot(dotKey: 'photo' | 'goal' | null): boolean {
    if (dotKey === 'photo') return needPhoto;
    if (dotKey === 'goal') return needGoal;
    return false;
  }

  return (
    <>
      <div className="topbar">
        <span className="bar" />
        <h1>BodyLog</h1>
        <span className="spacer" />
        <button className="link" onClick={() => window.location.reload()} title="最新のデータ・アプリに更新"><IconRefresh /></button>
        <button className="link" onClick={logout}>ログアウト</button>
        <Link href="/settings" className="avatar" title={userName || 'プロフィール'}>
          {(userName || '?').trim().charAt(0).toUpperCase()}
        </Link>
      </div>
      {offline && (
        <div className="offline-bar">📡 オフライン表示中 — 前回のデータを表示しています。通信回復時に自動更新されます</div>
      )}
      <div className="wrap">{children}</div>

      {/* 下部タブバー（ブラー・セーフエリア対応） */}
      <nav className="tabbar">
        <div className="tabbar-inner">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={`tab ${pathname === t.href ? 'active' : ''}`}>
              {hasDot(t.dotKey) && <span className="tab-dot" />}
              {t.icon}
              <span>{t.label}</span>
            </Link>
          ))}
        </div>
      </nav>

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
