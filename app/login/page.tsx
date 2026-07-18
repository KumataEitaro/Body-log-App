'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          router.push('/onboarding');
          router.refresh();
          return;
        }
        setMsg({ cls: 'ok', text: '確認メールを送りました。メール内のリンクを開いてから、ログインしてください。' });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setMsg({ cls: 'err', text: m.includes('Invalid login') ? 'メールまたはパスワードが違います。' : m });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-hero">
      <div className="center" style={{ marginBottom: 24 }}>
        <div className="logo">Body<span className="accent">Log</span></div>
        <p className="muted">自然文で食事を記録 → AIがkcal/PFC解析 → 収支と判定を毎日追跡</p>
      </div>
      <div className="card">
        <form onSubmit={submit}>
          <label>メールアドレス</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <label>パスワード（6文字以上）</label>
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                 autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy}>
            {busy ? '処理中…' : mode === 'signup' ? 'アカウント作成' : 'ログイン'}
          </button>
        </form>
        {msg && <div className={`msg ${msg.cls}`}>{msg.text}</div>}
        <p className="center muted" style={{ marginTop: 14 }}>
          {mode === 'signup' ? (
            <>アカウントをお持ちの方は <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); setMsg(null); }}>ログイン</a></>
          ) : (
            <>初めての方は <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup'); setMsg(null); }}>アカウント作成</a></>
          )}
        </p>
      </div>
    </div>
  );
}
