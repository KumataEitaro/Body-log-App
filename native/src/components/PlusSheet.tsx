// ＋ボタンのボトムシート（2026-09-02・Appleヘルスケア式「何を記録するか → どう入力するか」）
//
// 1段目: 「食事」「運動」「体の写真」「体重」の4タイル（2×2）
// 2段目: 食事 → 入力方法「マイ食品」「テキストで入力」「写真を選ぶ」「撮影する」の4タイル
//         体重 → シート内で数値を入れて保存（画面を移らずに済ませる）
//         運動・体の写真 → シートを閉じて既存の画面へ（運動タブの「運動を記録する」シート／概要の体写真カメラ）
//
// 【設計判断】
// - バーコード読み取りは**置かない**。食品データベースを持っておらず（Open Food Facts に日本の
//   商品はほぼ無い）、選ばせても失敗体験にしかならないため（熊田さん指示 2026-09-02）
// - 段の移動はシートの中で行い、Modalは1枚のまま。上部に「1/2」「2/2」のステップ表示と
//   前の選択（「食事 ›」）を出し、‹ で戻れる。閉じるは × とスワイプダウン
// - 「テキスト／写真／マイ食品」を選んだあとは pageSheet の入力シート（食事タブ側）が開く。
//   iOSは表示中のModalの兄弟に別のModalを出せないため、**このシートが閉じ切ってから**
//   onAction を呼ぶ（onDismiss＝iOS／閉じアニメ後のタイマー＝Android。二重発火はrefで防ぐ）
// - タイルは C.panel の面・RADIUS.card の角丸・押下でアクセント縁＋わずかに縮む。
//   アイコンはアクセント色の薄い円の上に載せ、ラベルは 15px/800
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  UtensilsCrossed, Activity, Camera, Weight, X, ChevronLeft, Salad, Pencil, Images, Sparkles,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, RADIUS, SPACE, ICON, themed } from '@/lib/ui';
import { OptionButton } from '@/components/ui/Selectable';
import { t } from '@/lib/i18n';

/** シートから外へ出す行動。'meal:*' は食事タブの入力シートを開く（'meal:whattoeat' は「何を食べる？」シート） */
export type PlusAction = 'meal:myfood' | 'meal:text' | 'meal:library' | 'meal:camera' | 'meal:whattoeat' | 'exercise' | 'bodyphoto';
export type PlusStep = 'root' | 'meal' | 'weight';

export default function PlusSheet({ visible, onClose, onAction, onSaveWeight, weightUnit, weightPlaceholder }: {
  visible: boolean;
  onClose: () => void;
  /** タイルを選んだとき。シートが閉じ切ってから呼ばれる */
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

  function pick(a: PlusAction) {
    Haptics.selectionAsync().catch(() => {});
    pending.current = a;
    onClose();
  }
  function go(next: PlusStep) {
    Haptics.selectionAsync().catch(() => {});
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

  const crumb = step === 'meal' ? t('食事') : step === 'weight' ? t('体重') : t('記録する');
  const stepLabel = step === 'root' ? '1/2' : '2/2';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={flush} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={t('閉じる')} />
        <GestureDetector gesture={pan}>
          <Animated.View style={[s.sheet, { paddingBottom: insets.bottom + 16 }, slide]}>
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
                <Text style={s.step}>{stepLabel}</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={10} style={s.headBtn} accessibilityRole="button" accessibilityLabel={t('閉じる')}>
                <X size={ICON.lg} color={C.sub} strokeWidth={ICON.stroke} />
              </Pressable>
            </View>

            {step === 'root' && (
              <View style={s.grid}>
                <Tile Icon={UtensilsCrossed} label={t('食事')} onPress={() => go('meal')} testID="plus-meal" />
                {/* 運動は「歩いた・泳いだ」も含む一般の運動（運動タブの「運動を記録する」へ）。ダンベルだと筋トレ限定に見えるので Activity */}
                <Tile Icon={Activity} label={t('運動')} onPress={() => pick('exercise')} testID="plus-exercise" />
                <Tile Icon={Camera} label={t('体の写真')} onPress={() => pick('bodyphoto')} testID="plus-bodyphoto" />
                <Tile Icon={Weight} label={t('体重')} onPress={() => go('weight')} testID="plus-weight" />
                {/* 5枚目「何を食べる？」（食事タブ内のAI相談）: ＋を押す習慣に乗せる第2の入口。
                    記録ではなく相談なので2×2の外に横長1枚で置き、記録4種と混ぜない */}
                <Tile Icon={Sparkles} label={t('何を食べる？')} onPress={() => pick('meal:whattoeat')} testID="plus-whattoeat" wide />
              </View>
            )}

            {step === 'meal' && (
              <View style={s.grid}>
                <Tile Icon={Salad} label={t('マイ食品')} onPress={() => pick('meal:myfood')} testID="plus-meal-myfood" />
                <Tile Icon={Pencil} label={t('テキストで入力')} onPress={() => pick('meal:text')} testID="plus-meal-text" />
                <Tile Icon={Images} label={t('写真を選ぶ')} onPress={() => pick('meal:library')} testID="plus-meal-library" />
                <Tile Icon={Camera} label={t('撮影する')} onPress={() => pick('meal:camera')} testID="plus-meal-camera" />
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
    </Modal>
  );
}

/** 大きな選択タイル（2×2グリッドの1枡）。wide=横長1枚（アイコンとラベルを横並び） */
function Tile({ Icon, label, onPress, testID, wide }: { Icon: LucideIcon; label: string; onPress: () => void; testID?: string; wide?: boolean }) {
  return (
    <Pressable
      testID={testID} accessibilityRole="button" accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.tile, wide && s.tileWide, pressed && s.tilePressed]}
    >
      <View style={[s.tileIcon, wide && s.tileIconWide]}>
        <Icon size={wide ? ICON.lg : ICON.hero} color={C.accentInk} strokeWidth={ICON.stroke} />
      </View>
      <Text style={s.tileT} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
    </Pressable>
  );
}

const s = themed(() => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,18,32,0.38)' },   // Navy由来の暗幕（生HEXは面/地以外に書かない規約の例外: 透過幕）
  sheet: {
    backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: SPACE.screen, paddingTop: 8,
    shadowColor: C.shadow, shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: -4 }, elevation: 12,
  },
  grip: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  headBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  crumb: { fontSize: 17, fontWeight: '800', color: C.ink },
  crumbPrev: { color: C.sub, fontWeight: '700' },
  step: { fontSize: 11, fontWeight: '700', color: C.faint, marginTop: 1, fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    width: '47.5%', flexGrow: 1, aspectRatio: 1.35,
    backgroundColor: C.panel, borderRadius: RADIUS.card, borderWidth: 1.5, borderColor: C.hairline,
    alignItems: 'center', justifyContent: 'center', gap: 10,
    shadowColor: C.shadow, shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1,
  },
  tilePressed: { borderColor: C.teal, backgroundColor: C.accentSoft, transform: [{ scale: 0.97 }] },
  // 横長1枚（「何を食べる？」）: 2×2の正方形タイルより低く、アイコンとラベルを横並びに
  tileWide: { width: '100%', aspectRatio: undefined, flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 18, justifyContent: 'flex-start', gap: 12 },
  tileIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.accentBadge, alignItems: 'center', justifyContent: 'center' },
  tileIconWide: { width: 40, height: 40, borderRadius: 20 },
  tileT: { fontSize: 15, fontWeight: '800', color: C.ink },
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
