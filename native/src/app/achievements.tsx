// 実績ページ: 🔥ストリーク（お守りつき）＋バッジ一覧＋「いつでもストーリー共有」ハブ。
// バッジは獲得済み=カラー、未獲得=グレー＋条件文（次に何をすればいいか常に見える）。
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Modal, Animated as RNAnimated, Easing, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { Share2, Flame, PartyPopper } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { evaluateAchievements, type AchievementReport, type BadgeState } from '@/lib/achievements';
import ShareStickerModal, { type StickerData } from '@/components/ShareSticker';
import BadgeIcon from '@/components/BadgeIcon';

// 新規獲得の祝祭オーバーレイ（スケールイン＋触覚。獲得の瞬間を「事件」にする）
function CelebrateOverlay({ badges, onShare, onClose }: { badges: BadgeState[]; onShare: (b: BadgeState) => void; onClose: () => void }) {
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
          <Text style={s.celebT}>{t('新しいバッジを獲得！')}</Text>
          {badges.map((b) => (
            <View key={b.id} style={s.celebRow}>
              <BadgeIcon id={b.id} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={s.celebName}>{b.name}</Text>
                <Text style={s.celebDesc}>{b.desc}</Text>
              </View>
            </View>
          ))}
          <Pressable style={s.celebCta} onPress={() => onShare(badges[0])}>
            <Text style={s.celebCtaT}>{t('ストーリーに自慢する')}</Text>
          </Pressable>
          <Pressable onPress={onClose} hitSlop={8} style={{ marginTop: 10 }}>
            <Text style={s.celebClose}>{t('とじる')}</Text>
          </Pressable>
        </RNAnimated.View>
      </View>
    </Modal>
  );
}

const CAT_LABEL = (): Record<BadgeState['cat'], string> => ({
  streak: t('継続'), action: t('行動'), result: t('成果'),
});

