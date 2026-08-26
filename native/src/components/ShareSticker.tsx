// 透過ステッカー共有（Strava式）。
// ベタ画像ではなく「文字・数字・グラフ線・小さなロゴだけ」の背景透過PNGを生成し、
// ①クリップボードへコピー（Instagramのストーリーで長押し→ペーストで貼れる）
// ②写真に保存（透過のまま保存されるので、他のアプリでも重ねられる）
// の2経路で渡す。白/黒の2トーンは、載せる写真の明暗に合わせてユーザーが選ぶ。
import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Alert } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import Svg, { Path, Circle } from 'react-native-svg';
import { Flame } from 'lucide-react-native';
import { badgeIconOf } from '@/components/BadgeIcon';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';

// ステッカーに載せる内容（種類ごとに1画面で完結する最小の情報だけ）
export type StickerData =
  | { kind: 'streak'; days: number }
  | { kind: 'pr'; name: string; kg: number; date: string }
  | { kind: 'today'; kcal: number; left: number; p: number; f: number; c: number }
  | { kind: 'workout'; label: string; kcal: number; minutes: number; km?: number | null }
  | { kind: 'badge'; id: string; name: string };

type Tone = 'light' | 'dark'; // light=白文字（暗い写真用） dark=黒文字（明るい写真用）

function toneColor(tone: Tone): string { return tone === 'light' ? '#ffffff' : '#0e1116'; }
function toneSub(tone: Tone): string { return tone === 'light' ? 'rgba(255,255,255,0.75)' : 'rgba(14,17,22,0.65)'; }

