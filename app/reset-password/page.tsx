'use client';
// パスワード再設定ページ（2026-09-16 新設）。
//
// なぜ Web に置くか:
//   アプリ（native/src/app/login.tsx）の「パスワードをお忘れですか？」が
//   `resetPasswordForEmail(mail, { redirectTo: https://…/reset-password })` を呼ぶ。
//   戻り先をアプリのディープリンク（bodylog://）にすると、**再設定メールを PC で開いた人が
//   行き止まりになる**。Web なら端末を問わず完了でき、そのあとアプリで新しいパスワードで入れる。
//
// なぜ必要か（これが無いと何が起きるか）:
//   2026-09-16 まで、このアプリには**パスワード再設定の導線が1つも無かった**。
//   メール＋パスワードで登録した人がパスワードを忘れた時点で、体重・食事・写真の
//   全記録に二度と辿り着けない。ヘルスケアアプリでこれは実質的なデータ消失にあたる。
//
// Supabase の再設定リンクの戻り方は2通りある（どちらも受ける）:
//   1. PKCE:      ?code=xxx            → exchangeCodeForSession
//   2. implicit:  #access_token=…&type=recovery → detectSessionInUrl が自動で張る
//   いずれも「復旧セッション」が張られた状態になるので、updateUser でパスワードを更新できる。
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { friendlyAuthError } from '@/lib/errmsg';

type Phase = 'checking' | 'ready' | 'invalid' | 'done';

export default function ResetPasswordPage() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);
  // リンクが切れていた人に、その場でもう一度送れる出口を出す（行き止まりを作らない）
  const [resendMail, setResendMail] = useState('');

  // 復旧セッションが張れているかを確かめる。
  // メールのリンクを開いた直後は URL に code / #access_token が乗っており、
  // supabase-js が自動で処理する。処理の完了を onAuthStateChange と getSession の両方で拾う。
  useEffect(() => {
    const supabase = createClient();
    let alive = true;

    const settle = (ok: boolean) => {
      if (!alive) return;
      setPhase(ok ? 'ready' : 'invalid');
    };

    // PKCE（?code=…）は自動処理されないことがあるので明示的に交換する
    (async () => {
      const code = new URLSearchParams(window.location.search).get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!alive) return;
        if (error) { settle(false); return; }
        settle(true);
        return;
      }
      // implicit（#access_token=…）は detectSessionInUrl が処理する。少し待って確かめる
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      if (data.session) { settle(true); return; }
      // フラグメントの処理が間に合っていないことがあるので、イベントを1秒だけ待つ
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        if (session) settle(true);
      });
      setTimeout(() => { sub.subscription.unsubscribe(); settle(false); }, 1500);
    })();

    return () => { alive = false; };
  }, []);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setMsg({ cls: 'err', text: 'パスワードは8文字以上にしてください。' }); return; }
    if (password !== password2) { setMsg({ cls: 'err', text: '確認用パスワードが一致しません。' }); return; }
    setBusy(true); setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPhase('done');
    } catch (err) {
      setMsg({ cls: 'err', text: friendlyAuthError(err) });
    } finally {
      setBusy(false);
    }
  }, [password, password2]);

  // リンクが切れていた人向け。ここでも送れるようにして行き止まりを作らない
  const resend = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendMail.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const supabase = createClient();
      await supabase.auth.resetPasswordForEmail(resendMail.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch { /* 登録の有無は推測させない（返事を変えない） */ } finally {
      setBusy(false);
      // 送れても送れなくても同じ案内（メールアドレスの存在を漏らさない）
      setMsg({ cls: 'ok', text: `${resendMail.trim()} 宛に再設定用のメールを送りました。迷惑メールもご確認ください。` });
    }
  }, [resendMail]);

  return (
    <div className="login-hero">
      <div className="center" style={{ marginBottom: 24 }}>
        <div className="logo">Body<span className="accent">Log</span></div>
        <p className="muted">パスワードの再設定</p>
      </div>

      <div className="card">
        {phase === 'checking' && <p className="muted center">確認しています…</p>}

        {phase === 'ready' && (
          <form onSubmit={submit}>
            <label>新しいパスワード（8文字以上）</label>
            <input type="password" required minLength={8} value={password} autoComplete="new-password"
                   onChange={(e) => setPassword(e.target.value)} />
            <label>新しいパスワード（確認）</label>
            <input type="password" required minLength={8} value={password2} autoComplete="new-password"
                   onChange={(e) => setPassword2(e.target.value)} />
            <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy}>
              {busy ? '更新中…' : 'パスワードを変更する'}
            </button>
          </form>
        )}

        {phase === 'done' && (
          <>
            <div className="msg ok">パスワードを変更しました。</div>
            <p className="muted" style={{ marginTop: 12 }}>
              アプリに戻って、新しいパスワードでログインしてください。
              Web で続けるなら <a href="/login">こちらからログイン</a> できます。
            </p>
          </>
        )}

        {phase === 'invalid' && (
          <>
            <div className="msg err">
              このリンクは期限切れか、すでに使われています。再設定のメールをもう一度お送りします。
            </div>
            <form onSubmit={resend} style={{ marginTop: 14 }}>
              <label>メールアドレス</label>
              <input type="email" required value={resendMail} autoComplete="email"
                     onChange={(e) => setResendMail(e.target.value)} />
              <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy}>
                {busy ? '送信中…' : '再設定メールを送る'}
              </button>
            </form>
          </>
        )}

        {msg && <div className={`msg ${msg.cls}`}>{msg.text}</div>}

        <p className="center muted" style={{ marginTop: 14, fontSize: 12 }}>
          うまくいかないときは <a href="mailto:gotcha429@gmail.com?subject=BodyLog%20%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6">gotcha429@gmail.com</a> までご連絡ください。
        </p>
      </div>
    </div>
  );
}
