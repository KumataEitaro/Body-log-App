// 実績ページ: 🔥ストリーク（お守りつき）＋バッジ一覧＋「いつでもストーリー共有」ハブ。
// バッジはメダル（BadgeIcon）で見せる。獲得済み=カテゴリ色の金属円盤＋獲得日、
// 未獲得=無彩色のシルエット＋条件文（次に何をすればいいかと「集める余地」が常に見える）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Modal, Animated as RNAnimated, Easing, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { Share2, Flame, PartyPopper, UserPlus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { useReduceMotion } from '@/lib/motion';
import { evaluateAchievements, markBadgesSeen, type AchievementReport, type BadgeCat, type BadgeState } from '@/lib/achievements';
import { maybeAskReview } from '@/lib/reviewPrompt';
import { shareInvite } from '@/lib/invite';
import ShareStickerModal, { type StickerData } from '@/components/ShareSticker';
import BadgeIcon from '@/components/BadgeIcon';

// 祝祭オーバーレイの表示時間。記録の流れを止めないよう、黙っていても自動で引く
const CELEBRATE_MS = 2600;

// 新規獲得の祝祭オーバーレイ。
// メダルが回りながら飛び込み、外へリングが走る（Appleのアクティビティ達成と同じ「事件」の作り方）。
// 2.6秒で自動的に引き、タップでも即閉じる＝記録の邪魔をしない。
function CelebrateOverlay({ badges, retroCount, onShare, onClose }: {
  badges: BadgeState[]; retroCount: number; onShare: (b: BadgeState) => void; onClose: () => void;
}) {
  const reduce = useReduceMotion();
  const scale = useRef(new RNAnimated.Value(reduce ? 1 : 0.55)).current;
  const spin = useRef(new RNAnimated.Value(reduce ? 1 : 0)).current;
  const ring = useRef(new RNAnimated.Value(0)).current;
  const many = badges.length > 1;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (!reduce) {
      RNAnimated.parallel([
        RNAnimated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 110 }),
        RNAnimated.timing(spin, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        RNAnimated.timing(ring, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
    const tm = setTimeout(onClose, CELEBRATE_MS);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['-160deg', '0deg'] });
  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.9, 2.1] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  const head = badges[0];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* 背景・カードのどこを触っても閉じる（共有ボタンだけが例外＝内側のPressableが受ける） */}
      <Pressable style={s.celebBack} onPress={onClose}>
        <RNAnimated.View style={[s.celebCard, { transform: [{ scale }] }]}>
          <View style={s.celebMedal}>
            {/* 走るリング（メダルの外へ広がって消える） */}
            <RNAnimated.View style={[s.celebRing, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
            <RNAnimated.View style={{ transform: [{ rotate }] }}>
              <BadgeIcon id={head.id} size={72} earned cat={head.cat} />
            </RNAnimated.View>
          </View>
          <Text style={s.celebT}>
            {many ? t('{n}つのバッジを獲得しました', { n: badges.length }) : t('新しいバッジを獲得！')}
          </Text>
          {/* 遡及獲得（あとから増えたバッジを過去の記録で獲得）だけ理由を一言添える */}
          {retroCount > 0 && <Text style={s.celebRetro}>{t('過去の記録から獲得しました')}</Text>}
          {badges.slice(0, 3).map((b) => (
            <View key={b.id} style={s.celebRow}>
              <BadgeIcon id={b.id} size={36} earned cat={b.cat} />
              <View style={{ flex: 1 }}>
                <Text style={s.celebName}>{b.name}</Text>
                <Text style={s.celebDesc}>{b.desc}</Text>
              </View>
            </View>
          ))}
          {badges.length > 3 && <Text style={s.celebMore}>{t('ほか{n}個', { n: badges.length - 3 })}</Text>}
          <Pressable style={s.celebCta} onPress={() => onShare(head)}>
            <Text style={s.celebCtaT}>{t('ストーリーに自慢する')}</Text>
          </Pressable>
        </RNAnimated.View>
      </Pressable>
    </Modal>
  );
}

// カテゴリ見出し（概要タブのセクション見出しと同じ流儀）。メダルの色相もこの4分割に対応する
const CATS: BadgeCat[] = ['streak', 'action', 'body', 'move'];
const CAT_LABEL = (): Record<BadgeCat, string> => ({
  streak: t('継続'), action: t('記録'), body: t('体重'), move: t('運動'),
});

