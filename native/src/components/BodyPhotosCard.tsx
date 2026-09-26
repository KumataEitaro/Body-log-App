// 体の写真（からだの分析ページ・2026-09-26 復活）
//
// 熊田さん「自分の体の画像を保存（推定体脂肪率とセットで）。うまく機能していないからテストして直して」
// 2026-09-18 に廃止した旧 BodyPhotosCard を現行の設計に合わせて戻したもの。
//   ・見せるだけのカード: 最新と前回の2枚を並べて比較（日付・体脂肪率・差）、横スクロールのタイムライン、
//     タップで拡大（Modal）、長押し／拡大中の「削除」
//   ・**撮影の入口はここに置かない**（入口は右下の＋ → 体脂肪率（AIで推定）に統一済み。BodyFatSheet が
//     体脂肪率の保存と一緒に写真を Storage に上げる）
//   ・データは lib/bodyPhotos.ts（署名付き URL・削除の後始末・失敗の言語化）。失敗は本文つきで画面に出す
// マウントは概要タブ（changes.tsx）が行う。
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Image, ScrollView, Modal, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { X, Trash2, Images } from 'lucide-react-native';
import { C, themed, ICON, RADIUS } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { useThemeRefresh } from '@/lib/theme';
import { listBodyPhotos, deleteBodyPhoto, type BodyPhotoView } from '@/lib/bodyPhotos';

const fmtDate = (d: string) => d.slice(5).replace('-', '/');
const fmtPct = (v: number | null) => (v == null ? null : `${Number(v).toFixed(1)}%`);

