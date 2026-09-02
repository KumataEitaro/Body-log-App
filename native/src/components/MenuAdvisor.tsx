// 外食メニューおすすめ（B-11）: メニュー表の写真＋今日の残量＋目的から
// 「この中ならどれを選ぶべきか」をAIが答える事前意思決定支援。
//
// 記録（食べたあと）ではなく注文前の相談なので、結果はトレイに直接積まず、
// 「これにする」で入力欄に品名を充填して既存のAI解析経路（送信→トレイ→✓保存）へ
// 合流させる。勝手に確定しないのは既存のステージング哲学（本人の✓で確定）と同じ。
import { useMemo, useState } from 'react';
import { View, Text, Modal, ScrollView, Alert, Pressable, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { UtensilsCrossed } from 'lucide-react-native';
import DockIconButton from '@/components/DockIconButton';
import { OptionButton } from '@/components/ui/Selectable';
import { useRouter } from 'expo-router';
import { apiPost } from '@/lib/api';
import { t, apiLang } from '@/lib/i18n';
import { getPurpose } from '@/lib/purpose';
import { C, rgba, sheetTopPad, themed } from '@/lib/ui';
// 食事の制約（B-18・docs/DIET-MODES.md §5）: 候補は**消さない**。
// 消すと「安全な物だけ出た」と誤解させるため、印をつけて順位を下げるだけにする
import { useDiet, isDietOff } from '@/lib/diet';
import { mergeAlerts, rulesFor, type DietLevel } from '@/lib/dietCheck';
import { DietEstimateNote, DietSilenceNote } from '@/components/DietNotes';
import { useGate } from '@/lib/gate';

type Pick = { name: string; estKcal: number; reason: string; dietFlag?: DietLevel };
type AdviceResult = { picks: Pick[]; note: string };

export default function MenuAdvisor({ remainingKcal, pRemain, onPick }: {
  /** 今日の残りkcal（食事タブのヒーローと同じ計算値） */
  remainingKcal: number;
  /** たんぱく質の残りg（未計算ならnull） */
  pRemain: number | null;
  /** 「これにする」で品名を受け取る（入力欄への充填は呼び出し側の責務） */
  onPick: (name: string) => void;
}) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdviceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false); // 429 plan_limit（写真枠に相乗り）のときだけ導線を出す

  // ===== 食事の制約（B-18） =====
  // 端末内の辞書判定（無料でも動く）とAIのdietFlag（スタンダード以上）を合成し、
  // 該当した候補は**残したまま**印をつけて後ろへ回す（推薦から外さない・§5）
  const diet = useDiet();
  const gate = useGate();
  const dietPremium = !gate.gated('diet');
  const dietOn = !isDietOff(diet);
  const picks = useMemo(() => {
    const list = result?.picks ?? [];
    if (list.length === 0 || !dietOn) return list;
    const rules = rulesFor(diet.modes);
    const aiFlags: Record<string, DietLevel> = {};
    for (const p of list) if (p.dietFlag) aiFlags[p.name] = p.dietFlag;
    const alerts = mergeAlerts({
      items: list.map((p) => ({ name: p.name })), rules, aiFlags, premium: dietPremium,
    });
    const level = new Map<string, DietLevel>();
    for (const a of alerts) if (level.get(a.name) !== 'high') level.set(a.name, a.level);
    const rank = (p: Pick) => {
      const lv = level.get(p.name);
      return lv === 'high' ? 2 : lv === 'maybe' ? 1 : 0;
    };
    // 元の並び（AIの自信順）を保ったまま、該当の可能性があるものだけ後ろへ（安定ソート）
    return list
      .map((p, i) => ({ p: { ...p, dietFlag: level.get(p.name) }, i }))
      .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
      .map((x) => x.p);
  }, [result, diet, dietOn, dietPremium]);

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
    setVisible(true); setLoading(true); setResult(null); setError(null); setUpgrade(false);
    try {
      // 既存流儀と同じ最大辺1280px・JPEG圧縮でAPIへ
      const small = await manipulateAsync(res.assets[0].uri, [{ resize: { width: 1280 } }],
        { compress: 0.72, format: SaveFormat.JPEG, base64: true });
      if (!small.base64) throw new Error('no-base64');
      const { ok, json } = await apiPost<{ ok: boolean; error?: string; code?: string; result?: AdviceResult }>(
        '/api/menu-advice', {
          image: small.base64,
          remainingKcal: Math.round(remainingKcal),
          purposeKey: getPurpose(),
          pRemain: pRemain != null ? Math.round(pRemain) : null,
          lang: apiLang(),
        });
      if (!ok || !json?.ok || !json.result) {
        // サーバーが理由を返したらそれを、返せない失敗は非審判の定型文で。
        // プラン上限（429 plan_limit・写真枠に相乗り）はアップグレード導線も出す
        setError(json?.error || t('うまく読めませんでした。明るいところでもう一度お試しください。'));
        setUpgrade(json?.code === 'plan_limit');
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
              {/* 上限到達 → シートを閉じてから文脈ペイウォールへ（このAPIは写真枠に相乗りなのでlimit_photo） */}
              {upgrade && (
                <Pressable hitSlop={8} style={({ pressed }) => [{ marginTop: 10 }, pressed && { opacity: 0.7 }]}
                           onPress={() => { setVisible(false); router.push('/paywall?src=limit_photo' as never); }}>
                  <Text style={{ color: C.teal, fontWeight: '700', fontSize: 14 }}>{t('プランを見る →')}</Text>
                </Pressable>
              )}
            </View>
          )}

          {result != null && !loading && (
            <ScrollView style={{ marginTop: 12 }}>
              {picks.length === 0 && (
                <Text style={s.errT}>{result.note || t('メニューを読み取れませんでした。品名が写るように撮ってみてください。')}</Text>
              )}
              {picks.map((p, i) => {
                // 該当の可能性がある候補は「いちばんのおすすめ」にしない（推す形にしない）。
                // ただしカードは消さない＝「安全な物だけ出た」と誤解させないため
                const flagged = p.dietFlag != null;
                const best = i === 0 && !flagged;
                return (
                <View key={`${p.name}-${i}`} style={[s.pickCard, best && s.pickCardBest,
                                                     p.dietFlag === 'high' && s.pickCardHigh,
                                                     p.dietFlag === 'maybe' && s.pickCardMaybe]}>
                  {best && <Text style={s.bestBadge}>{t('いちばんのおすすめ')}</Text>}
                  {flagged && (
                    <Text style={[s.dietBadge, p.dietFlag === 'high' ? s.dietBadgeHigh : s.dietBadgeMaybe]}>
                      {t('⚠️ 対象の可能性')}
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Text style={s.pickName}>{p.name}</Text>
                    {p.estKcal > 0 && <Text style={s.pickKcal}>{t('約{n}kcal', { n: p.estKcal.toLocaleString() })}</Text>}
                  </View>
                  {!!p.reason && <Text style={s.pickReason}>{p.reason}</Text>}
                  <OptionButton
                    style={{ marginTop: 10 }} variant={best ? 'teal' : 'tonal'}
                    label={t('これにする → 記録')} onPress={() => choose(p.name)}
                  />
                </View>
                );
              })}
              {/* 制約を設定している人には、印の有無にかかわらず免責と常設表記を出す（§6-3 / §6-4） */}
              {dietOn && picks.length > 0 && (
                <View style={{ marginBottom: 4 }}>
                  <DietEstimateNote onDetail={() => { setVisible(false); router.push('/settings?open=diet' as never); }} />
                  <DietSilenceNote />
                </View>
              )}
              {picks.length > 0 && !!result.note && <Text style={s.footNote}>{result.note}</Text>}
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

const s = themed(() => ({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: sheetTopPad(18) },
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
  // 食事の制約（B-18・§5）: 縁だけ変えてカードは残す。塗りつぶして「食べるな」と見せない
  pickCardHigh: { borderColor: C.coral },
  pickCardMaybe: { borderColor: C.amber },
  dietBadge: {
    alignSelf: 'flex-start', fontSize: 11, fontWeight: '800',
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6,
  },
  dietBadgeHigh: { color: C.coral, backgroundColor: C.coralWeak },
  dietBadgeMaybe: { color: C.amber, backgroundColor: rgba(C.amber, 0.14) },
  bestBadge: {
    alignSelf: 'flex-start', fontSize: 11, fontWeight: '800', color: C.teal,
    backgroundColor: C.accentBadge, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6,
  },
  pickName: { flexShrink: 1, fontSize: 17, fontWeight: '800', color: C.ink },
  pickKcal: { fontSize: 13, fontWeight: '700', color: C.sub, fontVariant: ['tabular-nums'] },
  pickReason: { fontSize: 13, color: C.sub, lineHeight: 19, marginTop: 6 },
  footNote: { fontSize: 12, color: C.faint, lineHeight: 17, marginTop: 4, marginBottom: 6 },
}));