// 大数字＋小ラベルの1ブロック（Stravaの階層をそのまま踏襲）
function Stat({ label, value, unit, tone, big }: { label: string; value: string; unit?: string; tone: Tone; big?: boolean }) {
  return (
    <View style={{ alignItems: 'center', marginVertical: 6 }}>
      <Text style={[st.label, { color: toneSub(tone) }]}>{label}</Text>
      <Text style={[big ? st.big : st.mid, { color: toneColor(tone) }]}>
        {value}
        {unit ? <Text style={[st.unit, { color: toneSub(tone) }]}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

// 細い罫線（エディトリアルの句読点。写真の上でも情報の区切りが立つ）
function Rule({ tone }: { tone: Tone }) {
  return <View style={{ width: 42, height: 1.5, backgroundColor: toneSub(tone), marginVertical: 8, borderRadius: 1 }} />;
}

function StickerBody({ data, tone }: { data: StickerData; tone: Tone }) {
  const col = toneColor(tone);
  const today = new Date();
  const dateLine = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
  return (
    <View style={{ alignItems: 'center', paddingVertical: 12, paddingHorizontal: 18 }}>
      <Text style={[st.dateLine, { color: toneSub(tone) }]}>{dateLine}</Text>
      {data.kind === 'streak' && (
        <>
          <Flame size={44} color={col} fill={col} />
          <Stat label="" value={String(data.days)} unit="" tone={tone} big />
          <Text style={[st.label, { color: col, marginTop: -4 }]}>DAY STREAK</Text>
          <Rule tone={tone} />
          <Text style={[st.tagline, { color: toneSub(tone) }]}>{t('毎日の記録、続いてます')}</Text>
        </>
      )}
      {data.kind === 'pr' && (
        <>
          <Text style={[st.label, { color: toneSub(tone) }]}>PERSONAL BEST</Text>
          <Text style={[st.prName, { color: col }]}>{data.name}</Text>
          <Stat label="" value={String(data.kg)} unit="kg" tone={tone} big />
          <View style={st.newPill}><Text style={st.newPillT}>NEW RECORD</Text></View>
        </>
      )}
      {data.kind === 'badge' && (
        <>
          {(() => { const Icon = badgeIconOf(data.id); return <Icon size={44} color={col} strokeWidth={2} />; })()}
          <Text style={[st.prName, { color: col, marginTop: 4 }]}>{data.name}</Text>
          <Rule tone={tone} />
          <Text style={[st.label, { color: toneSub(tone) }]}>ACHIEVEMENT UNLOCKED</Text>
        </>
      )}
      {data.kind === 'today' && (
        <>
          <Text style={[st.label, { color: toneSub(tone) }]}>TODAY</Text>
          <Stat label={t('摂取')} value={data.kcal.toLocaleString()} unit="kcal" tone={tone} big />
          <View style={{ flexDirection: 'row', gap: 18 }}>
            <Stat label="P" value={`${Math.round(data.p)}g`} tone={tone} />
            <Stat label="F" value={`${Math.round(data.f)}g`} tone={tone} />
            <Stat label="C" value={`${Math.round(data.c)}g`} tone={tone} />
          </View>
          {data.left > 0 && <Text style={[st.label, { color: toneSub(tone) }]}>{t('あと{n}kcal 食べられる', { n: data.left.toLocaleString() })}</Text>}
        </>
      )}
      {data.kind === 'workout' && (
        <>
          <Text style={[st.label, { color: toneSub(tone) }]}>WORKOUT</Text>
          <Text style={[st.prName, { color: col }]}>{data.label}</Text>
          <View style={{ flexDirection: 'row', gap: 18 }}>
            {data.km != null && data.km > 0 && <Stat label={t('距離')} value={data.km.toFixed(2)} unit="km" tone={tone} big />}
            <Stat label={t('消費')} value={data.kcal.toLocaleString()} unit="kcal" tone={tone} big={data.km == null || data.km <= 0} />
          </View>
          <Stat label={t('時間')} value={`${data.minutes}`} unit={t('分')} tone={tone} />
        </>
      )}
      {/* 小さなワードマーク＝ダウンロード導線（Strava式のブランド刷り込み） */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 }}>
        <Svg width={12} height={12} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={10} stroke={col} strokeWidth={2.5} fill="none" />
          <Path d="M7 13 L11 16 L17 8" stroke={col} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
        <Text style={[st.brand, { color: toneSub(tone) }]}>BodyLoger</Text>
      </View>
    </View>
  );
}

/** ステッカー作成モーダル。visibleで開き、白黒切替→コピー/保存 */
export default function ShareStickerModal({ data, visible, onClose }: { data: StickerData | null; visible: boolean; onClose: () => void }) {
  const [tone, setTone] = useState<Tone>('light');
  const [busy, setBusy] = useState(false);
  const shotRef = useRef<View>(null);

  async function capturePng(): Promise<string> {
    // 透過を保つため format:'png'。ステッカーは実寸の3倍でシャープに
    return captureRef(shotRef, { format: 'png', quality: 1, result: 'tmpfile' });
  }

  async function copySticker() {
    if (busy) return; setBusy(true);
    try {
      const uri = await capturePng();
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      await Clipboard.setImageAsync(b64);
      Alert.alert(t('コピーしました'), t('Instagramのストーリー編集画面で長押し→「ペースト」すると、写真の上にこのステッカーが載ります。'));
    } catch {
      Alert.alert(t('コピーできませんでした'), t('「写真に保存」からお試しください。'));
    } finally { setBusy(false); }
  }

  async function saveSticker() {
    if (busy) return; setBusy(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert(t('写真への保存が許可されていません（設定アプリ→BodyLog）。')); return; }
      const uri = await capturePng();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert(t('写真に保存しました'), t('透過のまま保存されているので、ストーリーや動画編集アプリで写真の上に重ねられます。'));
    } catch {
      Alert.alert(t('保存に失敗しました。もう一度お試しください。'));
    } finally { setBusy(false); }
  }

  if (!data) return null;
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={st.backdrop}>
        <View style={st.sheet}>
          <Text style={st.title}>{t('ストーリーに共有')}</Text>
          <Text style={st.subT}>{t('文字だけの透過ステッカーです。あなたの写真の上に重ねて使えます。')}</Text>
          {/* プレビュー: 市松模様の代わりに、トーンに応じた背景で見え方を確認 */}
          <View style={[st.preview, { backgroundColor: tone === 'light' ? '#3a4148' : '#e8e6e1' }]}>
            {/* これが実際に書き出される透過View（背景色なし） */}
            <View ref={shotRef} collapsable={false} style={{ backgroundColor: 'transparent' }}>
              <StickerBody data={data} tone={tone} />
            </View>
          </View>
          <View style={st.toneRow}>
            {(['light', 'dark'] as const).map((tn) => (
              <Pressable key={tn} style={[st.toneBtn, tone === tn && st.toneBtnOn]} onPress={() => setTone(tn)}>
                <Text style={[st.toneT, tone === tn && st.toneTOn]}>{tn === 'light' ? t('白（暗い写真用）') : t('黒（明るい写真用）')}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={st.cta} onPress={copySticker} disabled={busy}>
            <Text style={st.ctaT}>{t('コピーしてストーリーに貼る')}</Text>
          </Pressable>
          <Pressable style={[st.cta, st.ctaTonal]} onPress={saveSticker} disabled={busy}>
            <Text style={[st.ctaT, { color: C.teal }]}>{t('写真に保存')}</Text>
          </Pressable>
          <Pressable onPress={onClose} hitSlop={8} style={{ alignSelf: 'center', marginTop: 10 }}>
            <Text style={st.close}>{t('とじる')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 22 },
  sheet: { backgroundColor: C.panel, borderRadius: 20, padding: 18 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  subT: { fontSize: 12.5, color: C.sub, marginTop: 2, marginBottom: 12, lineHeight: 18 },
  preview: { borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  toneRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  toneBtn: { flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  toneBtnOn: { borderColor: C.teal, backgroundColor: C.accentSoft },
  toneT: { fontSize: 12.5, fontWeight: '700', color: C.sub },
  toneTOn: { color: C.teal },
  cta: { backgroundColor: C.teal, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  ctaTonal: { backgroundColor: C.accentSoft },
  ctaT: { fontSize: 15, fontWeight: '800', color: '#fff' },
  close: { fontSize: 13, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  // ステッカー内（写真の上に載る側）
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 3, textTransform: 'uppercase' },
  dateLine: { fontSize: 10, fontWeight: '700', letterSpacing: 2.5, marginBottom: 2, fontVariant: ['tabular-nums'] },
  big: { fontSize: 54, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -1.5, lineHeight: 58 },
  mid: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 14, fontWeight: '700' },
  tagline: { fontSize: 11.5, fontWeight: '600' },
  prName: { fontSize: 19, fontWeight: '800', marginTop: 2, letterSpacing: 0.5 },
  newPill: { backgroundColor: '#ff4d42', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginTop: 4 },
  newPillT: { fontSize: 10.5, fontWeight: '900', color: '#fff', letterSpacing: 2.5 },
  brand: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
});
