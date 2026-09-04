// ＋ボタンのボトムシート（2026-09-04・「食事だけ大きいカード＋残りはリスト行」へ再設計）
//
// 構成: 食事＝高さ84の大カード（使用頻度が圧倒的に高い主導線）／運動・体の写真・体重＝高さ56のリスト行／
//       区切り線を挟んで「何を食べる？」（記録ではなく相談なので性質で分ける）
// 体重だけシート内でもう1段（数値を入れて保存。画面を移らずに済ませる）。
// 運動・体の写真はシートを閉じて既存の画面へ（運動タブの「運動を記録する」シート／概要の体写真カメラ）
//
// 【なぜ2×2グリッドをやめたか（熊田さん判断 2026-09-04）】
// 大きなカードを2×2に並べる形は「アプリランチャー風グリッド」で、2つの構造的な弱点がある。
//   ① アイコンとラベルを**縦に積む**ため縦中央の計算が要る。新アーキ(Fabric)×iOS の lineHeight 問題や
//      adjustsFontSizeToFit と併せると文字が下に寄る事故が起きた（react-native#53092 / #52642 / #42044）
//   ② 枡を正方形に近づけるため**余白を作る宿命**があり、情報量に対して背が高くなる
// リスト行は**アイコンとラベルが横並び**なので縦ずれが構造的に起きず、行の高さ＝内容の高さで余白が生まれない。
// iOS 2026 の「何かを追加する」場面の主流でもある（Appleヘルスケアの「データを追加」等）。
// そのため以下は禁止: lineHeight の指定・adjustsFontSizeToFit の使用・アイコンとラベルの縦積み
//
// 【設計判断（継続）】
// - バーコード読み取りは**置かない**。食品データベースを持っておらず（Open Food Facts に日本の
//   商品はほぼ無い）、選ばせても失敗体験にしかならないため（熊田さん指示 2026-09-02）
// - 「食事を記録」を選んだあとは pageSheet の入力シート（食事タブ側）が開く。
//   iOSは表示中のModalの兄弟に別のModalを出せないため、**このシートが閉じ切ってから**
//   onAction を呼ぶ（onDismiss＝iOS／閉じアニメ後のタイマー＝Android。二重発火はrefで防ぐ）
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  Utensils, Dumbbell, PersonStanding, Scale, Sparkles, X, ChevronLeft, ChevronRight, CalendarPlus,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, RADIUS, SPACE, ICON, themed } from '@/lib/ui';
import { OptionButton } from '@/components/ui/Selectable';
import { t } from '@/lib/i18n';

/** 段ごとのアイコンを**1箇所**に集約する（差し替えが1行で済むように）。
 *  タブバーは SF Symbols（食事 fork.knife／運動 figure.strengthtraining.traditional）だが、
 *  シートは Lucide で Android と同一の絵にしつつ**概念をタブに合わせる**:
 *    食事         Utensils       交差(UtensilsCrossed)ではなく平行＝タブの fork.knife に近い
 *    運動         Dumbbell       タブは「筋トレする人」。旧 Activity（心拍の波線）は運動に見えなかった
 *    体の写真     PersonStanding カメラは食事撮影で既に使っており、同じ絵に別の意味を持たせない
 *    体重         Scale          体重計として読みやすい（旧 Weight は分銅で伝わらない）
 *    何を食べる？ Sparkles       アプリ内でAIを表す共通記号（維持） */
const ROW_ICON: Record<'meal' | 'exercise' | 'bodyphoto' | 'weight' | 'whattoeat' | 'plan', LucideIcon> = {
  meal: Utensils,
  exercise: Dumbbell,
  bodyphoto: PersonStanding,
  weight: Scale,
  whattoeat: Sparkles,
  plan: CalendarPlus,
};

