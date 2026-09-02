// 透過ステッカー共有（Strava式）。
// ベタ画像ではなく「文字・数字・グラフ線・小さなロゴだけ」の背景透過PNGを生成し、
// ①クリップボードへコピー（Instagramのストーリーで長押し→ペーストで貼れる）
// ②写真に保存（透過のまま保存されるので、他のアプリでも重ねられる）
// の2経路で渡す。白/黒の2トーンは、載せる写真の明暗に合わせてユーザーが選ぶ。
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Modal, Alert } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import Svg, { Path, Circle, Polyline } from 'react-native-svg';
import { badgeIconOf } from '@/components/BadgeIcon';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';

// ステッカーに載せる内容（種類ごとに1画面で完結する最小の情報だけ）。
// 共有スコープは **バッジ・筋トレ実績（自己ベスト）・体重変化グラフ** の3種に限定
// （docs/INSIGHTS-ENGINE.md §5・2026-09-02）。
//  ・'law'（法則）は除外: 熊田さん「法則をストーリーに乗せる意味はない」。法則はカードをタップして
//    解説記事（app/law-detail.tsx）で「健康への視座と科学的裏付け」を読むものになった
//  ・'streak' / 'today' / 'workout' も同時に外した: 「見せて自慢する」対象を実績（バッジ・PR）に絞る
//  ・'weight'（体重変化グラフ・2026-09-02 E1c）: 期間（30/90日）の体重ミニ折れ線＋「−2.4kg / 30日」の大数字。
//    導線は概要「体の記録」詳細ページ右上の共有アイコン（app/(tabs)/changes.tsx）。
//    **実体重（開始・現在値）は既定で載せない**（FEATURES.md G7「共有ステッカーの実数マスク」）。
//    本人が「実数を載せる」を明示的にONにしたときだけ START/NOW の値を描く。
//    bulk（増量目的）では「増えた」が良い方向なので、良い方向の色づけを反転する（符号は数学的な向きのまま）
export type StickerData =
  | { kind: 'pr'; name: string; kg: number; date: string }
  | { kind: 'badge'; id: string; name: string }
  | { kind: 'weight'; points: { date: string; kg: number }[]; days: number; bulk: boolean };

type Tone = 'light' | 'dark'; // light=白文字（暗い写真用） dark=黒文字（明るい写真用）

function toneColor(tone: Tone): string { return tone === 'light' ? '#ffffff' : '#0e1116'; }
function toneSub(tone: Tone): string { return tone === 'light' ? 'rgba(255,255,255,0.75)' : 'rgba(14,17,22,0.65)'; }
// 「良い方向」の強調色（体重ステッカーの大数字）。写真の上に載るためテーマのCではなくトーン固定色。
// 白文字トーンではミント、黒文字トーンでは深い緑（どちらも背景の明暗で読める）
function toneGood(tone: Tone): string { return tone === 'light' ? '#5ee6a8' : '#0f8a5f'; }

/** 体重の変化量。表示は数学的な向き（減れば−・増えれば+）。good は目的（減量/増量）で反転 */
export function weightDelta(points: { kg: number }[], bulk: boolean): { delta: number; text: string; good: boolean } | null {
  if (points.length < 2) return null;
  const delta = Math.round((points[points.length - 1].kg - points[0].kg) * 10) / 10;
  const text = `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta).toFixed(1)}`;
  // 減量: 減った（<0）が良い。増量（bulk）: 増えた（>0）が良い。0は中立
  const good = bulk ? delta > 0 : delta < 0;
  return { delta, text, good };
}

