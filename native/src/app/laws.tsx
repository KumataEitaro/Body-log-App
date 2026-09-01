// あなたの法則（法則図鑑・B-6）
// 貯まった記録から見つかった「あなただけの法則」を1枚ずつのカードとして収集するページ。
//  ・新規発見は祝祭（実績ページのCelebrateOverlayと同じ流儀: スプリング＋触覚）
//  ・未発見はシルエットで見せて「まだ見つかっていない法則がある」という好奇心を残す
//  ・スタンダード未満（無料・ライト。課金ゲート有効時）は最新3枚だけ通常表示、4枚目以降は半透明＋王冠
//  ・分析は全て端末内ローカル（lib/laws.ts）。サーバへは何も送らない
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Modal, Animated as RNAnimated, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Share2, PartyPopper, Utensils, Salad, CalendarRange, Tornado, Moon, HeartPulse, Undo2, BookOpen } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { C, RADIUS, SPACE, ICON, HEAD } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { useGate } from '@/lib/gate';
import CrownBadge from '@/components/CrownBadge';
import ShareStickerModal, { type StickerData } from '@/components/ShareSticker';
import { refreshLaws, markLawsSeen, lawKindHint, LAW_KINDS, type Law, type LawKind } from '@/lib/laws';

// スタンダード未満（無料・ライト）で通常表示する枚数（最新から数える）。それ以降は王冠つきのぼかし表示
const FREE_VISIBLE = 3;

/** 種類ごとのアイコン（図鑑の「同じ種類のカード」を目で束ねる） */
function KindIcon({ kind, size = 18, color = C.teal }: { kind: LawKind; size?: number; color?: string }) {
  const p = { size, color } as const;
  switch (kind) {
    case 'food_up': return <Utensils {...p} />;
    case 'food_safe': return <Salad {...p} />;
    case 'weekday': return <CalendarRange {...p} />;
    case 'binge_trigger': return <Tornado {...p} />;
    case 'timeslot': return <Moon {...p} />;
    case 'recover': return <HeartPulse {...p} />;
    case 'comeback': return <Undo2 {...p} />;
  }
}

// 新規発見の祝祭オーバーレイ（achievements.tsxの流儀: スケールイン＋触覚で「事件」にする）
function CelebrateOverlay({ laws, onClose }: { laws: Law[]; onClose: () => void }) {
  const scale = useRef(new RNAnimated.Value(0.6)).current;
  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    RNAnimated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 120 }).start();
  }, [scale]);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.celebBack}>
        <RNAnimated.View style={[s.celebCard, { transform: [{ scale }] }]}>
          <View style={s.celebIcon}><PartyPopper size={30} color={C.teal} /></View>
          <Text style={s.celebT}>{t('新しい法則を発見！')}</Text>
          {laws.slice(0, 3).map((l) => (
            <View key={l.id} style={s.celebRow}>
              <KindIcon kind={l.kind} size={22} />
              <Text style={s.celebName}>{l.title}</Text>
            </View>
          ))}
          {laws.length > 3 && <Text style={s.celebMore}>{t('ほか{n}件', { n: laws.length - 3 })}</Text>}
          <Pressable style={s.celebCta} onPress={onClose}>
            <Text style={s.celebCtaT}>{t('図鑑を見る')}</Text>
          </Pressable>
        </RNAnimated.View>
      </View>
    </Modal>
  );
}