/** シートから外へ出す行動。'meal:*' は食事タブの入力シートを開く（'meal:whattoeat' は「何を食べる？」シート） */
export type PlusAction = 'meal:myfood' | 'meal:text' | 'meal:library' | 'meal:camera' | 'meal:whattoeat' | 'exercise' | 'bodyphoto' | 'plan';
export type PlusStep = 'root' | 'meal' | 'weight';

export default function PlusSheet({ visible, onClose, onAction, onSaveWeight, weightUnit, weightPlaceholder }: {
  visible: boolean;
  onClose: () => void;
  /** 行を選んだとき。シートが閉じ切ってから呼ばれる */
  onAction: (a: PlusAction) => void;
  /** 体重（表示単位の文字列）を保存する。null=成功（シートを閉じる）／''=本人が取り消した（何も出さない）／文字列=エラー文 */
  onSaveWeight: (text: string) => Promise<string | null>;
  weightUnit: string;
  weightPlaceholder: string;
}) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<PlusStep>('root');
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pending = useRef<PlusAction | null>(null);

  // 開くたびに1段目から（前回の途中状態を引き継がない）
  useEffect(() => {
    if (visible) { setStep('root'); setWeight(''); setBusy(false); setErr(null); ty.value = 0; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 閉じ切ってから行動を渡す（iOS: onDismiss／Android: onDismissが無いので閉じアニメ後）
  function flush() {
    const a = pending.current;
    pending.current = null;
    if (a) onAction(a);
  }
  useEffect(() => {
    if (visible || !pending.current) return;
    const h = setTimeout(flush, Platform.OS === 'ios' ? 700 : 350);   // iOSはonDismissが先に拾う（保険）
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // selection は iOS でほとんど感じない。行を押した手応えは impact Light で返す（熊田さん 2026-09-04）
  function pick(a: PlusAction) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    pending.current = a;
    onClose();
  }
  function go(next: PlusStep) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setStep(next);
  }
  async function saveWeight() {
    if (!weight.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await onSaveWeight(weight.trim());
      if (r === null) onClose();       // 成功
      else if (r) setErr(r);           // エラー文はシートの中に出す（画面の裏に出しても見えない）
    } finally { setBusy(false); }
  }

  // スワイプダウンで閉じる（グリップ〜ヘッダーを含むシート全体に付ける）
  const ty = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetY(10)
    .onUpdate((e) => { ty.value = Math.max(0, e.translationY); })
    .onEnd((e) => {
      if (e.translationY > 90 || e.velocityY > 900) runOnJS(onClose)();
      else ty.value = withSpring(0, { damping: 30, stiffness: 320, overshootClamping: true });
    });
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));

  const crumb = step === 'weight' ? t('体重') : t('記録する');
  // 「記録する」の下に段があるのは体重だけ（食事は直行になった）。1段のときは段表示を出さない
  const stepLabel = step === 'root' ? null : '2/2';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={flush} statusBarTranslucent>
      {/* KAV は**体重の段だけ**に効かせる（数値入力でキーボードが出るのはここだけ）。
          根の段まで包むと、キーボードが無いのにシート下へ見えない余白が残り、
          「記録方法を選ぶだけ」のシートが不必要に背高くなる（βフィードバック 2026-09-03） */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' && step === 'weight' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={t('閉じる')} />
        <GestureDetector gesture={pan}>
          <Animated.View style={[s.sheet, { paddingBottom: insets.bottom + 10 }, slide]}>
            <View style={s.grip} />
            <View style={s.head}>
              {step !== 'root' ? (
                <Pressable onPress={() => go('root')} hitSlop={10} style={s.headBtn} accessibilityRole="button" accessibilityLabel={t('戻る')}>
                  <ChevronLeft size={ICON.lg} color={C.ink} strokeWidth={ICON.stroke} />
                </Pressable>
              ) : <View style={s.headBtn} />}
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={s.crumb} numberOfLines={1}>
                  {step === 'root' ? crumb : <><Text style={s.crumbPrev}>{t('記録する')} › </Text>{crumb}</>}
                </Text>
                {stepLabel && <Text style={s.step}>{stepLabel}</Text>}
              </View>
              <Pressable onPress={onClose} hitSlop={10} style={s.headBtn} accessibilityRole="button" accessibilityLabel={t('閉じる')}>
                <X size={ICON.lg} color={C.sub} strokeWidth={ICON.stroke} />
              </Pressable>
            </View>

            {step === 'root' && (
              <View>
                {/* 食事だけ大きなカード（高さ84）。＋を押す理由の大半が食事の記録なので、
                    他の4つと同格に並べず主導線として一段大きく見せる。
                    食事は2段目を挟まず**テキスト入力へ直行**（βフィードバック 2026-09-03:
                    「食事と入力したら、食事入力をすぐやりたい」）。入力シートにはマイ食品チップ・
                    写真/撮影アイコン・音声ヒントが既に載っており、入力方法の選択画面は二重の階層だった */}
                <MealCard onPress={() => pick('meal:text')} />

                {/* 残りの記録はリスト行（高さ56・行間6）。運動は「歩いた・泳いだ」も含む一般の運動 */}
                <View style={s.rows}>
                  <Row icon="exercise" label={t('運動')} onPress={() => pick('exercise')} testID="plus-exercise" />
                  <Row icon="bodyphoto" label={t('体の写真')} onPress={() => pick('bodyphoto')} testID="plus-bodyphoto" />
                  <Row icon="weight" label={t('体重')} onPress={() => go('weight')} testID="plus-weight" />
                </View>

                {/* 区切り線: 上（起きたことを記録する）と下（これからのことを決める）を性質で分ける。
                    ＋を押す習慣に乗せる第2の入口だが、記録ではないので記録4種と混ぜない */}
                <View style={s.divider} />
                <View style={s.rows}>
                  <Row icon="whattoeat" label={t('あとのカロリーで何を食べる？')} onPress={() => pick('meal:whattoeat')} testID="plus-whattoeat" />
                  {/* 先の予定（飲み会・チートデイ）。「明日 飲み会がある」と気づくのは記録中か
                      予定を思い出したときで、設定画面を開いている時ではない。従来は設定の奥（4タップ以上）
                      にしか入口が無く、当日には間に合わなかった */}
                  <Row icon="plan" label={t('先の予定を入れる')} onPress={() => pick('plan')} testID="plus-plan" />
                </View>
              </View>
            )}

            {step === 'weight' && (
              <View style={s.weightBox}>
                <View style={s.wRow}>
                  <TextInput
                    style={s.wInput} placeholder={weightPlaceholder} placeholderTextColor={C.faint}
                    keyboardType="decimal-pad" value={weight} onChangeText={setWeight} autoFocus
                    returnKeyType="done" onSubmitEditing={saveWeight} maxFontSizeMultiplier={1.3}
                  />
                  <Text style={s.wUnit}>{weightUnit}</Text>
                </View>
                <OptionButton variant="teal" label={t('体重を記録')} onPress={saveWeight} busy={busy} disabled={!weight.trim()} />
                {err
                  ? <Text style={s.wErr}>{err}</Text>
                  : <Text style={s.wHint}>{t('前回から大きく違う値は、保存の前に確認します。')}</Text>}
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** 食事の大カード（高さ84）。アイコン48ptの角丸＋ラベル17/800を**横並び**で置く */
function MealCard({ onPress }: { onPress: () => void }) {
  const Icon = ROW_ICON.meal;
  const label = t('食事を記録');
  return (
    <Pressable
      testID="plus-meal" accessibilityRole="button" accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.mealCard, pressed && s.pressedFace]}
    >
      <View style={s.mealIcon}>
        <Icon size={ICON.hero} color={C.accentInk} strokeWidth={ICON.stroke} />
      </View>
      <Text style={s.mealT} numberOfLines={1} maxFontSizeMultiplier={1.3}>{label}</Text>
    </Pressable>
  );
}

/** リスト行（高さ56＝タップ領域44pt以上）。アイコン40ptの角丸・ラベル16/700・右端にシェブロン。
 *  アイコンとラベルは必ず**横並び**（縦積みをやめた理由はファイル冒頭のコメント） */
function Row({ icon, label, onPress, testID }: { icon: keyof typeof ROW_ICON; label: string; onPress: () => void; testID?: string }) {
  const Icon = ROW_ICON[icon];
  return (
    <Pressable
      testID={testID} accessibilityRole="button" accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.pressedFace]}
    >
      <View style={s.rowIcon}>
        <Icon size={ICON.md} color={C.accentInk} strokeWidth={ICON.stroke} />
      </View>
      <Text style={s.rowT} numberOfLines={1} maxFontSizeMultiplier={1.3}>{label}</Text>
      <ChevronRight size={ICON.md} color={C.faint} strokeWidth={ICON.stroke} />
    </Pressable>
  );
}

