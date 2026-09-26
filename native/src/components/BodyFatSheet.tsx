// 体脂肪率を AI で推定し、**写真と一緒に**保存するシート（2026-09-18 新設・2026-09-26 写真の保存を復活）。
//
// 経緯:
//   2026-09-18 熊田さん「体の写真保存はエラーが出るのであきらめる。機能として消して。
//                       代わりに AI で測定した体脂肪率の保存のみ出来るようにして」
//   2026-09-26 熊田さん「自分の体の画像を保存（推定体脂肪率とセットで）。うまく機能していないからテストして直して」
//
// いまの流れ: 撮影／写真から選ぶ → AI（/api/analyze-body）が推定 → 本人が数値を確認・修正 → 保存。
//   1. 体脂肪率(%)を logs に数値だけの行として保存 → entries に同期（lib/bodyLog.ts・従来どおり）
//   2. 「写真も保存する」が ON（既定）なら、写真を非公開バケット body-photos に上げ、body_photos に
//      { date, path, bodyfat } を1行入れる（lib/bodyPhotos.ts）。**自分だけが見られる**（署名付き URL・RLS）
//   ・写真の保存に失敗しても体脂肪率は保存済み。**何が保存され何が失敗したか**を本文つきで出し、
//     ボタンは「写真をもう一度保存する」に変わる（体脂肪率を二重に保存しない）
//   ・OFF にした選択は 'bl-bodyphoto-save' に記憶（サインアウトで消える側・lib/signOutCleanup.ts）
//   ・推定は ±3% 程度の目安なので、本人が数値を直してから保存できる
//
// 入口は＋シートの「体脂肪率（AIで推定）」だけ。PlusSheet が閉じ切ってから visible になるので、
// iOS の「表示中の Modal の兄弟に別の Modal を出せない」制約を踏まない（AddFoodSheet と同じ配置）。
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Image, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator, Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Camera, ImagePlus, Sparkles, ShieldCheck } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { apiPost } from '@/lib/api';
import { t, apiLang } from '@/lib/i18n';
import { C, sheetTopPad, themed, RADIUS, ICON } from '@/lib/ui';
import { OptionButton } from '@/components/ui/Selectable';
import { saveBodyfatEntry } from '@/lib/bodyLog';
import { saveBodyPhoto } from '@/lib/bodyPhotos';
import { BODYFAT_RANGE } from '@/lib/guard';
import { todayJST } from '@/lib/calc';
import { useThemeRefresh } from '@/lib/theme';

type Estimate = { pct: number; comment: string };

/** 「写真も保存する」を OFF にした記憶（'0' のときだけ OFF。無ければ既定の ON） */
const SAVE_PHOTO_KEY = 'bl-bodyphoto-save';