/** バッジ詳細（大きいメダル＋条件＋獲得日＋共有） */
function BadgeSheet({ badge, onShare, onClose }: { badge: BadgeState; onShare: () => void; onClose: () => void }) {
  const on = badge.earnedOn != null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.sheetBack}>
        <View style={s.sheetCard}>
          <BadgeIcon id={badge.id} size={96} earned={on} cat={badge.cat} />
          <Text style={s.sheetCat}>{CAT_LABEL()[badge.cat]}</Text>
          <Text style={s.sheetName}>{badge.name}</Text>
          <Text style={s.sheetLabel}>{t('獲得条件')}</Text>
          <Text style={s.sheetDesc}>{badge.desc}</Text>
          <Text style={[s.sheetOn, !on && { color: C.faint }]}>
            {on ? t('{d} に獲得', { d: badge.earnedOn!.replace(/-/g, '/') }) : t('まだ獲得していません')}
          </Text>
          {on && (
            <Pressable style={s.sheetCta} onPress={onShare}>
              <Share2 size={15} color={C.teal} />
              <Text style={s.sheetCtaT}>{t('ストーリーに自慢する')}</Text>
            </Pressable>
          )}
          <Pressable onPress={onClose} hitSlop={8} style={{ marginTop: 12 }}>
            <Text style={s.celebClose}>{t('とじる')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function AchievementsScreen() {
  const [report, setReport] = useState<AchievementReport | null>(null);
  const [sticker, setSticker] = useState<StickerData | null>(null);
  const [celebrate, setCelebrate] = useState<BadgeState[]>([]);
  const [retroCount, setRetroCount] = useState(0);
  const [detail, setDetail] = useState<BadgeState | null>(null);

  useEffect(() => {
    evaluateAchievements().then((r) => {
      setReport(r);
      if (r.newIds.length > 0) {
        setCelebrate(r.badges.filter((b) => r.newIds.includes(b.id)));
        setRetroCount(r.retroIds.length);
      }
      // このページを見た時点で未読は消す（🔥チップと設定の赤ドットも同時に消える）
      markBadgesSeen().catch(() => {});
      // ★レビューの依頼は「うまくいっている人の、うまくいった直後」にだけ出す。
      // 条件（14日以上の記録＋成功体験＋未依頼＋不具合報告から30日）は lib/reviewPrompt.ts 側。
      // 祝祭のオーバーレイと重ならないよう、少し置いてから声をかける
      setTimeout(() => {
        maybeAskReview({
          recordedDays: r.recordedDays,
          streak: r.streak,
          justEarnedBadge: r.newIds.length > 0,
          goalReached: r.goalReached,
        }).catch(() => {});
      }, 2500);
    }).catch(() => setReport(null));
  }, []);

  const earned = report?.badges.filter((b) => b.earnedOn != null) ?? [];

  // カテゴリごとに「獲得済み→未獲得」で並べる（集めた棚が上に来る）
  const byCat = useMemo(() => {
    const m = new Map<BadgeCat, BadgeState[]>();
    for (const cat of CATS) {
      const list = (report?.badges ?? []).filter((b) => b.cat === cat);
      m.set(cat, [...list.filter((b) => b.earnedOn != null), ...list.filter((b) => b.earnedOn == null)]);
    }
    return m;
  }, [report]);

  // 「いつでも共有」の選択肢（データがあるものだけ出す）。
  // 共有スコープは **バッジ・筋トレ実績（自己ベスト）・体重変化グラフ** の3種に限定（docs/INSIGHTS-ENGINE.md §5・2026-09-02）。
  //  ・法則ステッカーは除外（熊田さん: 「法則をストーリーに乗せる意味はない」。法則はタップで解説記事を読むものになった）
  //  ・ストリーク／今日の食事／最新の運動のチップも同時に外した（「見せて自慢する」対象を実績＝バッジとPRに絞る）
  //  ・バッジはバッジ詳細シートと祝祭から共有する（このハブには出さない）。体重変化グラフのステッカーは未実装（追って）
  const shareOptions: { key: string; label: string; data: StickerData | null }[] = report ? [
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
                {/* ステッカーと並べて「アプリ自体を渡す」導線を1つ置く（feat/invite）。
                    ステッカーは自慢を見せるだけで、見た人が入れる線が無かった。
                    塗りを変えて、ステッカー作成とは別種の操作だと分かるようにする */}
                <Pressable style={[s.shareBtn, s.inviteBtn]}
                  onPress={() => { shareInvite().catch(() => {}); }}>
                  <UserPlus size={13} color={C.ink} />
                  <Text style={[s.shareBtnT, { color: C.ink }]}>{t('アプリを紹介する')}</Text>
                </Pressable>
              </View>
            </View>

            {/* バッジ一覧（カテゴリごと・獲得済みが先） */}
            <Text style={s.count}>{t('{n} / {m} 個 獲得', { n: earned.length, m: report.badges.length })}</Text>
            {CATS.map((cat) => (
              <View key={cat}>
                <Text style={s.catT}>{CAT_LABEL()[cat]}</Text>
                <View style={s.grid}>
                  {(byCat.get(cat) ?? []).map((b) => {
                    const on = b.earnedOn != null;
                    return (
                      <Pressable key={b.id} style={({ pressed }) => [s.badge, !on && s.badgeOff, pressed && { opacity: 0.75 }]}
                                 onPress={() => { Haptics.selectionAsync().catch(() => {}); setDetail(b); }}>
                        <BadgeIcon id={b.id} size={56} earned={on} cat={b.cat} />
                        <Text style={[s.badgeN, !on && { color: C.faint }]} numberOfLines={1}>{b.name}</Text>
                        <Text style={s.badgeD} numberOfLines={2}>
                          {on ? t('{d} 獲得', { d: b.earnedOn!.slice(5).replace('-', '/') }) : b.desc}
                        </Text>
                      </Pressable>
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
          retroCount={retroCount}
          onShare={(b) => { setCelebrate([]); setSticker({ kind: 'badge', id: b.id, name: b.name }); }}
          onClose={() => setCelebrate([])}
        />
      )}
      {detail && (
        <BadgeSheet
          badge={detail}
          onShare={() => { const b = detail; setDetail(null); setSticker({ kind: 'badge', id: b.id, name: b.name }); }}
          onClose={() => setDetail(null)}
        />
      )}
      <ShareStickerModal data={sticker} visible={sticker != null} onClose={() => setSticker(null)} />
    </View>
  );
}

const s = themed(() => ({
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
  // 「アプリを紹介する」だけは無彩色。ステッカー作成（teal）と別種の操作だと色で分ける
  inviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.chipBg, borderColor: C.line },
  count: { fontSize: 12.5, fontWeight: '700', color: C.sub, marginBottom: 4 },
  catT: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 14, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { width: '31%', backgroundColor: C.panel, borderRadius: 14, padding: 10, alignItems: 'center', minHeight: 124 },
  badgeOff: { backgroundColor: C.chipBg },
  badgeN: { fontSize: 12, fontWeight: '800', color: C.ink, marginTop: 6 },
  badgeD: { fontSize: 11, color: C.sub, textAlign: 'center', marginTop: 2, lineHeight: 14 },
  heroFlame: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  // 祝祭
  celebBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 28 },
  celebCard: { backgroundColor: C.panel, borderRadius: 22, padding: 22, alignItems: 'center' },
  celebMedal: { alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  celebRing: { position: 'absolute', width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: C.teal },
  celebT: { fontSize: 18, fontWeight: '900', color: C.ink, marginTop: 4, marginBottom: 4, textAlign: 'center' },
  celebRetro: { fontSize: 12, fontWeight: '700', color: C.sub, marginBottom: 4 },
  celebRow: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', backgroundColor: C.accentSoft, borderRadius: 14, padding: 12, marginTop: 6 },
  celebName: { fontSize: 15, fontWeight: '800', color: C.ink },
  celebDesc: { fontSize: 11.5, color: C.sub, marginTop: 1 },
  celebMore: { fontSize: 12, fontWeight: '700', color: C.sub, marginTop: 8 },
  celebCta: { backgroundColor: C.teal, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 26, marginTop: 16, alignSelf: 'stretch', alignItems: 'center' },
  celebCtaT: { fontSize: 15, fontWeight: '800', color: '#fff' },
  celebClose: { fontSize: 13, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },
  // バッジ詳細
  sheetBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 28 },
  sheetCard: { backgroundColor: C.panel, borderRadius: 22, padding: 22, alignItems: 'center' },
  sheetCat: { fontSize: 11.5, fontWeight: '800', color: C.sub, marginTop: 12, letterSpacing: 1.5 },
  sheetName: { fontSize: 19, fontWeight: '900', color: C.ink, marginTop: 2, textAlign: 'center' },
  sheetLabel: { fontSize: 11.5, fontWeight: '800', color: C.faint, marginTop: 14, letterSpacing: 1 },
  sheetDesc: { fontSize: 14, color: C.ink, marginTop: 4, textAlign: 'center', lineHeight: 20 },
  sheetOn: { fontSize: 13, fontWeight: '800', color: C.teal, marginTop: 12, fontVariant: ['tabular-nums'] },
  sheetCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 20, marginTop: 14, alignSelf: 'stretch' },
  sheetCtaT: { fontSize: 14.5, fontWeight: '800', color: C.teal },
}));