export default function LawsScreen() {
  const router = useRouter();
  const gate = useGate();
  const [laws, setLaws] = useState<Law[] | null>(null);   // null=読み込み中
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [celebrate, setCelebrate] = useState<Law[]>([]);
  const [sticker, setSticker] = useState<StickerData | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { all, fresh } = await refreshLaws();
        setLaws(all);
        if (fresh.length > 0) {
          setFreshIds(new Set(fresh.map((l) => l.id)));
          setCelebrate(fresh);
          // 祝祭は一度きり（表示した時点で消化。閉じ忘れてももう一度は祝わない）
          markLawsSeen(fresh.map((l) => l.id)).catch(() => {});
        }
      } catch { setLaws([]); }
    })();
  }, []);

  const found = laws ?? [];
  // 未発見の種類だけシルエットで見せる（種類のヒントは薄く）
  const missingKinds = LAW_KINDS.filter((k) => !found.some((l) => l.kind === k));
  const total = found.length + missingKinds.length;
  // 課金ゲート: gateが非activeなら全開放（現在の全機能無料運用と同じ見た目）
  const locked = gate.gated('laws');

  function openPaywall() {
    Haptics.selectionAsync().catch(() => {});
    // typed routesが動的srcを知らないためas never（changes.tsxと同じ流儀）
    router.push('/paywall?src=laws' as never);
  }

  function lawCard(l: Law, i: number) {
    const gated = locked && i >= FREE_VISIBLE;
    const body = (
      <View style={[s.card, gated && s.cardGated]}>
        <View style={s.cardHead}>
          <View style={s.kindBubble}><KindIcon kind={l.kind} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{l.title}</Text>
            <Text style={s.cardSub}>{l.sub}</Text>
          </View>
          {gated ? (
            <CrownBadge size={14} />
          ) : (
            <Pressable hitSlop={10} onPress={() => setSticker({ kind: 'law', title: l.title, sub: l.sub })}>
              <Share2 size={ICON.md} color={C.faint} />
            </Pressable>
          )}
        </View>
        <Text style={s.cardDate}>{t('{d} 発見', { d: l.foundAt.slice(5).replace('-', '/') })}</Text>
      </View>
    );
    if (gated) {
      // ぼかし表現: 伏せ字にはせず、半透明＋王冠＋一言で「開けば読める」ことを伝える
      return (
        <Pressable key={l.id} onPress={openPaywall}>
          {body}
          <Text style={s.gateHint}>{t('スタンダードで図鑑のすべてが開きます')}</Text>
        </Pressable>
      );
    }
    if (freshIds.has(l.id)) {
      return (
        <Animated.View key={l.id} entering={FadeInDown.duration(420)}>
          {body}
        </Animated.View>
      );
    }
    return <View key={l.id}>{body}</View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ headerShown: true, title: '', headerBackTitle: t('戻る'), headerTintColor: C.teal, headerShadowVisible: false, ...(Platform.OS === 'ios' ? { headerTransparent: true } : { headerStyle: { backgroundColor: C.bg } }) }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.scroll}>
        <View style={s.headRow}>
          <Text style={s.h}>{t('あなたの法則')}</Text>
          {laws != null && <Text style={s.progress}>{found.length}/{total}</Text>}
        </View>
        <Text style={s.lead}>{t('記録から見つかった、あなたの体の取扱説明書。すべてこの端末の中だけで分析しています。')}</Text>

        {laws == null ? (
          <ActivityIndicator color={C.teal} style={{ marginTop: 40 }} />
        ) : (
          <>
            {found.length === 0 && (
              <View style={s.emptyBox}>
                <BookOpen size={26} color={C.faint} />
                <Text style={s.emptyT}>{t('まだ法則は見つかっていません。記録が貯まるほど、ここが埋まっていきます。')}</Text>
              </View>
            )}
            {found.map((l, i) => lawCard(l, i))}

            {/* 未発見枠（シルエット）: 何があるかは言わず、種類のヒントだけ薄く見せる */}
            {missingKinds.length > 0 && (
              <>
                <Text style={s.silhouetteHead}>{t('まだ見つかっていない法則')}</Text>
                {missingKinds.map((k) => (
                  <View key={k} style={s.silhouette}>
                    <View style={s.silhouetteQ}><Text style={s.silhouetteQT}>？</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.silhouetteT}>{t('記録が貯まると見つかる法則')}</Text>
                      <Text style={s.silhouetteHint}>{lawKindHint(k)}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
      {celebrate.length > 0 && (
        <CelebrateOverlay laws={celebrate} onClose={() => setCelebrate([])} />
      )}
      <ShareStickerModal data={sticker} visible={sticker != null} onClose={() => setSticker(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: SPACE.screen, paddingTop: 8, paddingBottom: 48 },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 },
  h: { ...HEAD.page, color: C.ink },
  progress: { fontSize: 15, fontWeight: '800', color: C.teal, fontVariant: ['tabular-nums'] },
  lead: { fontSize: 12.5, color: C.sub, lineHeight: 18, marginBottom: 14 },
  emptyBox: { alignItems: 'center', gap: 8, backgroundColor: C.panel, borderRadius: RADIUS.card, padding: 22, marginBottom: 12 },
  emptyT: { fontSize: 13, color: C.sub, lineHeight: 19, textAlign: 'center' },
  card: {
    backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(14,17,22,0.08)',
    borderRadius: RADIUS.card, padding: SPACE.card, marginBottom: 10,
    shadowColor: '#0e1116', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  // ぼかし表現はカード全体の半透明で（内容を隠すのではなく「うっすら読める」お楽しみ側に倒す）
  cardGated: { opacity: 0.45, marginBottom: 2 },
  cardHead: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  kindBubble: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: C.ink, lineHeight: 21 },
  cardSub: { fontSize: 12, color: C.sub, marginTop: 3 },
  cardDate: { fontSize: 11, color: C.faint, marginTop: 8, fontVariant: ['tabular-nums'], textAlign: 'right' },
  gateHint: { fontSize: 11.5, fontWeight: '700', color: C.amber, textAlign: 'center', marginBottom: 10 },
  silhouetteHead: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 14, marginBottom: 8 },
  silhouette: {
    flexDirection: 'row', gap: 10, alignItems: 'center',
    backgroundColor: C.chipBg, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed',
    borderRadius: RADIUS.card, padding: SPACE.card, marginBottom: 8,
  },
  silhouetteQ: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.track, alignItems: 'center', justifyContent: 'center' },
  silhouetteQT: { fontSize: 16, fontWeight: '900', color: C.faint },
  silhouetteT: { fontSize: 13.5, fontWeight: '700', color: C.faint },
  silhouetteHint: { fontSize: 11.5, color: C.faint, marginTop: 2, opacity: 0.8 },
  // 祝祭（achievements.tsxと同じトーン）
  celebBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 28 },
  celebCard: { backgroundColor: C.panel, borderRadius: 22, padding: 22, alignItems: 'center' },
  celebIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  celebT: { fontSize: 18, fontWeight: '900', color: C.ink, marginTop: 4, marginBottom: 10 },
  celebRow: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', backgroundColor: C.accentSoft, borderRadius: RADIUS.tile, padding: 12, marginTop: 6 },
  celebName: { flex: 1, fontSize: 13.5, fontWeight: '800', color: C.ink, lineHeight: 19 },
  celebMore: { fontSize: 12, color: C.sub, marginTop: 8 },
  celebCta: { backgroundColor: C.teal, borderRadius: RADIUS.input, paddingVertical: 12, paddingHorizontal: 26, marginTop: 16, alignSelf: 'stretch', alignItems: 'center' },
  celebCtaT: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