// 体重のミニ折れ線（ステッカー用・軸なし）。始点と終点に小さな丸。線はトーン色、終点の丸だけ強調色
function WeightLine({ points, tone, good }: { points: { kg: number }[]; tone: Tone; good: boolean }) {
  const w = 190; const h = 64; const pad = 5;
  const vals = points.map((p) => p.kg);
  const min = Math.min(...vals); const max = Math.max(...vals);
  const xy = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
    const y = max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - pad * 2);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const col = toneColor(tone);
  const last = xy[xy.length - 1]; const first = xy[0];
  return (
    <Svg width={w} height={h}>
      <Polyline points={xy.map(([x, y]) => `${x},${y}`).join(' ')} stroke={col} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={first[0]} cy={first[1]} r={3.5} fill={toneSub(tone)} />
      <Circle cx={last[0]} cy={last[1]} r={4.5} fill={good ? toneGood(tone) : col} />
    </Svg>
  );
}

// 大数字＋小ラベルの1ブロック（Stravaの階層をそのまま踏襲）
function Stat({ label, value, unit, tone, big }: { label: string; value: string; unit?: string; tone: Tone; big?: boolean }) {
  return (
    <View style={{ alignItems: 'center', marginVertical: 6 }}>
      <Text style={[st.label, { color: toneSub(tone) }]}>{label}</Text>
      {/* ステッカーはPNGにキャプチャする固定レイアウトのため文字サイズ拡大は上限1.3 */}
      <Text style={[big ? st.big : st.mid, { color: toneColor(tone) }]} maxFontSizeMultiplier={1.3}>
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

function StickerBody({ data, tone, showValues }: { data: StickerData; tone: Tone; showValues: boolean }) {
  const col = toneColor(tone);
  const wd = data.kind === 'weight' ? weightDelta(data.points, data.bulk) : null;
  const today = new Date();
  const dateLine = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
  return (
    <View style={{ alignItems: 'center', paddingVertical: 12, paddingHorizontal: 18 }}>
      <Text style={[st.dateLine, { color: toneSub(tone) }]}>{dateLine}</Text>
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
      {data.kind === 'weight' && wd && (
        <>
          {/* 期間ラベル → ミニ折れ線 → 大数字（変化量）→ 期間の一言。良い方向だけ強調色 */}
          <Text style={[st.label, { color: toneSub(tone) }]}>{`WEIGHT · ${data.days} DAYS`}</Text>
          <View style={{ marginTop: 6, marginBottom: 2 }}>
            <WeightLine points={data.points} tone={tone} good={wd.good} />
          </View>
          <Text style={[st.big, { color: wd.good ? toneGood(tone) : col }]} maxFontSizeMultiplier={1.3}>
            {wd.text}
            <Text style={[st.unit, { color: toneSub(tone) }]}> kg</Text>
          </Text>
          <Text style={[st.tagline, { color: toneSub(tone) }]}>{t('{n}日で', { n: data.days })}</Text>
          {/* 実数（開始・現在）は本人がONにしたときだけ（G7 実数マスク） */}
          {showValues && (
            <View style={st.valRow}>
              <View style={{ alignItems: 'center' }}>
                <Text style={[st.valLabel, { color: toneSub(tone) }]}>START</Text>
                <Text style={[st.mid, { color: col }]} maxFontSizeMultiplier={1.3}>{data.points[0].kg.toFixed(1)}</Text>
              </View>
              <Text style={[st.valArrow, { color: toneSub(tone) }]}>→</Text>
              <View style={{ alignItems: 'center' }}>
                <Text style={[st.valLabel, { color: toneSub(tone) }]}>NOW</Text>
                <Text style={[st.mid, { color: col }]} maxFontSizeMultiplier={1.3}>{data.points[data.points.length - 1].kg.toFixed(1)}</Text>
              </View>
            </View>
          )}
        </>
      )}
      {/* アプリ名の署名（feat/invite）。
          ステッカーを見た人が辿り着ける唯一の手がかりなので必ず入れる。ただし主役は
          数字と発見文なので、絵の右下に小さく落款のように置く（alignSelf:'flex-end'）。
          QRコードは入れない — 写真の上に載せる透過画像に四角い黒塊が乗ると絵が汚れるうえ、
          「BodyLoger」はApp Storeの検索で一意に当たるので名前だけで足りる。
          色はトーン（白/黒）に追従（toneColor/toneSub）。中央寄せの本文には触らないため、
          既存の各ステッカーのレイアウトは1pxも動かない。 */}
      <View style={st.sign}>
        <Svg width={11} height={11} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={10} stroke={col} strokeWidth={2.5} fill="none" />
          <Path d="M7 13 L11 16 L17 8" stroke={col} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
        <Text style={[st.brand, { color: toneSub(tone) }]} maxFontSizeMultiplier={1.2}>BodyLoger</Text>
      </View>
    </View>
  );
}

/** ステッカー作成モーダル。visibleで開き、白黒切替→コピー/保存 */
export default function ShareStickerModal({ data, visible, onClose }: { data: StickerData | null; visible: boolean; onClose: () => void }) {
  const [tone, setTone] = useState<Tone>('light');
  const [busy, setBusy] = useState(false);
  // 体重ステッカーの「実数（開始・現在の体重）を載せる」。既定OFF＝G7 実数マスク。モーダルを開くたびにOFFへ戻る
  const [showValues, setShowValues] = useState(false);
  useEffect(() => { if (!visible) setShowValues(false); }, [visible]);
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
  // 体重ステッカーは点が2つ未満なら描けない（呼び出し側で防ぐが、型の上では来うる）
  if (data.kind === 'weight' && data.points.length < 2) return null;
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
              <StickerBody data={data} tone={tone} showValues={showValues} />
            </View>
          </View>
          {/* 体重ステッカーだけ: 実数を載せるかの明示的な選択（既定は変化量だけ） */}
          {data.kind === 'weight' && (
            <Pressable style={st.optRow} onPress={() => setShowValues((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: showValues }}>
              <View style={[st.optBox, showValues && st.optBoxOn]}>{showValues && <Text style={st.optCheck}>✓</Text>}</View>
              <View style={{ flex: 1 }}>
                <Text style={st.optT}>{t('開始・現在の体重（実数）も載せる')}</Text>
                <Text style={st.optSub}>{t('OFFのままなら変化量だけが載り、体重そのものは写りません。')}</Text>
              </View>
            </Pressable>
          )}
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
            <Text style={[st.ctaT, { color: C.accentInk }]}>{t('写真に保存')}</Text>
          </Pressable>
          <Pressable onPress={onClose} hitSlop={8} style={{ alignSelf: 'center', marginTop: 10 }}>
            <Text style={st.close}>{t('とじる')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const st = themed(() => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 22 },
  sheet: { backgroundColor: C.panel, borderRadius: 20, padding: 18 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  subT: { fontSize: 12.5, color: C.sub, marginTop: 2, marginBottom: 12, lineHeight: 18 },
  preview: { borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  toneRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  toneBtn: { flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  toneBtnOn: { borderColor: C.teal, backgroundColor: C.accentSoft },
  toneT: { fontSize: 12.5, fontWeight: '700', color: C.sub },
  toneTOn: { color: C.accentInk },
  cta: { backgroundColor: C.teal, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  ctaTonal: { backgroundColor: C.accentSoft },
  ctaT: { fontSize: 15, fontWeight: '800', color: '#fff' },
  close: { fontSize: 13, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  // 体重ステッカーの「実数を載せる」チェック行（シート側＝テーマ色）
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, paddingVertical: 4 },
  optBox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  optBoxOn: { backgroundColor: C.teal, borderColor: C.teal },
  optCheck: { fontSize: 13, fontWeight: '900', color: '#fff', lineHeight: 15 },
  optT: { fontSize: 13, fontWeight: '700', color: C.ink },
  optSub: { fontSize: 11.5, color: C.sub, marginTop: 1, lineHeight: 16 },
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
  // 体重ステッカーの実数行（START → NOW）。ONのときだけ描く
  valRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  valLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 2.5 },
  valArrow: { fontSize: 16, fontWeight: '700', marginTop: 10 },
  // 署名（右下の落款）。alignSelf:'flex-end' で本文の中央寄せを崩さずに右へ寄せる
  sign: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, alignSelf: 'flex-end' },
  brand: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
}));
