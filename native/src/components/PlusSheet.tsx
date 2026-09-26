// ＋ボタンのボトムシート（2026-09-26・「親指が届く高さ」へ圧縮）
//
// 構成（1段目は5項目だけ）:
//   食事を記録        高さ76の大カード（使用頻度が圧倒的に高い主導線・入力シートへ直行）
//   身体を記録        → 2段目で 体重／ウエスト／体脂肪率（AIで推定）を選ぶ
//   先の予定を入れる  食事タブの EventPlanSheet（飲み会・チートデイ）
//   目標設定          設定画面の目標シート（/settings?open=goal）へ
//   AIに相談          相談タブへ切り替え
//
// 2026-09-26 熊田さん「項目が多すぎる。右手でスマホを持ったとき親指が届く高さ（プルアップの大きさ）に収めたい」。
//   9行あった旧構成（運動・筋トレ・体重・ウエスト・体脂肪率・区切り線・マイ食品を登録・何を食べる？・先の予定）から
//   「運動」「筋トレ」（入口は運動タブの2枚のタイル）、「マイ食品を登録」（入口は食事の入力シート「マイ食品を追加」）、
//   「あとのカロリーで何を食べる？」（入口は食事タブのヒーロー）を外し、体の3つは「身体を記録」1行にまとめた。
//   シートの高さ: 486pt → 約 390pt（＋insets.bottom）。5行＋見出しが画面の下半分に収まる。
// 2026-09-10: このシートは食事タブ専用ではない。4タブ全部の右下＋（components/PlusEntry.tsx）から開き、
//       行動の振り分け（その場で処理／食事タブへ遷移して同じシートを開く／設定・相談タブへ）は PlusEntry が持つ。
// 体重・ウエストはシート内でもう1段（数値を入れて保存。画面を移らずに済ませる）。
// 体脂肪率はシートを閉じてから BodyFatSheet（写真から AI 推定・写真は保存しない）へ。
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
  Utensils, Scale, Sparkles, X, ChevronLeft, ChevronRight, CalendarPlus, Ruler, Percent, PersonStanding, Target,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, RADIUS, SPACE, ICON, themed } from '@/lib/ui';
import { OptionButton } from '@/components/ui/Selectable';
import { t } from '@/lib/i18n';
import { useThemeRefresh } from '@/lib/theme';

/** 段ごとのアイコンを**1箇所**に集約する（差し替えが1行で済むように）。
 *  タブバーは SF Symbols（食事 fork.knife／運動 figure.strengthtraining.traditional）だが、
 *  シートは Lucide で Android と同一の絵にしつつ**概念をタブに合わせる**:
 *    食事         Utensils       交差(UtensilsCrossed)ではなく平行＝タブの fork.knife に近い
 *    身体を記録   PersonStanding 「体の数値」の入口。中の3つ（体重・ウエスト・体脂肪率）とは別の絵にして階層を見せる
 *    体重         Scale          体重計として読みやすい（旧 Weight は分銅で伝わらない）
 *    ウエスト     Ruler          巻き尺。体重と並べたときに「測る」が伝わる（2026-09-18）
 *    体脂肪率     Percent        AI 推定の結果は % の数値だけを残す（写真は保存しない・2026-09-18）
 *    先の予定     CalendarPlus   カレンダーに足す
 *    目標設定     Target         概要タブの「目標設定」行（changes.tsx）と同じ絵
 *    AIに相談     Sparkles       アプリ内でAIを表す共通記号 */
const ROW_ICON: Record<'meal' | 'body' | 'weight' | 'waist' | 'bodyfat' | 'plan' | 'goal' | 'coach', LucideIcon> = {
  meal: Utensils,
  body: PersonStanding,
  weight: Scale,
  waist: Ruler,
  bodyfat: Percent,
  plan: CalendarPlus,
  goal: Target,
  coach: Sparkles,
};

/** シートから外へ出す行動。'meal:*' は食事タブの入力シートを開く（シートから選べるのは 'meal:text' だけ。
 *  残りは /log?open=… のディープリンク用に残す）。'goal' は設定画面の目標シート、'coach' は相談タブへ。
 *  'myfood:add' はマイ食品の登録シート（components/AddFoodSheet.tsx）。2026-09-26 からシートの行ではなく、
 *  食事タブの入力シート「マイ食品を追加」が同じ経路を使う（PlusEntry の共通処理は残す） */
export type PlusAction = 'meal:myfood' | 'meal:text' | 'meal:library' | 'meal:camera' | 'bodyfat' | 'plan' | 'goal' | 'coach' | 'myfood:add';
/** シート内の段。'body' は 体重／ウエスト／体脂肪率 を選ぶ段。'weight' と 'waist' は同じ見た目（数字＋単位＋保存） */
export type PlusStep = 'root' | 'body' | 'weight' | 'waist';
/** シート内で保存する体の数値の種類 */
export type MeasureKind = 'weight' | 'waist';