export default function BodyPhotosCard({ refreshKey }: {
  /** 値が変わったら読み直す（親が「保存した」を知っているときの再読込用。省略可） */
  refreshKey?: string | number;
} = {}) {
  useThemeRefresh();   // 壁（ThemeRemount）の外に出る Modal を持つので、自分でテーマを購読する（2026-09-17）
  const [photos, setPhotos] = useState<BodyPhotoView[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [viewer, setViewer] = useState<BodyPhotoView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listBodyPhotos(24);
    if (r.ok) { setPhotos(r.photos); setErr(null); } else { setErr(r.error); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);
  // ＋ → 体脂肪率で写真を保存してタブへ戻ってきたときに、古い一覧のままにならないよう読み直す
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function confirmDelete(p: BodyPhotoView) {
    Alert.alert(t('この写真を削除しますか？'), p.date.replace(/-/g, '/'), [
      { text: t('キャンセル'), style: 'cancel' },
      { text: t('削除する'), style: 'destructive', onPress: () => { void remove(p); } },
    ]);
  }
  async function remove(p: BodyPhotoView) {
    setBusyId(p.id); setErr(null);
    const r = await deleteBodyPhoto(p);
    setBusyId(null);
    if (!r.ok) { setErr(r.error); return; }
    setViewer(null);
    setPhotos((prev) => prev.filter((x) => x.id !== p.id));
  }

  const latest = photos[0] ?? null;
  const prev = photos[1] ?? null;
  // 体脂肪率の差（最新 − 前回）。体の指標は 減=success・増=coral（推移の表と同じ色の意味）
  const diff = latest?.bodyfat != null && prev?.bodyfat != null ? Number(latest.bodyfat) - Number(prev.bodyfat) : null;

  return (
    <View style={s.card} testID="body-photos-card">
      <View style={s.h2Row}>
        <Images size={ICON.md} color={C.teal} />
        <Text style={s.h2}>
          {t('体の写真')}
          <Text style={s.h2sub}>{t('— 週1回の見た目チェック')}</Text>
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={C.teal} style={{ marginVertical: 20 }} />
      ) : !latest ? (
        <Text style={s.note}>{t('＋ → 身体を記録 → 体脂肪率（AIで推定）で写真つきで記録できます')}</Text>
      ) : (
        <>
          {/* 比較ビュー: 前回 vs 最新 */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[prev, latest].map((p, i) => (
              <View key={i} style={{ flex: 1 }}>
                <Text style={s.cmpLabel}>{p ? `${fmtDate(p.date)}${i === 1 ? t('（最新）') : ''}` : '—'}</Text>
                {p ? (
                  <Pressable onPress={() => setViewer(p)} onLongPress={() => confirmDelete(p)} delayLongPress={400}
                             accessibilityRole="imagebutton" accessibilityLabel={`${p.date} ${fmtPct(p.bodyfat) ?? ''}`}>
                    {p.url ? <Image source={{ uri: p.url }} style={s.cmpImg} /> : <View style={[s.cmpImg, s.cmpEmpty]}><Text style={s.emptyT}>{t('写真を読み込めませんでした。')}</Text></View>}
                    {p.bodyfat != null && <Text style={s.cmpBf}>{fmtPct(p.bodyfat)}</Text>}
                    {busyId === p.id && <ActivityIndicator color={C.teal} style={s.cmpBusy} />}
                  </Pressable>
                ) : (
                  <View style={[s.cmpImg, s.cmpEmpty]}><Text style={s.emptyT}>{t('前回なし')}</Text></View>
                )}
              </View>
            ))}
          </View>
          {diff != null && (
            <Text style={[s.diffT, diff < 0 ? { color: C.successInk } : diff > 0 ? { color: C.coral } : null]}>
              {t('前回との差')} {diff > 0 ? '+' : diff < 0 ? '-' : '±'}{Math.abs(diff).toFixed(1)}%
            </Text>
          )}

          {/* タイムライン（3枚目以降） */}
          {photos.length > 2 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
              {photos.slice(2).map((p) => (
                <Pressable key={p.id} onPress={() => setViewer(p)} onLongPress={() => confirmDelete(p)} delayLongPress={400}
                           style={{ marginRight: 8 }} accessibilityRole="imagebutton" accessibilityLabel={`${p.date} ${fmtPct(p.bodyfat) ?? ''}`}>
                  {p.url ? <Image source={{ uri: p.url }} style={s.thumb} /> : <View style={[s.thumb, s.cmpEmpty]} />}
                  <Text style={s.thumbDate}>{fmtDate(p.date)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Text style={s.hint}>{t('タップで拡大、長押しで削除')}</Text>
        </>
      )}

      {err && (
        <View style={s.errBox}>
          <Text style={s.errT}>{err}</Text>
          <Pressable onPress={() => { setLoading(true); void load(); }} hitSlop={8} accessibilityRole="button">
            <Text style={s.retryT}>{t('もう一度読み込む')}</Text>
          </Pressable>
        </View>
      )}

      {/* 拡大ビューア（暗い幕の上なので文字とアイコンは固定の白） */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={s.viewerBack} onPress={() => setViewer(null)}>
          {viewer?.url && <Image source={{ uri: viewer.url }} style={s.viewerImg} resizeMode="contain" />}
          <View style={s.viewerBar}>
            <Text style={s.viewerT}>
              {viewer?.date.replace(/-/g, '/')}{viewer?.bodyfat != null ? `・${t('体脂肪')} ${fmtPct(viewer.bodyfat)}` : ''}
            </Text>
            <Pressable onPress={() => setViewer(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('閉じる')}>
              <X size={22} color="#fff" />
            </Pressable>
          </View>
          <Pressable style={s.viewerDel} onPress={() => { if (viewer) confirmDelete(viewer); }} hitSlop={8}
                     accessibilityRole="button" accessibilityLabel={t('削除する')}>
            <Trash2 size={ICON.md} color="#fff" strokeWidth={ICON.stroke} />
            <Text style={s.viewerDelT}>{t('削除する')}</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = themed(() => ({
  card: { backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline, borderRadius: RADIUS.card, shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2, padding: 16, marginBottom: 12 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  h2: { fontSize: 17, fontWeight: '800', color: C.ink },
  h2sub: { fontSize: 12, fontWeight: '700', color: C.faint },
  note: { fontSize: 13, color: C.sub, lineHeight: 19 },
  hint: { fontSize: 11, color: C.faint, marginTop: 8 },
  cmpLabel: { fontSize: 11, fontWeight: '700', color: C.sub, marginBottom: 4 },
  cmpImg: { width: '100%', aspectRatio: 3 / 4, borderRadius: RADIUS.tile, backgroundColor: C.bg },
  cmpEmpty: { borderWidth: 1, borderColor: C.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', padding: 8 },
  emptyT: { fontSize: 12, color: C.faint, textAlign: 'center' },
  cmpBf: {
    position: 'absolute', right: 6, bottom: 6, color: '#fff', fontSize: 13, fontWeight: '800',
    backgroundColor: 'rgba(10,14,12,0.55)', borderRadius: RADIUS.chip, paddingHorizontal: 7, paddingVertical: 2,
    overflow: 'hidden', fontVariant: ['tabular-nums'],
  },
  cmpBusy: { position: 'absolute', left: 0, right: 0, top: '45%' },
  diffT: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 8, fontVariant: ['tabular-nums'] },
  thumb: { width: 56, height: 74, borderRadius: RADIUS.input, backgroundColor: C.bg },
  thumbDate: { fontSize: 11, color: C.sub, textAlign: 'center', marginTop: 2 },
  errBox: { marginTop: 10, gap: 6 },
  errT: { fontSize: 13, fontWeight: '700', color: C.coral, lineHeight: 18 },
  retryT: { fontSize: 13, fontWeight: '800', color: C.accentInk },
  viewerBack: { flex: 1, backgroundColor: 'rgba(8,10,9,0.92)', justifyContent: 'center' },
  viewerImg: { width: '100%', height: '80%' },
  viewerBar: {
    position: 'absolute', top: 58, left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  viewerT: { color: '#fff', fontSize: 15, fontWeight: '800' },
  viewerDel: {
    position: 'absolute', bottom: 48, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.chip, backgroundColor: 'rgba(255,255,255,0.14)',
  },
  viewerDelT: { color: '#fff', fontSize: 14, fontWeight: '800' },
}));
