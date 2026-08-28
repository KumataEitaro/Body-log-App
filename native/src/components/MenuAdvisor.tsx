// 外食メニューおすすめ（B-11）: メニュー表の写真＋今日の残量＋目的から
// 「この中ならどれを選ぶべきか」をAIが答える事前意思決定支援。
//
// 記録（食べたあと）ではなく注文前の相談なので、結果はトレイに直接積まず、
// 「これにする」で入力欄に品名を充填して既存のAI解析経路（送信→トレイ→✓保存）へ
// 合流させる。勝手に確定しないのは既存のステージング哲学（本人の✓で確定）と同じ。
import { useState } from 'react';
import { View, Text, Modal, ScrollView, StyleSheet, Alert, Pressable, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { UtensilsCrossed } from 'lucide-react-native';
import DockIconButton from '@/components/DockIconButton';
import { OptionButton } from '@/components/ui/Selectable';
import { apiPost } from '@/lib/api';
import { t, apiLang } from '@/lib/i18n';
import { getPurpose } from '@/lib/purpose';
import { C } from '@/lib/ui';

type Pick = { name: string; estKcal: number; reason: string };
type AdviceResult = { picks: Pick[]; note: string };

export default function MenuAdvisor({ remainingKcal, pRemain, onPick }: {
  /** 今日の残りkcal（食事タブのヒーローと同じ計算値） */
  remainingKcal: number;
  /** たんぱく質の残りg（未計算ならnull） */
  pRemain: number | null;
  /** 「これにする」で品名を受け取る（入力欄への充填は呼び出し側の責務） */
  onPick: (name: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdviceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 入口: 既存の写真ソース選択の流儀（カメラ/ライブラリの2択シート）
  function start() {
    Alert.alert(t('メニューからおすすめ 🍽'), t('メニュー表を撮ると、今日の残りと目的に合う一品をAIが選びます。'), [
      { text: t('カメラで撮る'), onPress: () => pickAndAsk(true) },
      { text: t('ライブラリから選ぶ'), onPress: () => pickAndAsk(false) },
      { text: t('キャンセル'), style: 'cancel' },
    ]);
  }

  async function pickAndAsk(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('写真の許可が必要です（設定アプリ→BodyLog）。'));
      return;
    }
    // quality:1は端末最大解像度のままデコードでメモリを食うため下げる（既存の写真経路と同じ）
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], selectionLimit: 1, quality: 0.8 });
    if (res.canceled || !res.assets?.[0]?.uri) return;

    // 結果シートを先に開いてローディングを見せる（無反応に見せない）
    setVisible(true); setLoading(true); setResult(null); setError(null);
    try {
      // 既存流儀と同じ最大辺1280px・JPEG圧縮でAPIへ
      const small = await manipulateAsync(res.assets[0].uri, [{ resize: { width: 1280 } }],
        { compress: 0.72, format: SaveFormat.JPEG, base64: true });
      if (!small.base64) throw new Error('no-base64');
      const { ok, json } = await apiPost<{ ok: boolean; error?: string; result?: AdviceResult }>(
        '/api/menu-advice', {
          image: small.base64,
          remainingKcal: Math.round(remainingKcal),
          purposeKey: getPurpose(),
          pRemain: pRemain != null ? Math.round(pRemain) : null,
          lang: apiLang(),
        });
      if (!ok || !json?.ok || !json.result) {
        // サーバーが理由を返したらそれを、返せない失敗は非審判の定型文で
        setError(json?.error || t('うまく読めませんでした。明るいところでもう一度お試しください。'));
        return;
      }
      setResult(json.result);
    } catch {
      setError(t('うまく読めませんでした。明るいところでもう一度お試しください。'));
    } finally {
      setLoading(false);
    }
  }

  function choose(name: string) {
    setVisible(false);
    onPick(name);
  }

  return (
    <>
      <DockIconButton Icon={UtensilsCrossed} onPress={start} />
      {/* 結果シート。RNのModalは描画ツリー上の位置に関係なく最前面に出るが、
          iOSのpageSheetは他のModalの内側（入れ子）では正しく出せない。
          このコンポーネントごと通常View（食事タブのドック）に置き、
          MyFoodForm等の既存Modalとは同時に開かない導線にしている */}
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVisible(false)}>
        <View style={s.wrap}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <UtensilsCrossed size={18} color={C.teal} />
            <Text style={s.title}>{t('メニューからおすすめ 🍽')}</Text>
          </View>
          <Text style={s.note}>
            {t('今日の残り {n}kcal と目的に合わせて選びました。', { n: Math.round(remainingKcal).toLocaleString() })}
          </Text>

          {loading && (
            <View style={s.loadingBox}>
              <ActivityIndicator size="large" color={C.teal} />
              <Text style={s.loadingT}>{t('メニューを読んでいます…')}</Text>
            </View>
          )}

          {error != null && !loading && (
            <View style={s.loadingBox}>
              <Text style={s.errT}>{error}</Text>
            </View>
          )}

          {result != null && !loading && (
            <ScrollView style={{ marginTop: 12 }}>
              {result.picks.length === 0 && (
                <Text style={s.errT}>{result.note || t('メニューを読み取れませんでした。品名が写るように撮ってみてください。')}</Text>
              )}
              {result.picks.map((p, i) => (
                <View key={`${p.name}-${i}`} style={[s.pickCard, i === 0 && s.pickCardBest]}>
                  {i === 0 && <Text style={s.bestBadge}>{t('いちばんのおすすめ')}</Text>}
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Text style={s.pickName}>{p.name}</Text>
                    {p.estKcal > 0 && <Text style={s.pickKcal}>{t('約{n}kcal', { n: p.estKcal.toLocaleString() })}</Text>}
                  </View>
                  {!!p.reason && <Text style={s.pickReason}>{p.reason}</Text>}
                  <OptionButton
                    style={{ marginTop: 10 }} variant={i === 0 ? 'teal' : 'tonal'}
                    label={t('これにする → 記録')} onPress={() => choose(p.name)}
                  />
                </View>
              ))}
              {result.picks.length > 0 && !!result.note && <Text style={s.footNote}>{result.note}</Text>}
              <Text style={s.footNote}>{t('「これにする」を押すと入力欄に品名が入ります。食べたら↑送信で記録できます。')}</Text>
              <View style={{ height: 24 }} />
            </ScrollView>
          )}

          <OptionButton style={{ marginTop: 10, marginBottom: 10 }} variant="tonal" label={t('とじる')} onPress={() => setVisible(false)} />
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: 18 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  note: { fontSize: 13, color: C.sub, marginTop: 6, lineHeight: 18 },
  loadingBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 12 },
  loadingT: { fontSize: 15, fontWeight: '700', color: C.sub },
  errT: { fontSize: 15, color: C.sub, lineHeight: 22, textAlign: 'center', paddingHorizontal: 8 },
  pickCard: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16,
    padding: 14, marginBottom: 10,
  },
  // 先頭＝一番のおすすめだけアクセント枠で一段強調する
  pickCardBest: { borderColor: C.accentBorder, borderWidth: 1.5, backgroundColor: C.accentSoft },
  bestBadge: {
    alignSelf: 'flex-start', fontSize: 11, fontWeight: '800', color: C.teal,
    backgroundColor: C.accentBadge, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6,
  },
  pickName: { flexShrink: 1, fontSize: 17, fontWeight: '800', color: C.ink },
  pickKcal: { fontSize: 13, fontWeight: '700', color: C.sub, fontVariant: ['tabular-nums'] },
  pickReason: { fontSize: 13, color: C.sub, lineHeight: 19, marginTop: 6 },
  footNote: { fontSize: 12, color: C.faint, lineHeight: 17, marginTop: 4, marginBottom: 6 },
});
