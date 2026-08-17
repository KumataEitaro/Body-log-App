// 右下FAB → ハーフモーダルのクイック記録（食事タブ以外の全タブに常駐）
// 開くと即キーボードが立ち、送信してもフォーカスを維持して連投できる
import { useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';
import { quickLog } from '@/lib/quicklog';
import { C } from '@/lib/ui';

export default function QuickLogFab() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; base64: string }[]>([]);
  const [pending, setPending] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = useRef<TextInput>(null);

  async function pickPhoto(fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setMsg({ ok: false, text: fromCamera ? 'カメラの許可が必要です。' : '写真の許可が必要です。' }); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], selectionLimit: 4 - photos.length, allowsMultipleSelection: true, quality: 1 });
    if (res.canceled || !res.assets?.length) return;
    const list = (await Promise.all(res.assets.map(async (a) => {
      try {
        const out = await manipulateAsync(a.uri, [{ resize: { width: 1280 } }], { compress: 0.72, format: SaveFormat.JPEG, base64: true });
        return out.base64 ? { uri: out.uri, base64: out.base64 } : null;
      } catch { return null; }
    }))).filter(Boolean) as { uri: string; base64: string }[];
    setPhotos((prev) => [...prev, ...list].slice(0, 4));
  }

  async function send() {
    const t = text.trim();
    if (!t && photos.length === 0) return;
    const imgs = photos.map((p) => ({ data: p.base64, mime: 'image/jpeg' }));
    setText(''); setPhotos([]); setMsg(null);
    setPending((n) => n + 1);
    inputRef.current?.focus(); // 連投: キーボードを維持
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const res = await quickLog(uid, t, imgs);
      if (!res.ok) { setMsg({ ok: false, text: res.error }); setText(t); return; }
      setMsg({ ok: true, text: `記録しました${t ? `: ${t.slice(0, 24)}` : ''}` });
    } finally {
      setPending((n) => Math.max(0, n - 1));
    }
  }

  return (
    <>
      <Pressable style={s.fab} onPress={() => { setMsg(null); setOpen(true); }} hitSlop={6}>
        <Text style={s.fabT}>＋</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={s.backdrop} onPress={() => setOpen(false)} />
          <View style={s.sheet}>
            <View style={s.grip} />
            <Text style={s.title}>⚡ かんたん記録 <Text style={s.titleSub}>— 食事・体重・気分をそのまま送信</Text></Text>
            {photos.length > 0 && (
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                {photos.map((p, i) => (
                  <Pressable key={i} onPress={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}>
                    <Image source={{ uri: p.uri }} style={s.thumb} />
                  </Pressable>
                ))}
              </View>
            )}
            {msg && <Text style={[s.msg, { color: msg.ok ? C.teal : C.coral }]}>{msg.text}</Text>}
            {pending > 0 && (
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <ActivityIndicator size="small" color={C.teal} />
                <Text style={s.msg}>AIが解析して記録しています…（送信済み {pending} 件）</Text>
              </View>
            )}
            <View style={s.dock}>
              <Pressable onPress={() => pickPhoto(true)} hitSlop={6} style={s.iconBtn}><Text style={s.icon}>📷</Text></Pressable>
              <Pressable onPress={() => pickPhoto(false)} hitSlop={6} style={s.iconBtn}><Text style={s.icon}>🖼</Text></Pressable>
              <TextInput
                ref={inputRef} style={s.input} placeholder="バナナ、コーヒー など…" placeholderTextColor={C.faint}
                value={text} onChangeText={setText} autoFocus returnKeyType="send"
                blurOnSubmit={false} onSubmitEditing={send}
              />
              <Pressable style={[s.send, !(text.trim() || photos.length) && { opacity: 0.35 }]} onPress={send} disabled={!(text.trim() || photos.length)}>
                <Text style={s.sendT}>↑</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  fab: {
    position: 'absolute', right: 18, bottom: 24, width: 54, height: 54, borderRadius: 27,
    backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', zIndex: 20,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
  fabT: { color: '#fff', fontSize: 26, fontWeight: '600', marginTop: -2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(14,17,22,0.35)' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 14 },
  grip: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: 10 },
  title: { fontSize: 14, fontWeight: '800', color: C.ink, marginBottom: 10 },
  titleSub: { fontSize: 11, fontWeight: '400', color: C.sub },
  thumb: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: C.line },
  msg: { fontSize: 12, fontWeight: '600', color: C.sub, marginBottom: 6 },
  dock: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 24, paddingHorizontal: 8, paddingVertical: 6,
  },
  iconBtn: { padding: 4 },
  icon: { fontSize: 18 },
  input: { flex: 1, fontSize: 16, color: C.ink, paddingVertical: 6, paddingHorizontal: 4 },
  send: { backgroundColor: C.teal, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sendT: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
