// オンボーディングの価値カルーセル（3枚）。
// 2026年の知見: オンボーディングは「短くする」より「価値を体感させながら深くする」方が
// 転換率・継続率が高い（マイクロコミットメント効果）。ここでバリュープロポジションの
// L1（つぶやき入力）・L3（あなたの法則）・L4（失敗の日に優しい）を先に見せてから設定に入る。
// アニメーションはスプリング物理＋時差入場。視差効果を減らす設定では静止する。
import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Dimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, FadeInDown,
} from 'react-native-reanimated';
import { MessageCircle, Camera, Flame, Sparkles } from 'lucide-react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { useReduceMotion } from '@/lib/motion';
import MoodFace from '@/components/MoodFace';

const W = Dimensions.get('window').width;

// ゆっくり浮遊するラッパー（スライドの主役ビジュアルに生命感を与える）
function Float({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const reduce = useReduceMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    y.value = withRepeat(withTiming(-8, { duration: 1800 + delay }), -1, true);
  }, [reduce, y, delay]);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={st}>{children}</Animated.View>;
}

// スライド1: つぶやき入力（チャット風の吹き出し＋結果チップ）
function VisualTalk() {
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <Float>
        <View style={v.bubbleUser}><Text style={v.bubbleUserT}>{t('親子丼と味噌汁たべた')}</Text></View>
      </Float>
      <Float delay={300}>
        <View style={v.bubbleAi}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Sparkles size={13} color={C.teal} />
            <Text style={v.bubbleAiLabel}>{t('AIが数えました')}</Text>
          </View>
          <Text style={v.bubbleAiT}>親子丼 720kcal ・ P38 F21 C89</Text>
        </View>
      </Float>
      <Float delay={600}>
        <View style={v.iconRow}>
          <View style={v.iconChip}><MessageCircle size={15} color={C.teal} /></View>
          <View style={v.iconChip}><Camera size={15} color={C.teal} /></View>
        </View>
      </Float>
    </View>
  );
}

// スライド2: あなたの法則（ミニ折れ線＋発見カード）
function VisualLaw() {
  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      <Float>
        <Svg width={200} height={80} viewBox="0 0 200 80">
          <Path d="M8 22 C 50 30, 80 62, 120 54 S 180 40, 192 46"
                stroke={C.teal} strokeWidth={3} fill="none" strokeLinecap="round" />
          <Circle cx={192} cy={46} r={5} fill={C.teal} />
          <Circle cx={192} cy={46} r={10} fill={C.teal} opacity={0.2} />
        </Svg>
      </Float>
      <Float delay={400}>
        <View style={v.lawCard}>
          <Text style={v.lawT}>{t('あなたは「前日に食べなさすぎた日」の翌日に食べすぎやすい')}</Text>
          <Text style={v.lawSub}>{t('― あなたの記録28日ぶんから')}</Text>
        </View>
      </Float>
    </View>
  );
}

// スライド3: 失敗の日に優しい（お守り＋にっこりフェイス）
function VisualKind() {
  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      <Float>
        <View style={v.flameWrap}>
          <Flame size={34} color={C.teal} fill={C.teal} />
          <Text style={v.flameN}>21</Text>
        </View>
      </Float>
      <Float delay={350}>
        <View style={v.kindCard}>
          <MoodFace level={4} size={26} />
          <Text style={v.kindT}>{t('1日忘れても、お守りがつなぎます')}</Text>
        </View>
      </Float>
    </View>
  );
}

const SLIDES = () => [
  { key: 'talk', visual: <VisualTalk />, title: t('記録は、つぶやきでいい。'), sub: t('「親子丼たべた」と書くだけ。写真を撮るだけ。カロリーとPFCはAIが数えます。') },
  { key: 'law', visual: <VisualLaw />, title: t('あなたの体の、取扱説明書ができていく。'), sub: t('食べすぎの引き金、体に合う食材、崩れやすい曜日。続けるほど「あなただけの法則」が見えてきます。') },
  { key: 'kind', visual: <VisualKind />, title: t('続かなかった日に、いちばん優しい。'), sub: t('責めるアプリは続きません。忘れた日はお守りがつなぎ、食べすぎた朝は取り戻し方を教えます。') },
];