const s = themed(() => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,18,32,0.38)' },   // Navy由来の暗幕（生HEXは面/地以外に書かない規約の例外: 透過幕）
  sheet: {
    backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: SPACE.screen, paddingTop: 6,
    shadowColor: C.shadow, shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: -4 }, elevation: 12,
  },
  grip: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  headBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  crumb: { fontSize: 17, fontWeight: '800', color: C.ink },
  crumbPrev: { color: C.sub, fontWeight: '700' },
  step: { fontSize: 11, fontWeight: '700', color: C.faint, marginTop: 1, fontVariant: ['tabular-nums'] },

  // 食事の大カード: 高さ84・アイコン48＋ラベル17/800を横並び（縦中央の計算が要らない）
  mealCard: {
    height: 76, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18,
    backgroundColor: C.panel, borderRadius: RADIUS.card, borderWidth: 1.5, borderColor: C.hairline,
    shadowColor: C.shadow, shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1,
  },
  mealIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.accentBadge, alignItems: 'center', justifyContent: 'center' },
  // lineHeight は指定しない: 新アーキ(Fabric)×iOS では lineHeight があるとベースラインが
  // 尊重されず、文字が中央より下へずれる（react-native#53092。adjustsFontSizeToFit との
  // 併用でも位置ずれの報告あり #52642 / #42044）。横並びなので折り返しも不要＝1行で足りる
  mealT: { flex: 1, fontSize: 17, fontWeight: '800', color: C.ink, includeFontPadding: false },

  // リスト行: 高さ56（タップ領域44pt以上）・行間6
  rows: { marginTop: 10, gap: 6 },
  row: {
    height: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12,
    backgroundColor: C.panel, borderRadius: RADIUS.panel, borderWidth: 1, borderColor: C.hairline,
  },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accentBadge, alignItems: 'center', justifyContent: 'center' },
  rowT: { flex: 1, fontSize: 16, fontWeight: '700', color: C.ink, includeFontPadding: false },
  // 押下は面をアクセントのごく薄い色に変えるだけ（縮小や縁の変化は行では過剰）
  pressedFace: { backgroundColor: C.accentSoft, borderColor: C.teal },
  // 記録（上）と相談（下）を分ける1pxライン。上下12ptの余白で「別のかたまり」に見せる
  divider: { height: 1, backgroundColor: C.hairline, marginTop: 10, marginBottom: 10 },

  weightBox: { gap: 12, paddingTop: 4 },
  wRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  wInput: {
    width: 140, backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.input,
    paddingVertical: 12, paddingHorizontal: 14, fontSize: 26, fontWeight: '800', color: C.ink, textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  wUnit: { fontSize: 17, fontWeight: '700', color: C.sub },
  wHint: { fontSize: 12, color: C.faint, textAlign: 'center' },
  wErr: { fontSize: 13, fontWeight: '700', color: C.coral, textAlign: 'center' },
}));
