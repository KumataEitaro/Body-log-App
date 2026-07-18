'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { mifflinBMR, LIFE_FACTOR_DEFAULT } from '@/lib/calc';

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [height, setHeight] = useState('170');
  const [age, setAge] = useState('30');
  const [weight, setWeight] = useState('70');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const bmr = mifflinBMR(sex, Number(weight) || 0, Number(height) || 0, Number(age) || 0);
  const base = Math.round(bmr * LIFE_FACTOR_DEFAULT);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }
    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      display_name: name || user.email?.split('@')[0] || '',
      sex,
      height_cm: Number(height),
      age: Number(age),
      init_weight: Number(weight),
      life_factor: LIFE_FACTOR_DEFAULT,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.push('/goal'); // ステップ2: 目標設定へ誘導
    router.refresh();
  }

  return (
    <div className="login-hero">
      <div className="center" style={{ marginBottom: 20 }}>
        <div className="logo">Body<span className="accent">Log</span></div>
        <p className="muted">はじめに、あなたの基礎情報を教えてください（目安kcalの計算に使います）</p>
      </div>
      <div className="card">
        <form onSubmit={submit}>
          <label>表示名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ニックネーム" />
          <div className="row2">
            <div>
              <label>性別</label>
              <select value={sex} onChange={(e) => setSex(e.target.value as 'male' | 'female')}>
                <option value="male">男性</option>
                <option value="female">女性</option>
              </select>
            </div>
            <div>
              <label>年齢</label>
              <input type="number" required min={10} max={100} value={age} onChange={(e) => setAge(e.target.value)} />
            </div>
          </div>
          <div className="row2">
            <div>
              <label>身長 (cm)</label>
              <input type="number" required min={100} max={230} value={height} onChange={(e) => setHeight(e.target.value)} />
            </div>
            <div>
              <label>現在の体重 (kg)</label>
              <input type="number" required step="0.1" min={30} max={200} value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
          </div>
          <div className="msg ok" style={{ marginTop: 14 }}>
            推定基礎代謝 {Math.round(bmr).toLocaleString()} kcal ／ 通常生活の目安 {base.toLocaleString()} kcal/日
          </div>
          <button className="btn-primary" style={{ marginTop: 14 }} disabled={busy}>
            {busy ? '保存中…' : 'この内容ではじめる'}
          </button>
          {err && <div className="msg err">{err}</div>}
        </form>
      </div>
    </div>
  );
}
