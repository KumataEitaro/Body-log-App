// 体脂肪率を AI で推定して**数値だけ**保存するシート（2026-09-18）。
//
// 熊田さん「体の写真保存はエラーが出るのであきらめる。機能として消して。
//           代わりに AI で測定した体脂肪率の保存のみ出来るようにして（画像の保存はできませんと明示して）」
//
// 旧「体の写真」カード（概要タブ）は、写真を Supabase Storage に上げてから体脂肪率を保存していた。
// Storage の保存が環境によって失敗し続け、しかも体の写真は機微情報でもある。**写真は残さない**。
//   ・写真は AI（/api/analyze-body）に推定を頼むために送るだけで、端末にもサーバにも保存しない
//   ・保存するのは体脂肪率(%)の数値だけ（logs に数値だけの行 → entries に同期。lib/bodyLog.ts）
//   ・推定は ±3% 程度の目安なので、本人が数値を直してから保存できる
//
// 入口は＋シートの「体脂肪率（AIで推定）」だけ。PlusSheet が閉じ切ってから visible になるので、
// iOS の「表示中の Modal の兄弟に別の Modal を出せない」制約を踏まない（AddFoodSheet と同じ配置）。
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Image, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Camera, ImagePlus, Sparkles, ShieldOff } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { apiPost } from '@/lib/api';
import { t, apiLang } from '@/lib/i18n';
import { C, sheetTopPad, themed, RADIUS, ICON } from '@/lib/ui';
import { OptionButton } from '@/components/ui/Selectable';
import { saveBodyfatEntry } from '@/lib/bodyLog';
import { BODYFAT_RANGE } from '@/lib/guard';
import { todayJST } from '@/lib/calc';
import { useThemeRefresh } from '@/lib/theme';

type Estimate = { pct: number; comment: string };

export default function BodyFatSheet({ visible, onClose, onSaved, date }: {
  visible: boolean;
  onClose: () => void;
  /** 保存できたとき（%）。トーストや再読込は呼び出し側 */
  onSaved: (pct: number) => void;
  /** 記録先の日付（YYYY-MM-DD）。省略なら今日 */
  date?: string;
}) {
  useThemeRefresh();   // 壁（ThemeRemount）の外に出る Modal を持つので、自分でテーマを購読する（2026-09-17）
  // 写真は state に **一時的に** 持つだけ（端末のギャラリーにも保存しない・シートを閉じたら捨てる）
  const [img, setImg] = useState<{ uri: string; base64: string } | null>(null);
  const [est, setEst] = useState<Estimate | null>(null);
  const [value, setValue] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 開くたびに白紙から（前回の写真・推定を引き継がない＝写真を保持しない約束の一部）
  useEffect(() => {
    if (visible) { setImg(null); setEst(null); setValue(''); setMsg(null); setAiBusy(false); setBusy(false); }
  }, [visible]);

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
      // 1080px に縮小してから送る（送信量と AI の処理時間のため）。端末の一時領域にしか置かれない
      const out = await manipulateAsync(res.assets[0].uri, [{ resize: { width: 1080 } }], { compress: 0.8, format: SaveFormat.JPEG, base64: true });
      if (!out.base64) { setMsg(t('画像の処理に失敗しました。')); return; }
      setImg({ uri: out.uri, base64: out.base64 });
      setEst(null); setValue('');
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

  async function save() {
    if (!est || busy) return;
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await saveBodyfatEntry(value, { uid: session?.user?.id, date: date ?? todayJST() });
      if (!r.ok) { setMsg(r.msg); return; }
      setImg(null);   // 保存できたら写真は即捨てる
      onSaved(r.value);
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

          {/* 明示: 写真は保存されない。これが無いと「体の写真を撮る機能」に見えてしまう */}
          <View style={s.notice} testID="bodyfat-no-photo-notice">
            <ShieldOff size={ICON.md} color={C.sub} />
            <Text style={s.noticeT}>{t('写真は保存されません。AIが体脂肪率を推定するために一度使うだけで、記録に残るのは数値だけです。')}</Text>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 24 }}>
            {/* 写真を選ぶ（同じ場所・同じ明るさで撮ると推定が安定する） */}
            <View style={s.pickRow}>
              <OptionButton style={{ flex: 1 }} label={t('撮影する')} leading={<Camera size={ICON.md} color={C.panel} strokeWidth={ICON.stroke} />}
                            onPress={() => { void pick(true); }} disabled={aiBusy} />
              <OptionButton variant="tonal" label={t('写真から選ぶ')} leading={<ImagePlus size={ICON.md} color={C.ink} strokeWidth={ICON.stroke} />}
                            onPress={() => { void pick(false); }} disabled={aiBusy} />
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
                          placeholder={String(est.pct)} placeholderTextColor={C.faint}
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
              variant="teal" style={{ marginTop: 16 }} label={t('体脂肪率を記録')}
              onPress={() => { void save(); }} busy={busy} disabled={!est || aiBusy || !value.trim()}
            />
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
  noticeT: { flex: 1, fontSize: 13, color: C.sub, lineHeight: 18 },
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
  msg: { fontSize: 13, fontWeight: '700', color: C.coral, marginTop: 10 },
}));
