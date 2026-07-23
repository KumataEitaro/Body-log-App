'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { todayJST } from '@/lib/calc';
import { resizeImage, type ResizedImage } from '@/lib/image';
import { pickPhotoNative, isNativeCameraAvailable, hapticSuccess } from '@/lib/native';

type BodyPhoto = { id: string; date: string; path: string; bf_est: number | null; assessment: string; url?: string };
type ProfileLite = { sex: 'male' | 'female'; height_cm: number; age: number } | null;

// 体写真の入力・一覧・AI判定・前回比較（入力タブ用）
export default function BodyPhotos({
  profile, latestWeight, goalNote, targetBf,
}: {
  profile: ProfileLite;
  latestWeight: number | null;
  goalNote?: string | null;
  targetBf?: number | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const today = todayJST();
  const [photos, setPhotos] = useState<BodyPhoto[]>([]);
  const [photoDate, setPhotoDate] = useState(today);
  const [pendingPhoto, setPendingPhoto] = useState<ResizedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);
  const [compareResult, setCompareResult] = useState('');

  async function loadPhotos() {
    const supabase = createClient();
    const { data: phs } = await supabase.from('body_photos').select('*').order('date', { ascending: false }).limit(12);
    const list = (phs as BodyPhoto[]) || [];
    if (list.length) {
      const { data: signed } = await supabase.storage.from('body').createSignedUrls(list.map((p) => p.path), 3600);
      list.forEach((p, i) => { p.url = signed?.[i]?.signedUrl || undefined; });
    }
    setPhotos(list);
  }
  useEffect(() => { loadPhotos(); }, []);

  function buildContext() {
    return profile
      ? `身長${profile.height_cm}cm 年齢${profile.age}歳 体重${latestWeight ?? '?'}kg 性別${profile.sex === 'male' ? '男性' : '女性'}${goalNote ? ` 目標:${goalNote}` : ''}${targetBf ? ` 目標体脂肪率${targetBf}%` : ''}`
      : '';
  }

  async function selectPhoto(files: FileList | null) {
    const file = files && files.length ? files[0] : null;
    if (!file) return;
    setAiMsg(null); setCompareResult('');
    const img = await resizeImage(file);
    setPendingPhoto(img);
  }

  // 先にAI判定→成功した時だけ保存。失敗時は選択を保持したまま同じボタンで再アップできる
  async function uploadPending() {
    if (!pendingPhoto) return;
    setBusy(true); setAiMsg(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const img = pendingPhoto;
      const d = photoDate || today;

      const res = await fetch('/api/analyze-body', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'assess', context: buildContext(), images: [{ data: img.base64, mime: img.mime }], lang: localStorage.getItem('bodylog-lang') || 'ja' }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setAiMsg({ cls: 'err', text: `${j.error || 'AI判定に失敗しました。'}／ 写真の選択は保持しています。同じボタンで再アップできます。` });
        return;
      }
      const bf = typeof j.result.bf_est === 'number' ? j.result.bf_est : null;
      const assessment = [j.result.muscle, j.result.comment].filter(Boolean).join(' ／ ');

      const path = `${user.id}/${d}-${crypto.randomUUID().slice(0, 8)}.jpg`;
      const { error: upErr } = await supabase.storage.from('body').upload(path, img.blob, { contentType: 'image/jpeg' });
      if (upErr) throw new Error(upErr.message);
      await supabase.from('body_photos').insert({ user_id: user.id, date: d, path, bf_est: bf, assessment });
      setAiMsg({ cls: 'ok', text: `AI判定: 推定体脂肪率 ${bf ?? '?'}%（±3%）。${j.result.comment || ''}` });
      hapticSuccess();
      setPendingPhoto(null);
      setPhotoDate(today);
      await loadPhotos();
    } catch (e) {
      setAiMsg({ cls: 'err', text: `${e instanceof Error ? e.message : String(e)}／ 写真の選択は保持しています。同じボタンで再アップできます。` });
    } finally {
      setBusy(false);
    }
  }

  async function urlToB64(url: string) {
    const blob = await (await fetch(url)).blob();
    return (await resizeImage(blob)).base64;
  }

  async function reassessLatest() {
    if (!photos.length || !photos[0].url) return;
    setBusy(true); setAiMsg(null);
    try {
      const latest = photos[0];
      const b64 = await urlToB64(latest.url!);
      const res = await fetch('/api/analyze-body', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'assess', context: buildContext(), images: [{ data: b64, mime: 'image/jpeg' }], lang: localStorage.getItem('bodylog-lang') || 'ja' }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      const bf = typeof j.result.bf_est === 'number' ? j.result.bf_est : null;
      const assessment = [j.result.muscle, j.result.comment].filter(Boolean).join(' ／ ');
      const supabase = createClient();
      await supabase.from('body_photos').update({ bf_est: bf, assessment }).eq('id', latest.id);
      setAiMsg({ cls: 'ok', text: `AI判定: 推定体脂肪率 ${bf ?? '?'}%（±3%）。${j.result.comment || ''}` });
      await loadPhotos();
    } catch (e) {
      setAiMsg({ cls: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function comparePhotos() {
    if (photos.length < 2) return;
    setBusy(true); setAiMsg(null); setCompareResult('');
    try {
      const [latest, prev] = photos;
      if (!latest.url || !prev.url) throw new Error('写真URLの取得に失敗しました。');
      const [afterB64, beforeB64] = await Promise.all([urlToB64(latest.url), urlToB64(prev.url)]);
      const context = `前回${prev.date}→今回${latest.date}。${buildContext()}`;
      const res = await fetch('/api/analyze-body', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'compare', context,
          images: [{ data: beforeB64, mime: 'image/jpeg' }, { data: afterB64, mime: 'image/jpeg' }],
          lang: localStorage.getItem('bodylog-lang') || 'ja',
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      const label = j.result.progress === 'ahead' ? '📈 進捗良好' : j.result.progress === 'behind' ? '📉 停滞ぎみ' : '➡ 順調';
      setCompareResult(`${label}（前回 ${prev.date} → 今回 ${latest.date}）: ${j.result.comment || ''}`);
      const supabase = createClient();
      await supabase.from('body_photos').update({ assessment: `${latest.assessment ? latest.assessment + ' ／ ' : ''}比較: ${j.result.comment || ''}` }).eq('id', latest.id);
    } catch (e) {
      setAiMsg({ cls: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>📸 体の写真（進捗チェック）</h2>
      <p className="muted">アップするとAIが体脂肪率を推定し、前回との変化を比較できます。写真は本人以外見られません。過去の写真はダッシュボードのカレンダー📷から見られます。</p>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { selectPhoto(e.target.files); e.target.value = ''; }} />
      <div className="row2" style={{ marginTop: 8 }}>
        <button className={pendingPhoto ? 'btn-ghost' : 'btn-primary'} disabled={busy}
                onClick={async () => {
                  // 判定は同期で行う（awaitを挟むとclick()がユーザー操作扱いされず無反応になる）
                  if (isNativeCameraAvailable()) {
                    const p = await pickPhotoNative();
                    if (p) { setAiMsg(null); setCompareResult(''); setPendingPhoto(p); }
                  } else {
                    fileRef.current?.click();
                  }
                }}>
          📷 {pendingPhoto ? '写真を選び直す' : '写真を選ぶ'}
        </button>
        <button className="btn-ghost" onClick={comparePhotos} disabled={busy || photos.length < 2}>
          🔍 前回と比較する
        </button>
      </div>
      {pendingPhoto && (
        <div className="photo-row" style={{ marginTop: 10 }}>
          <div className="thumb bphoto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pendingPhoto.dataUrl} alt="" />
            <button className="thumb-x" onClick={() => setPendingPhoto(null)}>×</button>
          </div>
        </div>
      )}
      <label>写真の日付（過去の写真は撮影日を指定）</label>
      <input type="date" value={photoDate} onChange={(e) => setPhotoDate(e.target.value)} max={today} />
      {pendingPhoto && (
        <div className="row2" style={{ marginTop: 10 }}>
          <button className="btn-primary" onClick={uploadPending} disabled={busy}>
            {busy ? <><span className="spin" />アップ＆AI判定中…</> : `⬆ ${photoDate === today ? '今日' : photoDate.slice(5).replace('-', '/')}の写真としてアップ（AI判定）`}
          </button>
          <button className="btn-ghost" onClick={() => setPendingPhoto(null)} disabled={busy}>選択を解除</button>
        </div>
      )}
      {photos.length > 0 && photos[0].bf_est == null && (
        <button className="btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={reassessLatest} disabled={busy}>
          🔁 最新写真のAI判定をやり直す（前回はAI混雑で未判定）
        </button>
      )}
      {aiMsg && <div className={`msg ${aiMsg.cls}`}>{aiMsg.text}</div>}
      {compareResult && <div className="msg ok">{compareResult}</div>}
      {photos.length > 0 && (
        <p className="muted center" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          これまでの写真は {photos.length} 枚。ダッシュボードのカレンダーで📷の日をタップすると見られます。
        </p>
      )}
    </div>
  );
}