export default function AchievementsScreen() {
  const [report, setReport] = useState<AchievementReport | null>(null);
  const [sticker, setSticker] = useState<StickerData | null>(null);
  const [celebrate, setCelebrate] = useState<BadgeState[]>([]);

  useEffect(() => {
    evaluateAchievements().then((r) => {
      setReport(r);
      if (r.newIds.length > 0) setCelebrate(r.badges.filter((b) => r.newIds.includes(b.id)));
    }).catch(() => setReport(null));
  }, []);

  const earned = report?.badges.filter((b) => b.earnedOn != null) ?? [];

  // 「いつでも共有」の選択肢（データがあるものだけ出す）
  const shareOptions: { key: string; label: string; data: StickerData | null }[] = report ? [
    { key: 'streak', label: t('🔥 ストリーク'), data: report.streak > 0 ? { kind: 'streak', days: report.streak } : null },
    { key: 'today', label: t('🍽 今日の食事'), data: report.share.today ? { kind: 'today', left: 0, ...report.share.today } : null },
    { key: 'workout', label: t('🏃 最新の運動'), data: report.share.workout ? { kind: 'workout', ...report.share.workout } : null },
    { key: 'pr', label: t('🏆 自己ベスト'), data: report.share.pr ? { kind: 'pr', ...report.share.pr } : null },
  ] : [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ headerShown: true, title: '', headerBackTitle: t('戻る'), headerTintColor: C.teal, headerShadowVisible: false, ...(Platform.OS === 'ios' ? { headerTransparent: true } : { headerStyle: { backgroundColor: C.bg } }) }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.scroll}>
        <Text style={s.h}>{t('実績')}</Text>

        {report == null ? (
          <ActivityIndicator color={C.teal} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* ストリークのヒーロー */}
            <View style={s.hero}>
              <View style={s.heroFlame}><Flame size={30} color={C.teal} fill={C.teal} /></View>
              {/* ストリークの大数字は文字サイズ拡大で崩れやすいため上限1.3 */}
              <Text style={s.heroN} maxFontSizeMultiplier={1.3}>{report.streak}<Text style={s.heroU}>{t('日連続')}</Text></Text>
              <Text style={s.heroSub}>
                {report.usedFreeze
                  ? t('お守りが{d}の抜けをつなぎました（週1回まで自動）', { d: report.usedFreeze.slice(5).replace('-', '/') })
                  : t('1日抜けても、週1回まで「お守り」が自動でつなぎます')}
              </Text>
            </View>

            {/* 今週（ソフト週目標）: 週◯日でOKの自己契約。「毎日」以外の成功を
                目に見える形にして、1日欠けた瞬間の全崩壊を防ぐ */}
            <View style={s.weekCard}>
              <View style={s.weekHead}>
                <Text style={s.weekT}>{t('今週 {n}/{m}日', { n: report.week.count, m: report.week.goal })}</Text>
                {report.week.count >= report.week.goal && <PartyPopper size={16} color={C.teal} />}
              </View>
              <View style={s.weekDots}>
                {report.week.days.map((on, i) => (
                  // 記録日=teal塗り・未来=枠のみ（まだ失敗ではない）・過去の未記録=薄地
                  <View key={i} style={[s.weekDot, on ? s.weekDotOn : i > report.week.todayIdx ? s.weekDotFuture : s.weekDotOff]} />
                ))}
              </View>
              {report.week.count >= report.week.goal
                ? <Text style={s.weekDone}>{t('今週の約束は守れました 🎉')}</Text>
                : <Text style={s.weekSub}>{t('自分で決めたペースを守れたら、それは成功です。')}</Text>}
            </View>

            {/* いつでも共有ハブ */}
            <View style={s.shareCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Share2 size={15} color={C.teal} />
                <Text style={s.shareT}>{t('ストーリー用ステッカーを作る')}</Text>
              </View>
              <Text style={s.shareSub}>{t('文字だけの透過画像。自分の写真の上に重ねて、いつでも共有できます。')}</Text>
              <View style={s.shareRow}>
                {shareOptions.map((o) => (
                  <Pressable key={o.key} disabled={o.data == null}
                    style={[s.shareBtn, o.data == null && { opacity: 0.35 }]}
                    onPress={() => o.data && setSticker(o.data)}>
                    <Text style={s.shareBtnT}>{o.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* バッジ一覧（カテゴリごと） */}
            <Text style={s.count}>{t('{n} / {m} 個 獲得', { n: earned.length, m: report.badges.length })}</Text>
            {(['streak', 'action', 'result'] as const).map((cat) => (
              <View key={cat}>
                <Text style={s.catT}>{CAT_LABEL()[cat]}</Text>
                <View style={s.grid}>
                  {report.badges.filter((b) => b.cat === cat).map((b) => {
                    const on = b.earnedOn != null;
                    return (
                      <View key={b.id} style={[s.badge, !on && s.badgeOff]}>
                        <BadgeIcon id={b.id} size={40} dim={!on} />
                        <Text style={[s.badgeN, !on && { color: C.faint }]} numberOfLines={1}>{b.name}</Text>
                        <Text style={s.badgeD} numberOfLines={2}>
                          {on ? t('{d} 獲得', { d: b.earnedOn!.slice(5).replace('-', '/') }) : b.desc}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
      {celebrate.length > 0 && (
        <CelebrateOverlay
          badges={celebrate}
          onShare={(b) => { setCelebrate([]); setSticker({ kind: 'badge', id: b.id, name: b.name }); }}
          onClose={() => setCelebrate([])}
        />
      )}
      <ShareStickerModal data={sticker} visible={sticker != null} onClose={() => setSticker(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 8, paddingBottom: 48 },
  h: { fontSize: 26, fontWeight: '800', color: C.ink, marginBottom: 12 },
  hero: { alignItems: 'center', backgroundColor: C.panel, borderRadius: 18, paddingVertical: 20, marginBottom: 12 },
  heroN: { fontSize: 42, fontWeight: '900', color: C.ink, fontVariant: ['tabular-nums'] },
  heroU: { fontSize: 15, fontWeight: '700', color: C.sub },
  heroSub: { fontSize: 12, color: C.sub, marginTop: 4, paddingHorizontal: 20, textAlign: 'center' },
  // 今週（ソフト週目標）
  weekCard: { backgroundColor: C.panel, borderRadius: 16, padding: 14, marginBottom: 12 },
  weekHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  weekT: { fontSize: 14.5, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  weekDots: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  weekDot: { width: 14, height: 14, borderRadius: 7 },
  weekDotOn: { backgroundColor: C.teal },
  weekDotFuture: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: C.line },
  weekDotOff: { backgroundColor: C.chipBg, borderWidth: 1, borderColor: C.line },
  weekDone: { fontSize: 12.5, fontWeight: '700', color: C.teal },
  weekSub: { fontSize: 12, color: C.sub },
  shareCard: { backgroundColor: C.panel, borderRadius: 16, padding: 14, marginBottom: 16 },
  shareT: { fontSize: 14.5, fontWeight: '800', color: C.ink },
  shareSub: { fontSize: 12, color: C.sub, marginBottom: 10, lineHeight: 17 },
  shareRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shareBtn: { backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  shareBtnT: { fontSize: 13, fontWeight: '700', color: C.teal },
  count: { fontSize: 12.5, fontWeight: '700', color: C.sub, marginBottom: 4 },
  catT: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 14, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { width: '31%', backgroundColor: C.panel, borderRadius: 14, padding: 10, alignItems: 'center', minHeight: 108 },
  badgeOff: { backgroundColor: C.chipBg },
  badgeN: { fontSize: 12, fontWeight: '800', color: C.ink, marginTop: 4 },
  badgeD: { fontSize: 10, color: C.sub, textAlign: 'center', marginTop: 2, lineHeight: 13 },
  heroFlame: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  celebIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  celebBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 28 },
  celebCard: { backgroundColor: C.panel, borderRadius: 22, padding: 22, alignItems: 'center' },
  celebT: { fontSize: 18, fontWeight: '900', color: C.ink, marginTop: 4, marginBottom: 10 },
  celebRow: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', backgroundColor: C.accentSoft, borderRadius: 14, padding: 12, marginTop: 6 },
  celebName: { fontSize: 15, fontWeight: '800', color: C.ink },
  celebDesc: { fontSize: 11.5, color: C.sub, marginTop: 1 },
  celebCta: { backgroundColor: C.teal, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 26, marginTop: 16, alignSelf: 'stretch', alignItems: 'center' },
  celebCtaT: { fontSize: 15, fontWeight: '800', color: '#fff' },
  celebClose: { fontSize: 13, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
});