export default function OnboardingIntro({ onDone }: { onDone: () => void }) {
  const [page, setPage] = useState(0);
  const slides = SLIDES();

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const p = Math.round(e.nativeEvent.contentOffset.x / W);
          if (p !== page) { setPage(p); Haptics.selectionAsync().catch(() => {}); }
        }}>
        {slides.map((sl, i) => (
          <View key={sl.key} style={[v.slide, { width: W }]}>
            <Animated.View entering={FadeInDown.duration(400).delay(80)} style={{ minHeight: 190, justifyContent: 'center' }}>
              {sl.visual}
            </Animated.View>
            <Animated.View entering={FadeInDown.duration(400).delay(200)}>
              <Text style={v.title}>{sl.title}</Text>
            </Animated.View>
            <Animated.View entering={FadeInDown.duration(400).delay(320)}>
              <Text style={v.sub}>{sl.sub}</Text>
            </Animated.View>
            {i === slides.length - 1 && (
              <Animated.View entering={FadeInDown.duration(400).delay(440)}>
                <Pressable style={({ pressed }) => [v.cta, pressed && { transform: [{ scale: 0.97 }] }]}
                           onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); onDone(); }}>
                  <Text style={v.ctaT}>{t('自分用にセットアップする（1分）')}</Text>
                </Pressable>
              </Animated.View>
            )}
          </View>
        ))}
      </ScrollView>
      {/* ページドット（現在ページは横に伸びる） */}
      <View style={v.dots}>
        {slides.map((_, i) => (
          <View key={i} style={[v.dot, page === i && v.dotOn]} />
        ))}
      </View>
      <Pressable onPress={onDone} hitSlop={10} style={v.skip}>
        <Text style={v.skipT}>{t('スキップ')}</Text>
      </Pressable>
    </View>
  );
}

const v = themed(() => ({
  slide: { flex: 1, paddingHorizontal: 32, justifyContent: 'center', paddingBottom: 90 },
  title: { fontSize: 24, fontWeight: '900', color: C.ink, marginTop: 26, lineHeight: 33 },
  sub: { fontSize: 14.5, color: C.sub, marginTop: 10, lineHeight: 23 },
  cta: { backgroundColor: C.teal, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
  ctaT: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  dots: { position: 'absolute', bottom: 46, alignSelf: 'center', flexDirection: 'row', gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.line },
  dotOn: { width: 24, backgroundColor: C.teal },
  skip: { position: 'absolute', top: 8, right: 20 },
  skipT: { fontSize: 13, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  bubbleUser: { backgroundColor: C.ink, borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 16, paddingVertical: 10, alignSelf: 'flex-end' },
  bubbleUserT: { color: C.panel, fontSize: 14.5, fontWeight: '600' },  // ink地（ダーク=明色）に追従
  bubbleAi: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 18, borderTopLeftRadius: 4, paddingHorizontal: 16, paddingVertical: 12, alignSelf: 'flex-start' },
  bubbleAiLabel: { fontSize: 11, fontWeight: '800', color: C.teal, letterSpacing: 0.5 },
  bubbleAiT: { fontSize: 13.5, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  iconRow: { flexDirection: 'row', gap: 8 },
  iconChip: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder, alignItems: 'center', justifyContent: 'center' },
  lawCard: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16, maxWidth: 300 },
  lawT: { fontSize: 14, fontWeight: '800', color: C.ink, lineHeight: 21 },
  lawSub: { fontSize: 11.5, color: C.sub, marginTop: 6 },
  flameWrap: { width: 84, height: 84, borderRadius: 42, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  flameN: { position: 'absolute', bottom: 14, fontSize: 13, fontWeight: '900', color: C.ink },
  kindCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
  kindT: { fontSize: 13.5, fontWeight: '700', color: C.ink },
}));
