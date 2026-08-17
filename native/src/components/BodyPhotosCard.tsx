// 週1体写真＋体脂肪率カード（概要タブ・体の変化）
// 最新と前回を並べて比較、横スクロールのタイムライン、追加時に体脂肪率も記録できる
// 写真はSupabase Storageの非公開バケット body-photos（<uid>/… パスでRLS）に保存
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Image, ScrollView,
  TextInput, ActivityIndicator, Alert, Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Camera, ImagePlus, X, Sparkles } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { apiPost } from '@/lib/api';
import { C } from '@/lib/ui';
import { todayJST } from '@/lib/calc';

type PhotoRow = { id: string; date: string; path: string; bodyfat: number | null };
type PhotoView = PhotoRow & { url: string | null };

function b64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function BodyPhotosCard() {
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [targetBf, setTargetBf] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [bfInput, setBfInput] = useState('');
  const [pendingImg, setPendingImg] = useState<{ uri: string; base64: string } | null>(null);
  const [viewer, setViewer] = useState<PhotoView | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [pRes, gRes] = await Promise.all([
      supabase.from('body_photos').select('id,date,path,bodyfat').order('date', { ascending: false }).limit(24),
      supabase.from('goals').select('target_bodyfat').maybeSingle(),
    ]);
    if (gRes.data?.target_bodyfat != null) setTargetBf(Number(gRes.data.target_bodyfat));
    const rows = (pRes.data as PhotoRow[]) ?? [];
    // 非公開バケットなので署名付きURLで表示（1時間有効）
    const withUrls: PhotoView[] = await Promise.all(rows.map(async (r) => {
      const { data } = await supabase.storage.from('body-photos').createSignedUrl(r.path, 3600);
      return { ...r, url: data?.signedUrl ?? null };
    }));
    setPhotos(withUrls);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function pick(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setMsg(fromCamera ? 'カメラの許可が必要です。' : '写真の許可が必要です。'); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled || !res.assets?.length) return;
    try {
      const out = await manipulateAsync(res.assets[0].uri, [{ resize: { width: 1080 } }], { compress: 0.8, format: SaveFormat.JPEG, base64: true });
      if (out.base64) { setPendingImg({ uri: out.uri, base64: out.base64 }); setMsg(null); }
    } catch { setMsg('画像の処理に失敗しました。'); }
  }

  // 写真からAIが体脂肪率を推定（±3%程度の目安・結果は編集可能）
  const [aiBusy, setAiBusy] = useState(false);
  async function estimateBf() {
    if (!pendingImg || aiBusy) return;
    setAiBusy(true); setMsg(null);
    try {
      const { ok, json } = await apiPost<{ ok: boolean; result?: { bf_est?: number; comment?: string }; error?: string }>(
        '/api/analyze-body', { mode: 'assess', images: [{ data: pendingImg.base64, mime: 'image/jpeg' }] });
      if (ok && json?.ok && json.result?.bf_est != null) {
        setBfInput(String(json.result.bf_est));
        setMsg(`AI推定 ${Number(json.result.bf_est).toFixed(1)}%（±3%程度の目安）${json.result.comment ? ` — ${json.result.comment}` : ''}`);
      } else {
        setMsg(json?.error || 'AI推定に失敗しました。手入力もできます。');
      }
    } catch {
      setMsg('通信に失敗しました。');
    } finally { setAiBusy(false); }
  }

  async function save() {
    if (!pendingImg) return;
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const date = todayJST();
      const path = `${uid}/${date}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error: upErr } = await supabase.storage.from('body-photos')
        .upload(path, b64ToBytes(pendingImg.base64), { contentType: 'image/jpeg' });
      if (upErr) {
        setMsg(/bucket|not found/i.test(upErr.message)
          ? 'ストレージ未セットアップです（apply-pending.sqlのv16を実行してください）。'
          : '写真の保存に失敗しました。');
        return;
      }
      const bf = bfInput.trim() === '' ? null : Number(bfInput);
      const { error: insErr } = await supabase.from('body_photos')
        .insert({ user_id: uid, date, path, bodyfat: bf });
      if (insErr) { setMsg('記録の保存に失敗しました（v16 SQL未適用の可能性）。'); return; }
      // 体脂肪率はグラフ用に日次サマリーへも反映
      if (bf != null && bf > 0) {
        await supabase.from('entries').upsert({ user_id: uid, date, bodyfat: bf }, { onConflict: 'user_id,date' });
      }
      setPendingImg(null); setBfInput('');
      await load();
      setMsg('保存しました。');
    } finally { setBusy(false); }
  }

  async function remove(p: PhotoView) {
    Alert.alert('この写真を削除しますか？', p.date, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive',
        onPress: async () => {
          await supabase.storage.from('body-photos').remove([p.path]);
          await supabase.from('body_photos').delete().eq('id', p.id);
          setViewer(null);
          setPhotos((prev) => prev.filter((x) => x.id !== p.id));
        },
      },
    ]);
  }

  const latest = photos[0] ?? null;
  const prev = photos[1] ?? null;
  const latestBf = photos.find((p) => p.bodyfat != null)?.bodyfat ?? null;
  const daysSince = latest ? Math.floor((Date.parse(todayJST()) - Date.parse(latest.date)) / 86400000) : null;

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.h2}>体の写真 <Text style={s.h2sub}>— 週1回の見た目チェック</Text></Text>
        {latestBf != null && (
          <Text style={s.bfNow}>
            体脂肪 {Number(latestBf).toFixed(1)}%{targetBf != null ? ` → 目標${targetBf.toFixed(1)}%` : ''}
          </Text>
        )}
      </View>

      {/* 比較ビュー: 前回 vs 最新 */}
      {latest ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[prev, latest].map((p, i) => (
            <View key={i} style={{ flex: 1 }}>
              <Text style={s.cmpLabel}>{p ? `${p.date.slice(5).replace('-', '/')}${i === 1 ? '（最新）' : ''}` : '—'}</Text>
              {p?.url ? (
                <Pressable onPress={() => setViewer(p)} onLongPress={() => remove(p)}>
                  <Image source={{ uri: p.url }} style={s.cmpImg} />
                  {p.bodyfat != null && <Text style={s.cmpBf}>{Number(p.bodyfat).toFixed(1)}%</Text>}
                </Pressable>
              ) : (
                <View style={[s.cmpImg, s.cmpEmpty]}><Text style={s.emptyT}>{i === 0 ? '前回なし' : ''}</Text></View>
              )}
            </View>
          ))}
        </View>
      ) : (
        <Text style={s.note}>まだ写真がありません。週1回、同じ場所・同じポーズで撮ると変化がわかりやすくなります。</Text>
      )}

      {/* タイムライン */}
      {photos.length > 2 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
          {photos.slice(2).map((p) => (
            <Pressable key={p.id} onPress={() => setViewer(p)} onLongPress={() => remove(p)} style={{ marginRight: 8 }}>
              {p.url && <Image source={{ uri: p.url }} style={s.thumb} />}
              <Text style={s.thumbDate}>{p.date.slice(5).replace('-', '/')}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* 追加フロー: 選択→（体脂肪率入力・任意）→保存 */}
      {pendingImg ? (
        <View style={s.pendingBox}>
          <Image source={{ uri: pendingImg.uri }} style={s.pendingImg} />
          <View style={{ flex: 1 }}>
            <Text style={s.label}>体脂肪率（%・任意）</Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput style={[s.input, { flex: 1 }]} placeholder="21.5" placeholderTextColor={C.faint}
                         keyboardType="decimal-pad" value={bfInput} onChangeText={setBfInput} />
              <Pressable style={s.aiBtn} onPress={estimateBf} disabled={aiBusy}>
                {aiBusy ? <ActivityIndicator size="small" color={C.teal} /> : (
                  <>
                    <Sparkles size={13} color={C.teal} strokeWidth={2.2} />
                    <Text style={s.aiBtnT}>AIで推定</Text>
                  </>
                )}
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Pressable style={s.saveBtn} onPress={save} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnT}>✓ 保存</Text>}
              </Pressable>
              <Pressable onPress={() => { setPendingImg(null); setBfInput(''); }} hitSlop={8} style={{ justifyContent: 'center' }}>
                <Text style={s.cancelT}>破棄</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Pressable style={s.addBtn} onPress={() => pick(true)}>
            <Camera size={16} color="#fff" strokeWidth={2.2} />
            <Text style={s.addBtnT}>{daysSince != null && daysSince < 7 ? '撮り直す' : '今週の写真を撮る'}</Text>
          </Pressable>
          <Pressable style={s.addGhost} onPress={() => pick(false)}>
            <ImagePlus size={16} color={C.ink} strokeWidth={2.2} />
            <Text style={s.addGhostT}>選ぶ</Text>
          </Pressable>
        </View>
      )}
      {daysSince != null && daysSince >= 7 && !pendingImg && (
        <Text style={s.dueT}>前回から{daysSince}日。今週の1枚を撮りましょう。</Text>
      )}
      {msg && <Text style={s.msg}>{msg}</Text>}

      {/* 拡大ビューア */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={s.viewerBack} onPress={() => setViewer(null)}>
          {viewer?.url && <Image source={{ uri: viewer.url }} style={s.viewerImg} resizeMode="contain" />}
          <View style={s.viewerBar}>
            <Text style={s.viewerT}>{viewer?.date.replace(/-/g, '/')}{viewer?.bodyfat != null ? `・体脂肪 ${Number(viewer.bodyfat).toFixed(1)}%` : ''}</Text>
            <Pressable onPress={() => setViewer(null)} hitSlop={10}><X size={22} color="#fff" /></Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 16, marginBottom: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' },
  h2: { fontSize: 13, fontWeight: '800', color: C.ink },
  h2sub: { fontSize: 11, fontWeight: '400', color: C.sub },
  bfNow: { fontSize: 11.5, fontWeight: '800', color: C.teal, fontVariant: ['tabular-nums'] },
  note: { fontSize: 11.5, color: C.sub, lineHeight: 18 },
  cmpLabel: { fontSize: 10.5, fontWeight: '700', color: C.sub, marginBottom: 4 },
  cmpImg: { width: '100%', aspectRatio: 3 / 4, borderRadius: 14, backgroundColor: C.bg },
  cmpEmpty: { borderWidth: 1, borderColor: C.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  emptyT: { fontSize: 11, color: C.faint },
  cmpBf: {
    position: 'absolute', right: 6, bottom: 6, color: '#fff', fontSize: 11, fontWeight: '800',
    backgroundColor: 'rgba(10,14,12,0.55)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2,
    overflow: 'hidden', fontVariant: ['tabular-nums'],
  },
  thumb: { width: 56, height: 74, borderRadius: 10, backgroundColor: C.bg },
  thumbDate: { fontSize: 9.5, color: C.sub, textAlign: 'center', marginTop: 2 },
  pendingBox: { flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'flex-start' },
  pendingImg: { width: 84, height: 112, borderRadius: 12, backgroundColor: C.bg },
  label: { fontSize: 11, fontWeight: '700', color: C.sub, marginBottom: 4 },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10, fontSize: 15, color: C.ink },
  saveBtn: { backgroundColor: C.teal, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  aiBtn: {
    flexDirection: 'row', gap: 4, alignItems: 'center',
    borderWidth: 1.5, borderColor: 'rgba(5,150,105,0.4)', backgroundColor: '#f2faf7',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8,
  },
  aiBtnT: { fontSize: 11.5, fontWeight: '800', color: C.teal },
  saveBtnT: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  cancelT: { fontSize: 12, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  addBtn: {
    flex: 1, flexDirection: 'row', gap: 6, backgroundColor: C.ink, borderRadius: 999,
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  addBtnT: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  addGhost: {
    flexDirection: 'row', gap: 6, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line,
    borderRadius: 999, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center',
  },
  addGhostT: { color: C.ink, fontSize: 12.5, fontWeight: '800' },
  dueT: { fontSize: 11, color: C.sub, marginTop: 8 },
  msg: { fontSize: 12, fontWeight: '600', color: C.sub, marginTop: 8 },
  viewerBack: { flex: 1, backgroundColor: 'rgba(8,10,9,0.92)', justifyContent: 'center' },
  viewerImg: { width: '100%', height: '80%' },
  viewerBar: {
    position: 'absolute', top: 58, left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  viewerT: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
});