export default function BodyFatSheet({ visible, onClose, onSaved, date }: {
  visible: boolean;
  onClose: () => void;
  /** 体脂肪率を保存できたとき（%）。トーストや再読込は呼び出し側。写真の保存はこの後に続く */
  onSaved: (pct: number) => void;
  /** 記録先の日付（YYYY-MM-DD）。省略なら今日 */
  date?: string;
}) {
  useThemeRefresh();   // 壁（ThemeRemount）の外に出る Modal を持つので、自分でテーマを購読する（2026-09-17）
  // 写真は state に持ち、保存できたら（または閉じたら）捨てる
  const [img, setImg] = useState<{ uri: string; base64: string } | null>(null);
  const [est, setEst] = useState<Estimate | null>(null);
  const [value, setValue] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [savePhoto, setSavePhoto] = useState(true);
  /** 体脂肪率を保存できた値（写真の保存に失敗したあとの「もう一度」で二重保存しないための印） */
  const [bfSaved, setBfSaved] = useState<number | null>(null);

  // 開くたびに白紙から（前回の写真・推定を引き継がない）。「写真も保存する」の記憶だけ読む
  useEffect(() => {
    if (!visible) return;
    setImg(null); setEst(null); setValue(''); setMsg(null); setAiBusy(false); setBusy(false); setBfSaved(null);
    AsyncStorage.getItem(SAVE_PHOTO_KEY).then((v) => setSavePhoto(v !== '0')).catch(() => {});
  }, [visible]);

  function togglePhoto(v: boolean) {
    setSavePhoto(v);
    (v ? AsyncStorage.removeItem(SAVE_PHOTO_KEY) : AsyncStorage.setItem(SAVE_PHOTO_KEY, '0')).catch(() => {});
  }

  async function pick(fromCamera: boolean) {
    setMsg(null);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setMsg(fromCamera ? t('カメラの許可が必要です。') : t('写真の許可が必要です。')); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled || !res.assets?.length) return;
    try {
      // 1080px に縮小してから送る（送信量・AI の処理時間・保存容量のため）。端末の一時領域にしか置かれない
      const out = await manipulateAsync(res.assets[0].uri, [{ resize: { width: 1080 } }], { compress: 0.8, format: SaveFormat.JPEG, base64: true });
      if (!out.base64) { setMsg(t('画像の処理に失敗しました。')); return; }
      setImg({ uri: out.uri, base64: out.base64 });
      setEst(null); setValue(''); setBfSaved(null);
      await estimate(out.base64);
    } catch { setMsg(t('画像の処理に失敗しました。')); }
  }

  /** 写真から AI が体脂肪率を推定する（±3% 程度の目安・結果は編集できる） */
  async function estimate(base64: string) {
    setAiBusy(true); setMsg(null);
    try {
      const { ok, json } = await apiPost<{ ok: boolean; result?: { bf_est?: number; comment?: string }; error?: string }>(
        '/api/analyze-body', { mode: 'assess', lang: apiLang(), images: [{ data: base64, mime: 'image/jpeg' }] });
      if (ok && json?.ok && json.result?.bf_est != null) {
        const pct = Number(json.result.bf_est);
        setEst({ pct, comment: String(json.result.comment ?? '') });
        setValue(pct.toFixed(1));
      } else {
        setMsg(json?.error || t('AI推定に失敗しました。もう一度お試しください。'));
      }
    } catch {
      setMsg(t('通信に失敗しました。'));
    } finally { setAiBusy(false); }
  }

  /**
   * 保存: ① 体脂肪率（まだなら）→ ② 写真（ON のとき）。
   * ② に失敗してもシートは閉じず、「体脂肪率は保存済み・写真は失敗」と本文を出す。次のタップは ② だけをやり直す
   */
  async function save() {
    if (!est || busy || !img) return;
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      const day = date ?? todayJST();
      let pct = bfSaved;
      if (pct == null) {
        const r = await saveBodyfatEntry(value, { uid, date: day });
        if (!r.ok) { setMsg(r.msg); return; }
        pct = r.value;
        setBfSaved(r.value);
        onSaved(r.value);
      }
      if (savePhoto && uid) {
        const p = await saveBodyPhoto({ uid, date: day, base64: img.base64, bodyfat: pct });
        if (!p.ok) {
          setMsg(t('写真は保存できませんでした（体脂肪率 {n}% は保存済み）', { n: pct.toFixed(1) }) + '\n' + p.error);
          return;
        }
      }
      setImg(null);   // 保存できたら写真は state から捨てる
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.wrap}>
          <View style={s.head}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Sparkles size={ICON.lg} color={C.teal} />
              <Text style={s.title}>{t('体脂肪率（AIで推定）')}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button"><Text style={s.close}>{t('閉じる')}</Text></Pressable>
          </View>

          {/* 写真の扱いを明示: 既定は「自分だけが見られる非公開の場所に保存」。OFF なら数値だけ */}
          <View style={s.notice} testID="bodyfat-photo-notice">
            <ShieldCheck size={ICON.md} color={savePhoto ? C.successInk : C.sub} />
            <View style={{ flex: 1 }}>
              <Text style={s.noticeTitle}>{t('写真も保存する')}</Text>
              <Text style={s.noticeT}>
                {savePhoto
                  ? t('写真は自分だけが見られる非公開の場所に保存されます')
                  : t('写真は保存しません（体脂肪率の数値だけ記録します）')}
              </Text>
            </View>
            <Switch value={savePhoto} onValueChange={togglePhoto} trackColor={{ true: C.teal }} disabled={busy}
                    accessibilityLabel={t('写真も保存する')} testID="bodyfat-save-photo-switch" />
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 24 }}>
            {/* 写真を選ぶ（同じ場所・同じ明るさで撮ると推定が安定し、比較もしやすい） */}
            <View style={s.pickRow}>
              <OptionButton style={{ flex: 1 }} label={t('撮影する')} leading={<Camera size={ICON.md} color={C.panel} strokeWidth={ICON.stroke} />}
                            onPress={() => { void pick(true); }} disabled={aiBusy || busy} />
              <OptionButton variant="tonal" label={t('写真から選ぶ')} leading={<ImagePlus size={ICON.md} color={C.ink} strokeWidth={ICON.stroke} />}
                            onPress={() => { void pick(false); }} disabled={aiBusy || busy} />
            </View>
            <Text style={s.hint}>{t('全身が入るように、同じ場所・同じ明るさで。推定は±3%程度の目安です。')}</Text>

            {img && (
              <View style={s.resultBox}>
                <Image source={{ uri: img.uri }} style={s.thumb} />
                <View style={{ flex: 1 }}>
                  {aiBusy ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <ActivityIndicator size="small" color={C.teal} />
                      <Text style={s.estLabel}>{t('AIが推定しています…')}</Text>
                    </View>
                  ) : est ? (
                    <>
                      <Text style={s.estLabel}>{t('AI推定 {n}%（±3%程度の目安）', { n: est.pct.toFixed(1) })}</Text>
                      {est.comment ? <Text style={s.estComment}>{est.comment}</Text> : null}
                      <Text style={s.label}>{t('記録する体脂肪率（%）')}</Text>
                      <View style={s.valueRow}>
                        <TextInput
                          style={s.input} value={value} onChangeText={setValue} keyboardType="decimal-pad"
                          placeholder={String(est.pct)} placeholderTextColor={C.faint} editable={bfSaved == null}
                          accessibilityLabel={t('記録する体脂肪率（%）')} maxFontSizeMultiplier={1.3}
                        />
                        <Text style={s.unit}>%</Text>
                      </View>
                      <Text style={s.hint}>{t('{min}〜{max}%の範囲で。推定と違うと感じたら直してから保存できます。', { min: BODYFAT_RANGE.min, max: BODYFAT_RANGE.max })}</Text>
                    </>
                  ) : (
                    <Pressable style={s.retry} onPress={() => { void estimate(img.base64); }} accessibilityRole="button">
                      <Sparkles size={ICON.sm} color={C.accentInk} />
                      <Text style={s.retryT}>{t('もう一度推定する')}</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}

            {msg && <Text style={s.msg}>{msg}</Text>}

            <OptionButton
              variant="teal" style={{ marginTop: 16 }}
              label={bfSaved == null ? t('体脂肪率を記録') : t('写真をもう一度保存する')}
              onPress={() => { void save(); }} busy={busy} disabled={!est || aiBusy || !value.trim()}
            />
            {bfSaved != null && (
              <OptionButton variant="tonal" style={{ marginTop: 8 }} label={t('写真を保存せずに閉じる')} onPress={onClose} disabled={busy} />
            )}
            {!est && <Text style={s.hint}>{t('写真からAIが推定すると記録できます。')}</Text>}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: sheetTopPad(18) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  close: { fontSize: 15, fontWeight: '700', color: C.accentInk },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 6,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.tile, padding: 12,
  },
  noticeTitle: { fontSize: 14, fontWeight: '800', color: C.ink },
  noticeT: { fontSize: 12, color: C.sub, lineHeight: 17, marginTop: 2 },
  pickRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  hint: { fontSize: 12, color: C.faint, marginTop: 8, lineHeight: 17 },
  resultBox: {
    flexDirection: 'row', gap: 12, marginTop: 14, alignItems: 'flex-start',
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.hairline, borderRadius: RADIUS.panel, padding: 12,
  },
  thumb: { width: 84, height: 112, borderRadius: RADIUS.input, backgroundColor: C.bg },
  estLabel: { fontSize: 14, fontWeight: '800', color: C.accentInk },
  estComment: { fontSize: 13, color: C.sub, marginTop: 4, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 12, marginBottom: 5 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    width: 120, backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.input,
    paddingVertical: 10, paddingHorizontal: 14, fontSize: 24, fontWeight: '800', color: C.ink, textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  unit: { fontSize: 17, fontWeight: '700', color: C.sub },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  retryT: { fontSize: 14, fontWeight: '800', color: C.accentInk },
  msg: { fontSize: 13, fontWeight: '700', color: C.coral, marginTop: 10, lineHeight: 18 },
}));
