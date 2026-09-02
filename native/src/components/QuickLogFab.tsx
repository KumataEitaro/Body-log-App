// 右下FAB → ハーフモーダルのクイック記録（食事タブ以外の全タブに常駐）
// 開くと即キーボードが立ち、送信してもフォーカスを維持して連投できる
import { useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Images, Weight, ArrowUp } from 'lucide-react-native';
import DockIconButton from '@/components/DockIconButton';
import { OptionButton } from '@/components/ui/Selectable';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';
import { analyzeFood, saveParsed, type ParsedResult } from '@/lib/quicklog';
import { sumItems } from '@/lib/items';
import { confirmOutlierWeight } from '@/lib/guard';
import { C, themed } from '@/lib/ui';
import { useDayStatus } from '@/lib/dayStatus';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LiveBar, usePulse } from '@/components/LivePreviewBar';
import { t } from '@/lib/i18n';
import { useRouter } from 'expo-router';

export default function QuickLogFab() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; base64: string }[]>([]);
  const [pending, setPending] = useState(0);
  const [staged, setStaged] = useState<ParsedResult | null>(null); // 解析結果（保存前の確認用）
  const [stagedNote, setStagedNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; upgrade?: boolean; kind?: 'text' | 'photo' | 'coach' } | null>(null);
  const inputRef = useRef<TextInput>(null);
  // 食事タブが計算した「今日の残り」。FAB単体では計画計算をしない（重複と食い違いを避ける）
  const day = useDayStatus();
  const insets = useSafeAreaInsets();
  const stagedTotal = staged ? sumItems(staged.items) : { kcal: 0, p: 0, f: 0, c: 0 };
  const pulse = usePulse(open && (staged?.items.length ?? 0) > 0);

  async function pickPhoto(fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setMsg({ ok: false, text: fromCamera ? 'カメラの許可が必要です。' : t('写真の許可が必要です。') }); return; }
    // quality:1は端末最大解像度のまま＝デコードで数百MB。あとで1280pxに縮小するので下げてよい。
    // 同時デコード（Promise.all）は複数枚でメモリ不足の強制終了を招くため1枚ずつ処理する
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], selectionLimit: 4 - photos.length, allowsMultipleSelection: true, quality: 0.8 });
    if (res.canceled || !res.assets?.length) return;
    const list: { uri: string; base64: string }[] = [];
    for (const a of res.assets) {
      try {
        const out = await manipulateAsync(a.uri, [{ resize: { width: 1280 } }], { compress: 0.72, format: SaveFormat.JPEG, base64: true });
        if (out.base64) list.push({ uri: out.uri, base64: out.base64 });
      } catch { /* 読めない1枚のために全体を止めない */ }
    }
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
      if (!res.ok) { setMsg({ ok: false, text: res.error, upgrade: res.upgrade, kind: res.kind }); setText(t); return; }
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
      // G8: AI解析の体重が前回から±15%以上ずれていたら保存前に確かめる（FABは前回値を持たないので都度取得）
      if (staged.weight != null) {
        const { data: prevRows } = await supabase.from('entries')
          .select('weight').not('weight', 'is', null).order('date', { ascending: false }).limit(1);
        const prevW = prevRows?.length ? Number(prevRows[0].weight) : null;
        if (!(await confirmOutlierWeight(prevW, Number(staged.weight)))) return;   // トレイは残す（破棄で消せる）
      }
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
      <Pressable style={[s.fab, { bottom: insets.bottom + 12 }]} onPress={() => { setMsg(null); setOpen(true); }} hitSlop={6}>
        {/* FABは円形固定サイズのため「＋」の文字サイズ拡大は上限1.3 */}
        <Text style={s.fabT} maxFontSizeMultiplier={1.3}>＋</Text>
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
            {/* 上限到達（429 plan_limit）→ シートを閉じてkind別の文脈ペイウォールへ（log.tsxと同じ導線） */}
            {msg?.upgrade && (
              <Pressable hitSlop={8} style={({ pressed }) => [{ alignSelf: 'flex-start', marginBottom: 6 }, pressed && { opacity: 0.7 }]}
                         onPress={() => { setOpen(false); router.push(`/paywall?src=limit_${msg.kind ?? 'text'}` as never); }}>
                <Text style={{ color: C.teal, fontWeight: '700', fontSize: 14 }}>{t('プランを見る →')}</Text>
              </Pressable>
            )}
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
                    <Text style={s.stagedT}>{t('体重')} {staged.weight}kg</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <OptionButton variant="teal" busy={saving} onPress={confirmSave}
                                label={t('✓ この内容で保存') + (staged.items.length > 0 ? `（${Math.round(sumItems(staged.items).kcal)}kcal）` : '')} />
                  <Pressable onPress={() => { setStaged(null); setStagedNote(''); }} hitSlop={8}>
                    <Text style={s.stagedClear}>{t('破棄')}</Text>
                  </Pressable>
                </View>
              </View>
            )}
            {day && (() => {
              const left = day.goalKcal - day.eaten - Math.round(stagedTotal.kcal);
              return (
                <View style={s.preview}>
                  <Text style={[s.previewMain, left < 0 && { color: C.coral }]}>
                    {left >= 0 ? t('残り {n}kcal', { n: left.toLocaleString() }) : t('{n}kcal 超過', { n: (-left).toLocaleString() })}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, flex: 1, marginLeft: 10, alignItems: 'center' }}>
                    {([['P', day.p, stagedTotal.p], ['F', day.f, stagedTotal.f], ['C', day.c, stagedTotal.c]] as const).map(([ab, d2, stg]) => (
                      <View key={ab} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <Text style={s.previewAb}>{ab}</Text>
                        <LiveBar eaten={d2.eaten} staged={Math.round(stg)} target={d2.target} color={C.teal} pulse={pulse} height={4} />
                      </View>
                    ))}
                  </View>
                </View>
              );
            })()}
            <View style={s.dock}>
              <DockIconButton Icon={Camera} onPress={() => pickPhoto(true)} />
              <DockIconButton Icon={Images} onPress={() => pickPhoto(false)} />
              <TextInput
                ref={inputRef} style={s.input} placeholder={t('バナナ、コーヒー など…')} placeholderTextColor={C.faint}
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

