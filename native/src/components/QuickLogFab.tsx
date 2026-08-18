// 右下FAB → ハーフモーダルのクイック記録（食事タブ以外の全タブに常駐）
// 開くと即キーボードが立ち、送信してもフォーカスを維持して連投できる
import { useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Images, Weight, ArrowUp } from 'lucide-react-native';
import DockIconButton from '@/components/DockIconButton';
import { OptionButton } from '@/components/ui/Selectable';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';
import { analyzeFood, saveParsed, type ParsedResult } from '@/lib/quicklog';
import { sumItems } from '@/lib/items';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';

export default function QuickLogFab() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; base64: string }[]>([]);
  const [pending, setPending] = useState(0);
  const [staged, setStaged] = useState<ParsedResult | null>(null); // 解析結果（保存前の確認用）
  const [stagedNote, setStagedNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = useRef<TextInput>(null);

  async function pickPhoto(fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setMsg({ ok: false, text: fromCamera ? 'カメラの許可が必要です。' : t('写真の許可が必要です。') }); return; }
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

  // 送信=AI解析→保存前の確認（stagedに積む。連投可・保存は✓で確定）
  async function send() {
    const t = text.trim();
    if (!t && photos.length === 0) return;
    const imgs = photos.map((p) => ({ data: p.base64, mime: 'image/jpeg' }));
    setText(''); setPhotos([]); setMsg(null);
    setPending((n) => n + 1);
    inputRef.current?.focus(); // 連投: キーボードを維持
    try {
      const res = await analyzeFood(t, imgs);
      if (!res.ok) { setMsg({ ok: false, text: res.error }); setText(t); return; }
      const r = res.result;
      setStaged((p) => ({
        items: [...(p?.items ?? []), ...r.items],
        weight: r.weight ?? p?.weight ?? null,
        waist: r.waist ?? p?.waist ?? null,
        ex: r.ex ?? p?.ex ?? null,
        adj: r.adj || p?.adj || 0,
        mood: r.mood ?? p?.mood ?? null,
      }));
      if (t) setStagedNote((n) => (n ? `${n}、${t}` : t));
    } finally {
      setPending((n) => Math.max(0, n - 1));
    }
  }

  async function confirmSave() {
    if (!staged) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const res = await saveParsed(uid, staged, stagedNote);
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
      setStaged(null); setStagedNote('');
      setMsg({ ok: true, text: t('記録しました。') });
    } finally {
      setSaving(false);
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
            <Text style={s.title}>{t('かんたん記録')}<Text style={s.titleSub}>{t('— 食事・体重・気分をそのまま送信')}</Text></Text>
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
                <Text style={s.msg}>{t('AIが解析しています…')}</Text>
              </View>
            )}
            {/* 保存前の確認トレイ */}
            {staged && (
              <View style={s.stagedBox}>
                {staged.items.map((it, i) => (
                  <View key={i} style={s.stagedRow}>
                    <Text style={s.stagedT} numberOfLines={1}>{it.name} {it.qty}</Text>
                    <Text style={s.stagedKcal}>{Math.round(it.kcal)}kcal</Text>
                    <Pressable hitSlop={8} onPress={() => setStaged((p) => {
                      if (!p) return p;
                      const items = p.items.filter((_, j) => j !== i);
                      return items.length === 0 && p.weight == null && !p.ex ? null : { ...p, items };
                    })}>
                      <Text style={s.stagedX}>×</Text>
                    </Pressable>
                  </View>
                ))}
                {staged.weight != null && (
                  <View style={[s.stagedRow, { gap: 6 }]}>
                    <Weight size={13} color={C.sub} />
                    <Text style={s.stagedT}>体重 {staged.weight}kg</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <OptionButton variant="teal" busy={saving} onPress={confirmSave}
                                label={`✓ この内容で保存${staged.items.length > 0 ? `（${Math.round(sumItems(staged.items).kcal)}kcal）` : ''}`} />
                  <Pressable onPress={() => { setStaged(null); setStagedNote(''); }} hitSlop={8}>
                    <Text style={s.stagedClear}>{t('破棄')}</Text>
                  </Pressable>
                </View>
              </View>
            )}
            <View style={s.dock}>
              <DockIconButton Icon={Camera} onPress={() => pickPhoto(true)} />
              <DockIconButton Icon={Images} onPress={() => pickPhoto(false)} />
              <TextInput
                ref={inputRef} style={s.input} placeholder="バナナ、コーヒー など…" placeholderTextColor={C.faint}
                value={text} onChangeText={setText} autoFocus returnKeyType="send"
                blurOnSubmit={false} onSubmitEditing={send}
              />
              <Pressable style={[s.send, !(text.trim() || photos.length) && { opacity: 0.35 }]} onPress={send} disabled={!(text.trim() || photos.length)}>
                <ArrowUp color="#fff" size={17} strokeWidth={3} />
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
  stagedBox: { backgroundColor: '#e6f7f2', borderWidth: 1, borderColor: 'rgba(5,150,105,0.3)', borderRadius: 14, padding: 10, marginBottom: 8 },
  stagedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  stagedT: { flex: 1, fontSize: 12.5, fontWeight: '700', color: C.ink },
  stagedKcal: { fontSize: 11.5, color: C.sub, fontVariant: ['tabular-nums'] },
  stagedX: { fontSize: 15, fontWeight: '800', color: C.coral },
  stagedSave: { backgroundColor: C.teal, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  stagedSaveT: { color: '#fff', fontSize: 12, fontWeight: '800' },
  stagedClear: { fontSize: 11.5, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
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
