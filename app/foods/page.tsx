'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { createClient } from '@/lib/supabase/client';
import { AI_DAILY_LIMIT, isUnlimited, todayJST } from '@/lib/calc';
import { rescaleByQty, sumItems, emptyItem, type FoodItem } from '@/lib/items';
import { resizeImage, type ResizedImage } from '@/lib/image';
import { parseRatio } from '@/lib/foods';
import { pickPhotoNative, getIsNative, hapticSuccess } from '@/lib/native';

type MyFood = {
  id: string; name: string; unit: string; kcal: number; p: number; f: number; c: number; note: string;
  serving_label: string | null; serving_ratio: number | null;
};

const PLACEHOLDER =
  '作り置きや毎日食べるものを自然文で。例）\n' +
  '野菜鍋の作り置き。キャベツ1玉、鶏むね600g、しめじ2袋、コンソメ2個。\n' +
  '（市販品は栄養成分表示の写真を撮って添付してもOK）';

export default function FoodsPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [userName, setUserName] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [unlimited, setUnlimited] = useState(false);
  const [foods, setFoods] = useState<MyFood[]>([]);

  const [chat, setChat] = useState('');
  const [photos, setPhotos] = useState<ResizedImage[]>([]);
  const [items, setItems] = useState<FoodItem[] | null>(null); // 解析後に表示
  const [manual, setManual] = useState<{ kcal: string; p: string; f: string; c: string } | null>(null); // 品目なし編集用
  const [fName, setFName] = useState('');
  const [fRatio, setFRatio] = useState('1');      // タップ時に入る量（登録合計に対する割合。1=全部）

  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ cls: 'ok' | 'err'; text: string } | null>(null);

  async function loadFoods() {
    const supabase = createClient();
    const { data } = await supabase.from('my_foods').select('id,name,unit,kcal,p,f,c,note,serving_label,serving_ratio').order('created_at', { ascending: true });
    setFoods((data as MyFood[]) || []);
  }

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: prof } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
      setUserName(prof?.display_name || user.email || '');
      setUnlimited(isUnlimited(user.email));
      const { data: usage } = await supabase.from('ai_usage').select('count').eq('date', todayJST()).maybeSingle();
      setRemaining(AI_DAILY_LIMIT - (usage?.count ?? 0));
      await loadFoods();
    })();
  }, [router]);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files).slice(0, 4 - photos.length);
    const resized = await Promise.all(list.map(resizeImage));
    setPhotos((p) => [...p, ...resized]);
  }

  async function parse() {
    if (!chat.trim() && photos.length === 0) { setMsg({ cls: 'err', text: '内容を書くか写真を追加してください。' }); return; }
    setParsing(true); setMsg(null);
    try {
      const res = await fetch('/api/parse-food', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chat, images: photos.map((p) => ({ data: p.base64, mime: p.mime })), lang: localStorage.getItem('bodylog-lang') || 'ja' }),
      });
      const j = await res.json();
      if (typeof j.remaining === 'number') setRemaining(j.remaining);
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      const parsedItems: FoodItem[] = j.result.items || [];
      setItems(parsedItems);
      setManual(null);
      if (!fName && parsedItems.length) {
        // 名前の初期候補: メモの先頭 or 品目名
        const firstLine = chat.trim().split(/[\n。、]/)[0];
        setFName((firstLine && firstLine.length <= 15 ? firstLine : parsedItems[0].name).slice(0, 20));
      }
      setMsg({ cls: 'ok', text: '解析しました。品目を確認・修正して登録してください。' });
    } catch (e) {
      setMsg({ cls: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setParsing(false);
    }
  }

  const total = items ? sumItems(items) : manual
    ? { kcal: Number(manual.kcal) || 0, p: Number(manual.p) || 0, f: Number(manual.f) || 0, c: Number(manual.c) || 0 }
    : null;

  function updateItemNum(i: number, field: 'kcal' | 'p' | 'f' | 'c', v: string) {
    if (!items) return;
    setItems(items.map((it, j) => (j === i ? { ...it, [field]: Number(v) || 0 } : it)));
  }
  function updateItemName(i: number, v: string) {
    if (!items) return;
    setItems(items.map((it, j) => (j === i ? { ...it, name: v } : it)));
  }
  function applyQty(i: number, v: string) {
    if (!items) return;
    setItems(items.map((it, j) => (j === i ? rescaleByQty(it, v) : it)));
  }

  async function saveFood() {
    if (!fName.trim()) { setMsg({ cls: 'err', text: '名前を入れてください。' }); return; }
    if (!total || !total.kcal) { setMsg({ cls: 'err', text: '先にAI解析するか、数値を入力してください。' }); return; }
    const ratio = parseRatio(fRatio);
    if (ratio == null) {
      setMsg({ cls: 'err', text: 'タップ時の量が読み取れません（例: 1/6、0.17、1）。' });
      return;
    }
    setBusy(true); setMsg(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('my_foods').upsert({
      user_id: user.id, name: fName.trim(), kind: 'food', unit: '全量',
      kcal: Math.round(total.kcal), p: Math.round(total.p), f: Math.round(total.f), c: Math.round(total.c),
      note: chat.slice(0, 500),
      serving_label: '', serving_ratio: ratio,
    }, { onConflict: 'user_id,name' });
    setBusy(false);
    if (error) { setMsg({ cls: 'err', text: error.message }); return; }
    hapticSuccess();
    setMsg({ cls: 'ok', text: `「${fName.trim()}」を登録しました。入力画面のチップとAI辞書に反映されます。` });
    setChat(''); setPhotos([]); setItems(null); setManual(null); setFName(''); setFRatio('1');
    await loadFoods();
  }

  function editFood(fd: MyFood) {
    setFName(fd.name); setChat(fd.note || '');
    setFRatio(fd.serving_ratio != null ? String(Math.round(Number(fd.serving_ratio) * 1000) / 1000) : '1');
    setItems(null);
    setManual({ kcal: String(Math.round(fd.kcal)), p: String(Math.round(fd.p)), f: String(Math.round(fd.f)), c: String(Math.round(fd.c)) });
    setMsg({ cls: 'ok', text: `「${fd.name}」を編集中（同じ名前で登録すると上書き）。数値の手直し、またはメモを直してAI再解析ができます。` });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function delFood(fd: MyFood) {
    const supabase = createClient();
    const { error } = await supabase.from('my_foods').delete().eq('id', fd.id);
    if (!error) { setMsg({ cls: 'ok', text: `「${fd.name}」を削除しました。` }); await loadFoods(); }
  }

  const remainLabel = unlimited ? '' : remaining == null ? '' : `（今日あと${Math.max(0, remaining)}回）`;

  return (
    <AppShell userName={userName}>
      {/* ===== AIチャットで登録 ===== */}
      <div className="card">
        <h2>🍲 マイ食品を登録 <span className="muted" style={{ fontWeight: 400 }}>— 作り置き・毎日食べるもの</span></h2>
        <label>内容（自然文でOK。材料を書けばAIが計算します）</label>
        <textarea rows={4} value={chat} onChange={(e) => setChat(e.target.value)} placeholder={PLACEHOLDER} />

        <input ref={fileRef} type="file" accept="image/*" multiple hidden
               onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
        <div className="photo-row">
          {photos.map((p, i) => (
            <div className="thumb" key={i}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.dataUrl} alt="" />
              <button className="thumb-x" onClick={() => setPhotos((arr) => arr.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          {photos.length < 4 && (
            <button className="thumb-add" onClick={async () => {
              if (await getIsNative()) {
                const p = await pickPhotoNative();
                if (p) setPhotos((arr) => (arr.length < 4 ? [...arr, p] : arr));
              } else {
                fileRef.current?.click();
              }
            }}>📷<br />写真追加</button>
          )}
        </div>

        <div className="row2" style={{ marginTop: 10 }}>
          <button className="btn-primary" onClick={parse} disabled={parsing || (!unlimited && remaining === 0)}>
            {parsing ? <><span className="spin" />解析中…</> : `🤖 AIでPFCを解析 ${remainLabel}`}
          </button>
          <button className="btn-ghost" disabled={parsing}
                  onClick={() => { setItems(null); setManual({ kcal: '', p: '', f: '', c: '' }); setMsg({ cls: 'ok', text: '手動入力モード: 下に数値を入れて登録してください（AI不要）。' }); }}>
            ✏️ 手動で数値を入力
          </button>
        </div>
        {msg && <div className={`msg ${msg.cls}`}>{msg.text}</div>}

        {items && items.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="muted" style={{ margin: '0 0 6px' }}>品目はタップで修正できます（分量変更でkcal/PFC自動再計算）</p>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>品目</th><th>分量</th><th>kcal</th><th>P</th><th>F</th><th>C</th><th></th></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={`${i}-${items.length}`}>
                      <td><input className="item-input name-cell" defaultValue={it.name} onBlur={(e) => updateItemName(i, e.target.value)} /></td>
                      <td><input className="item-input qty-cell" defaultValue={it.qty} placeholder="600g" onBlur={(e) => applyQty(i, e.target.value)} /></td>
                      <td><input className="item-input num-cell num" type="number" inputMode="decimal" value={it.kcal} onChange={(e) => updateItemNum(i, 'kcal', e.target.value)} /></td>
                      <td><input className="item-input num-cell num" type="number" inputMode="decimal" value={it.p} onChange={(e) => updateItemNum(i, 'p', e.target.value)} /></td>
                      <td><input className="item-input num-cell num" type="number" inputMode="decimal" value={it.f} onChange={(e) => updateItemNum(i, 'f', e.target.value)} /></td>
                      <td><input className="item-input num-cell num" type="number" inputMode="decimal" value={it.c} onChange={(e) => updateItemNum(i, 'c', e.target.value)} /></td>
                      <td><button className="item-del" onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setItems([...items, emptyItem()])}>＋ 品目を追加</button>
          </div>
        )}

        {manual && (
          <div className="row2" style={{ marginTop: 10 }}>
            <div><label>kcal</label><input type="number" className="num" value={manual.kcal} onChange={(e) => setManual({ ...manual, kcal: e.target.value })} /></div>
            <div><label>P / F / C (g)</label>
              <div className="row3">
                <input type="number" className="num" value={manual.p} onChange={(e) => setManual({ ...manual, p: e.target.value })} />
                <input type="number" className="num" value={manual.f} onChange={(e) => setManual({ ...manual, f: e.target.value })} />
                <input type="number" className="num" value={manual.c} onChange={(e) => setManual({ ...manual, c: e.target.value })} />
              </div>
            </div>
          </div>
        )}

        {total && (
          <>
            <div className="stat-grid" style={{ marginTop: 10 }}>
              <div className="stat"><div className="stat-l">合計</div><div className="stat-v num">{Math.round(total.kcal).toLocaleString()}<small> kcal</small></div></div>
              <div className="stat"><div className="stat-l">P / F / C</div><div className="stat-v num">{Math.round(total.p)} / {Math.round(total.f)} / {Math.round(total.c)}<small> g</small></div></div>
            </div>
            <div className="row2" style={{ marginTop: 6 }}>
              <div><label>マイ食品の名前</label><input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="例）野菜鍋 / パルテノ" /></div>
              <div><label>タップ時に入る量（上の合計に対する割合）</label><input value={fRatio} onChange={(e) => setFRatio(e.target.value)} placeholder="全部なら1、鍋の1杯分なら 1/6 など" inputMode="decimal" /></div>
            </div>
            {parseRatio(fRatio) != null && total && (
              <p className="muted" style={{ margin: '6px 0 0' }}>
                → 入力画面でタップ追加すると 約{Math.round(total.kcal * parseRatio(fRatio)!)}kcal（P{Math.round(total.p * parseRatio(fRatio)!)} F{Math.round(total.f * parseRatio(fRatio)!)} C{Math.round(total.c * parseRatio(fRatio)!)}）が入ります
              </p>
            )}
            <button className="btn-primary" style={{ marginTop: 10 }} onClick={saveFood} disabled={busy}>
              {busy ? <><span className="spin" />登録中…</> : 'マイ食品として登録（同名は上書き）'}
            </button>
          </>
        )}
      </div>

      {/* ===== 一覧 ===== */}
      <div className="card">
        <h2>マイ食品一覧 <span className="muted" style={{ fontWeight: 400 }}>{foods.length}件（タップで編集）</span></h2>
        {foods.length === 0 && <p className="muted">まだ登録がありません。上のチャットから最初の1品を登録してみましょう。</p>}
        {foods.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>名前</th><th>登録合計</th><th>P</th><th>F</th><th>C</th><th>タップ時の量</th><th></th></tr></thead>
              <tbody>
                {foods.map((fd) => {
                  const r = fd.serving_ratio != null && Number(fd.serving_ratio) > 0 ? Number(fd.serving_ratio) : 1;
                  return (
                    <tr key={fd.id}>
                      <td><a href="#" onClick={(e) => { e.preventDefault(); editFood(fd); }}>{fd.name}</a></td>
                      <td className="num">{Math.round(Number(fd.kcal)).toLocaleString()}kcal</td>
                      <td className="num">{Math.round(Number(fd.p))}</td>
                      <td className="num">{Math.round(Number(fd.f))}</td>
                      <td className="num">{Math.round(Number(fd.c))}</td>
                      <td>×{Math.round(r * 100) / 100}（{Math.round(Number(fd.kcal) * r).toLocaleString()}kcal）</td>
                      <td><button className="item-del" onClick={() => delFood(fd)}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ marginTop: 8 }}>
          登録した食品は、入力画面の「よく使う品目」チップに出るほか、チャットに名前を書くだけでAIが登録値で計算します（例:「野菜鍋 1/3」）。
        </p>
      </div>
    </AppShell>
  );
}