const s = themed(() => ({
  preview: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 7 },
  previewMain: { fontSize: 12, fontWeight: '800', color: C.teal, fontVariant: ['tabular-nums'] },
  previewAb: { fontSize: 10, fontWeight: '900', color: C.sub },
  fab: {
    position: 'absolute', right: 18, width: 54, height: 54, borderRadius: 27,
    backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', zIndex: 20,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
  fabT: { color: C.panel, fontSize: 26, fontWeight: '600', marginTop: -2 },  // ink地（ダーク=明色）に追従
  backdrop: { flex: 1, backgroundColor: 'rgba(14,17,22,0.35)' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 14 },
  grip: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '800', color: C.ink, marginBottom: 10 },
  titleSub: { fontSize: 13, fontWeight: '400', color: C.sub },
  thumb: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: C.line },
  msg: { fontSize: 13, fontWeight: '600', color: C.sub, marginBottom: 6 },
  stagedBox: { backgroundColor: C.accentBadge, borderWidth: 1, borderColor: C.accentBorder, borderRadius: 14, padding: 10, marginBottom: 8 },
  stagedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  stagedT: { flex: 1, fontSize: 13, fontWeight: '700', color: C.ink },
  stagedKcal: { fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
  stagedX: { fontSize: 17, fontWeight: '800', color: C.coral },
  stagedSave: { backgroundColor: C.teal, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  stagedSaveT: { color: '#fff', fontSize: 13, fontWeight: '800' },
  stagedClear: { fontSize: 13, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  dock: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 24, paddingHorizontal: 8, paddingVertical: 6,
  },
  iconBtn: { padding: 4 },
  icon: { fontSize: 21 },
  input: { flex: 1, fontSize: 17, color: C.ink, paddingVertical: 6, paddingHorizontal: 4 },
  send: { backgroundColor: C.teal, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sendT: { color: '#fff', fontSize: 17, fontWeight: '800' },
}));