export default function PlusSheet({
  visible, onClose, onAction, onSaveWeight, weightUnit, weightPlaceholder, onSaveWaist, waistUnit = 'cm', waistPlaceholder = '—', initialStep,
}: {
  visible: boolean;
  onClose: () => void;
  /** 行を選んだとき。シートが閉じ切ってから呼ばれる */
  onAction: (a: PlusAction) => void;
  /** 体重（表示単位の文字列）を保存する。null=成功（シートを閉じる）／''=本人が取り消した（何も出さない）／文字列=エラー文 */
  onSaveWeight: (text: string) => Promise<string | null>;
  weightUnit: string;
  weightPlaceholder: string;
  /** ウエスト（表示単位の文字列）を保存する。契約は onSaveWeight と同じ（2026-09-18） */
  onSaveWaist?: (text: string) => Promise<string | null>;
  waistUnit?: string;
  waistPlaceholder?: string;
  /** 開いた瞬間に出す段（スタートチェックリストの「体重を1回記録する」→ 体重の段へ直行） */
  initialStep?: MeasureKind;
}) {
  useThemeRefresh();   // 壁（ThemeRemount）の外に出る Modal を持つので、自分でテーマを購読する（2026-09-17）
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<PlusStep>('root');
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pending = useRef<PlusAction | null>(null);

  // 開くたびに1段目から（前回の途中状態を引き継がない）
  useEffect(() => {
    if (visible) {
      setStep(initialStep ?? 'root'); setWeight(''); setBusy(false); setErr(null); ty.value = 0;
      // 前回の「閉じ切ってから渡す予定の行動」を捨てる（2026-09-15・Android 監査）。
      // Android には Modal の onDismiss が無いので 350ms のタイマーが唯一の経路。
      // 閉じてすぐ（350ms以内）に開き直すと cleanup でタイマーだけ消えて pending が残り、
      // **何も選ばずに閉じたのに、あとから選んでいない画面が勝手に開く**。
      pending.current = null;
    }
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
  // 数値の段（体重／ウエスト）の保存。どちらも「数字を入れて保存」で、違うのは保存先と単位だけ
  const measure: MeasureKind | null = step === 'weight' || step === 'waist' ? step : null;
  async function saveMeasure() {
    if (!weight.trim() || busy || !measure) return;
    const save = measure === 'waist' ? onSaveWaist : onSaveWeight;
    if (!save) return;
    setBusy(true); setErr(null);
    try {
      const r = await save(weight.trim());
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

  // パンくず: 記録する › 身体を記録 › 体重。数値の段の「戻る」は身体の段へ（1段目まで戻さない）
  const back: PlusStep = measure ? 'body' : 'root';
  const crumb = step === 'weight' ? t('体重') : step === 'waist' ? t('ウエスト') : step === 'body' ? t('身体を記録') : t('記録する');
  const crumbPrev = step === 'root' ? null
    : step === 'body' ? `${t('記録する')} › `
    : `${t('記録する')} › ${t('身体を記録')} › `;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={flush} statusBarTranslucent>
      {/* KAV は**数値の段だけ**に効かせる（数値入力でキーボードが出るのはここだけ）。
          根の段まで包むと、キーボードが無いのにシート下へ見えない余白が残り、
          「記録方法を選ぶだけ」のシートが不必要に背高くなる（βフィードバック 2026-09-03） */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' && measure ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={t('閉じる')} />
        <GestureDetector gesture={pan}>
          <Animated.View style={[s.sheet, { paddingBottom: insets.bottom + 10 }, slide]}>
            <View style={s.grip} />
            <View style={s.head}>
              {step !== 'root' ? (
                <Pressable onPress={() => go(back)} hitSlop={10} style={s.headBtn} accessibilityRole="button" accessibilityLabel={t('戻る')}>
                  <ChevronLeft size={ICON.lg} color={C.ink} strokeWidth={ICON.stroke} />
                </Pressable>
              ) : <View style={s.headBtn} />}
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={s.crumb} numberOfLines={1}>
                  {crumbPrev != null && <Text style={s.crumbPrev}>{crumbPrev}</Text>}{crumb}
                </Text>
              </View>
              <Pressable onPress={onClose} hitSlop={10} style={s.headBtn} accessibilityRole="button" accessibilityLabel={t('閉じる')}>
                <X size={ICON.lg} color={C.sub} strokeWidth={ICON.stroke} />
              </Pressable>
            </View>

            {step === 'root' && (
              <View>
                {/* 食事だけ大きなカード（高さ76）。＋を押す理由の大半が食事の記録なので、
                    他の4つと同格に並べず主導線として一段大きく見せる。
                    食事は2段目を挟まず**テキスト入力へ直行**（βフィードバック 2026-09-03:
                    「食事と入力したら、食事入力をすぐやりたい」）。入力シートにはマイ食品チップ・
                    写真/撮影アイコンが既に載っており、入力方法の選択画面は二重の階層だった */}
                <MealCard onPress={() => pick('meal:text')} />

                {/* 残りはリスト行（高さ52・行間6）。4行で親指の届く高さに収める（2026-09-26） */}
                <View style={s.rows}>
                  {/* 体の数値は3つとも「身体を記録」の下へ（体重・ウエストはシート内保存、体脂肪率は BodyFatSheet） */}
                  <Row icon="body" label={t('身体を記録')} sub={t('体重・ウエスト・体脂肪率')} onPress={() => go('body')} testID="plus-body" />
                  {/* 先の予定（飲み会・チートデイ）。「明日 飲み会がある」と気づくのは記録中か
                      予定を思い出したときで、設定画面を開いている時ではない */}
                  <Row icon="plan" label={t('先の予定を入れる')} onPress={() => pick('plan')} testID="plus-plan" />
                  {/* 目標設定は設定画面の目標シートへ飛ぶ（/settings?open=goal）。＋を押す習慣に乗せる入口 */}
                  <Row icon="goal" label={t('目標設定')} sub={t('カロリー目標・体重目標')} onPress={() => pick('goal')} testID="plus-goal" />
                  {/* AIに相談は相談タブへ切り替えるだけ（旧「あとのカロリーで何を食べる？」の代わりに汎用の入口） */}
                  <Row icon="coach" label={t('AIに相談')} onPress={() => pick('coach')} testID="plus-coach" />
                </View>
              </View>
            )}

            {step === 'body' && (
              <View style={s.rows}>
                <Row icon="weight" label={t('体重')} onPress={() => go('weight')} testID="plus-weight" />
                <Row icon="waist" label={t('ウエスト')} onPress={() => go('waist')} testID="plus-waist" />
                {/* 体脂肪率は写真から AI が推定するので別シート（BodyFatSheet）へ。閉じ切ってから開く */}
                <Row icon="bodyfat" label={t('体脂肪率（AIで推定）')} onPress={() => pick('bodyfat')} testID="plus-bodyfat" />
              </View>
            )}

            {measure && (
              <View style={s.weightBox}>
                <View style={s.wRow}>
                  <TextInput
                    style={s.wInput} placeholder={measure === 'waist' ? waistPlaceholder : weightPlaceholder} placeholderTextColor={C.faint}
                    keyboardType="decimal-pad" value={weight} onChangeText={setWeight} autoFocus
                    returnKeyType="done" onSubmitEditing={saveMeasure} maxFontSizeMultiplier={1.3}
                    accessibilityLabel={measure === 'waist' ? t('ウエスト') : t('体重')}
                  />
                  <Text style={s.wUnit}>{measure === 'waist' ? waistUnit : weightUnit}</Text>
                </View>
                <OptionButton variant="teal" label={measure === 'waist' ? t('ウエストを記録') : t('体重を記録')} onPress={saveMeasure} busy={busy} disabled={!weight.trim()} />
                {err
                  ? <Text style={s.wErr}>{err}</Text>
                  : <Text style={s.wHint}>{measure === 'waist'
                      ? t('おへその高さで、息を吐いたところで測ります。')
                      : t('前回から大きく違う値は、保存の前に確認します。')}</Text>}
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** 食事の大カード（高さ76）。アイコン48ptの角丸＋ラベル17/800を**横並び**で置く */
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

/** リスト行（高さ52＝タップ領域44pt以上）。アイコン40ptの角丸・ラベル16/700・右端にシェブロン。
 *  sub を渡すとラベルの下に 11/600 の補足（「体重・ウエスト・体脂肪率」）。行の高さは変えない。
 *  アイコンとラベルは必ず**横並び**（縦積みをやめた理由はファイル冒頭のコメント） */
function Row({ icon, label, sub, onPress, testID }: { icon: keyof typeof ROW_ICON; label: string; sub?: string; onPress: () => void; testID?: string }) {
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
      <View style={s.rowTexts}>
        <Text style={s.rowT} numberOfLines={1} maxFontSizeMultiplier={1.3}>{label}</Text>
        {sub != null && <Text style={s.rowSub} numberOfLines={1} maxFontSizeMultiplier={1.2}>{sub}</Text>}
      </View>
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
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  headBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  crumb: { fontSize: 17, fontWeight: '800', color: C.ink },
  crumbPrev: { color: C.sub, fontWeight: '700' },

  // 食事の大カード: 高さ76・アイコン48＋ラベル17/800を横並び（縦中央の計算が要らない）
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

  // リスト行: 高さ52（タップ領域44pt以上）・行間6
  rows: { marginTop: 8, gap: 6 },
  row: {
    height: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12,
    backgroundColor: C.panel, borderRadius: RADIUS.panel, borderWidth: 1, borderColor: C.hairline,
  },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accentBadge, alignItems: 'center', justifyContent: 'center' },
  rowTexts: { flex: 1 },
  rowT: { fontSize: 16, fontWeight: '700', color: C.ink, includeFontPadding: false },
  rowSub: { fontSize: 11, fontWeight: '600', color: C.faint, includeFontPadding: false, marginTop: 1 },
  // 押下は面をアクセントのごく薄い色に変えるだけ（縮小や縁の変化は行では過剰）
  pressedFace: { backgroundColor: C.accentSoft, borderColor: C.teal },

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
