// プラン選択（ペイウォール）。価格はApp Store Connect側の設定がRevenueCat経由で
// 自動反映されるため、このファイルに金額は書かない（金額変更＝再ビルド不要）。
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Check, Sparkles } from 'lucide-react-native';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { purchasesAvailable, fetchOffers, purchase, restore, currentPlan, type Offer, type Plan } from '@/lib/purchases';

// 金額の簡易フォーマット（月換算表示用）。主要通貨だけ整形し、他はそのまま
function fmtMoney(v: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: currency === 'JPY' ? 0 : 2 }).format(v); }
  catch { return `${Math.round(v)} ${currency}`; }
}

const PERIODS = [
  { key: 'monthly', label: '1ヶ月' },
  { key: 'sixmonth', label: '6ヶ月' },
  { key: 'annual', label: '1年' },
] as const;

// src（どの機能から来たか）→ 文脈見出し。MFP式: 使おうとした瞬間（moment of intent）に
// その機能の言葉で誘うほうが汎用の売り文句より効くため、王冠からの遷移はsrcを付けて来る。
// 未知のsrcでも壊れないよう、マップに無ければ既定（汎用）文言に落ちる
const SRC_COPY = (): Record<string, { h: string; lead: string }> => ({
  onboarding: {
    h: t('準備ができました！'),
    lead: t('AIが毎日の食事を数えて、あなたの代わりに考えます。まずは無料で全機能をどうぞ。'),
  },
  laws: {
    h: t('あなたの法則を、ぜんぶ手に入れる'),
    lead: t('無料プランは最新3枚まで。スタンダード以上で図鑑のすべてが開きます。'),
  },
  digest: {
    h: t('食べ方のクセまで見える、週間ダイジェスト'),
    lead: t('1週間の食べ方をAIがまとめて言語化。プレミアムの詳細分析で、毎週のふりかえりが開きます。'),
  },
  ads: {
    h: t('広告のない、静かな画面に'),
    lead: t('ライトプラン以上で広告が消えて、記録に集中できます。'),
  },
});

// 各プランの訴求（機能差はサーバーのplan_limitsが正本。ここは表示のみ）
const PLAN_INFO: { plan: Plan; name: string; features: string[] }[] = [
  { plan: 'lite', name: 'ライト', features: ['広告なし'] },
  { plan: 'standard', name: 'スタンダード', features: ['広告なし', 'AI食事解析（テキスト50回/日）', '写真解析 5枚/日', 'AI相談 10往復/日'] },
  { plan: 'premium', name: 'プレミアム', features: ['広告なし', 'AI解析・写真・相談が実質無制限', '詳細分析（食べ方のクセ・週間ダイジェスト）'] },
];

export default function PaywallScreen() {
  const router = useRouter();
  const { src } = useLocalSearchParams<{ src?: string }>();
  const fromOnboarding = src === 'onboarding';
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [plan, setPlan] = useState<Plan>('free');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('monthly');
  const [busy, setBusy] = useState(false);
  const [goalLine, setGoalLine] = useState('');

  useEffect(() => {
    (async () => {
      const [o, p] = await Promise.all([fetchOffers(), currentPlan()]);
      setOffers(o); setPlan(p);
      // 年額プラン比率が最も高いカテゴリのため、年額をデフォルト選択にする
      if (o.some((x) => x.period === 'annual')) setPeriod('annual');
    })();
  }, []);

  // オンボーディング直後だけ、決めたばかりの目標を見出しに差し込む（パーソナライズ）
  useEffect(() => {
    if (!fromOnboarding) return;
    (async () => {
      const { data: g } = await supabase.from('goals').select('target_weight,start_weight').maybeSingle();
      const delta = g?.target_weight != null && g?.start_weight != null
        ? Number(g.target_weight) - Number(g.start_weight) : null;
      if (delta != null && Math.abs(delta) >= 0.5) {
        setGoalLine(t('目標「{n}kg」を最短で。', { n: (delta > 0 ? '+' : '') + delta.toFixed(1) }));
      }
    })();
  }, [fromOnboarding]);

  const byPlan = useMemo(() => {
    const map = new Map<Plan, Offer>();
    for (const o of offers ?? []) if (o.period === period) map.set(o.plan, o);
    return map;
  }, [offers, period]);
  const availablePeriods = useMemo(() => {
    const set = new Set((offers ?? []).map((o) => o.period));
    return PERIODS.filter((p) => set.has(p.key));
  }, [offers]);

  async function buy(offer: Offer) {
    if (busy) return;
    setBusy(true);
    try {
      const newPlan = await purchase(offer);
      if (newPlan && newPlan !== 'free') {
        setPlan(newPlan);
        Alert.alert(t('ありがとうございます！'), t('プランが有効になりました。'));
        router.back();
      }
    } catch (e) {
      Alert.alert(t('購入できませんでした'), (e as Error).message);
    } finally { setBusy(false); }
  }

  async function doRestore() {
    if (busy) return;
    setBusy(true);
    try {
      const p = await restore();
      setPlan(p);
      Alert.alert(p === 'free' ? t('復元できる購入が見つかりませんでした') : t('購入を復元しました'));
    } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ headerShown: true, title: '', headerBackTitle: t('戻る'), headerTintColor: C.teal, headerShadowVisible: false, headerStyle: { backgroundColor: C.bg } }} />
      <ScrollView contentContainerStyle={s.scroll}>
        {(() => {
          // 文脈見出し（srcが未知・未指定なら従来の汎用文言）
          const copy = SRC_COPY()[String(src ?? '')] ?? {
            h: t('プラン'),
            lead: t('記録・グラフはずっと無料。AIをもっと使いたくなったら。'),
          };
          return (
            <>
              <Text style={s.h}>{copy.h}</Text>
              <Text style={s.lead}>
                {goalLine}
                {copy.lead}
              </Text>
            </>
          );
        })()}

        {!purchasesAvailable() || (offers !== null && offers.length === 0) ? (
          <View style={s.pending}>
            <Text style={s.pendingT}>{t('プランは準備中です。もうしばらくお待ちください。')}</Text>
          </View>
        ) : offers === null ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={C.teal} />
        ) : (
          <>
            {availablePeriods.length > 1 && (
              <View style={s.seg}>
                {availablePeriods.map((p) => (
                  <Pressable key={p.key} onPress={() => setPeriod(p.key)}
                    style={[s.segBtn, period === p.key && s.segOn]}>
                    <Text style={[s.segT, period === p.key && s.segTOn]}>{t(p.label)}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {PLAN_INFO.map((info) => {
              const offer = byPlan.get(info.plan);
              const isCurrent = plan === info.plan;
              const highlight = info.plan === 'standard';
              return (
                <View key={info.plan} style={[s.card, highlight && s.cardHi]}>
                  {highlight && (
                    <View style={s.badge}><Sparkles size={12} color="#fff" /><Text style={s.badgeT}>{t('おすすめ')}</Text></View>
                  )}
                  <View style={s.cardHead}>
                    <Text style={s.planName}>{t(info.name)}</Text>
                    {offer && (
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={s.price}>{offer.priceString}<Text style={s.per}>{period === 'monthly' ? t('/月') : period === 'sixmonth' ? t('/6ヶ月') : t('/年')}</Text></Text>
                        {period === 'annual' && offer.price > 0 && (
                          <Text style={s.perMonth}>{t('月あたり{p}相当', { p: fmtMoney(offer.price / 12, offer.currency) })}</Text>
                        )}
                      </View>
                    )}
                  </View>
                  {info.features.map((f) => (
                    <View key={f} style={s.featRow}>
                      <Check size={15} color={C.teal} />
                      <Text style={s.featT}>{t(f)}</Text>
                    </View>
                  ))}
                  <Pressable
                    disabled={busy || isCurrent || !offer}
                    onPress={() => offer && buy(offer)}
                    style={({ pressed }) => [s.cta, highlight && s.ctaHi, (isCurrent || !offer) && s.ctaOff, pressed && { opacity: 0.85 }]}>
                    <Text style={[s.ctaT, highlight && s.ctaTHi]}>
                      {isCurrent ? t('現在のプラン')
                        : !offer ? t('この期間の設定なし')
                        : offer.trialDays > 0 ? t('{n}日間無料で始める', { n: offer.trialDays })
                        : t('このプランにする')}
                    </Text>
                  </Pressable>
                  {offer && offer.trialDays > 0 && !isCurrent && (
                    <Text style={s.trialNote}>
                      {t('無料期間の終了後は{p}。期間中の解約なら料金はかかりません。', {
                        p: offer.priceString + (period === 'monthly' ? t('/月') : period === 'sixmonth' ? t('/6ヶ月') : t('/年')),
                      })}
                    </Text>
                  )}
                </View>
              );
            })}
            <Pressable onPress={doRestore} disabled={busy} hitSlop={8} style={{ alignSelf: 'center', marginTop: 14 }}>
              <Text style={s.link}>{t('購入を復元する')}</Text>
            </Pressable>
            {fromOnboarding && (
              <Pressable onPress={() => router.back()} hitSlop={8} style={{ alignSelf: 'center', marginTop: 12 }}>
                <Text style={[s.link, { color: C.sub }]}>{t('無料のまま始める')}</Text>
              </Pressable>
            )}
          </>
        )}

        <Text style={s.legal}>
          {t('サブスクリプションは期間終了の24時間前までに解約しない限り自動更新されます。解約はiOSの設定 > Apple ID > サブスクリプションから行えます。')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 18, alignSelf: 'center', marginTop: 8 }}>
          <Pressable onPress={() => Linking.openURL('https://bodylog-orcin.vercel.app/terms')} hitSlop={8}>
            <Text style={s.link}>{t('利用規約')}</Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL('https://bodylog-orcin.vercel.app/privacy')} hitSlop={8}>
            <Text style={s.link}>{t('プライバシーポリシー')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 8, paddingBottom: 48 },
  h: { fontSize: 26, fontWeight: '800', color: C.ink },
  lead: { fontSize: 14, color: C.sub, marginTop: 4, marginBottom: 14 },
  pending: { backgroundColor: C.panel, borderRadius: 14, padding: 24, alignItems: 'center', marginTop: 12 },
  pendingT: { color: C.sub, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  seg: { flexDirection: 'row', backgroundColor: C.panel, borderRadius: 10, padding: 3, marginBottom: 14 },
  segBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  segOn: { backgroundColor: C.teal },
  segT: { fontSize: 13, fontWeight: '600', color: C.sub },
  segTOn: { color: '#fff' },
  card: { backgroundColor: C.panel, borderRadius: 16, padding: 16, marginBottom: 12 },
  cardHi: { borderWidth: 2, borderColor: C.teal },
  badge: { position: 'absolute', top: -10, left: 14, backgroundColor: C.teal, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeT: { color: '#fff', fontSize: 11, fontWeight: '800' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  planName: { fontSize: 18, fontWeight: '800', color: C.ink },
  price: { fontSize: 20, fontWeight: '800', color: C.ink },
  per: { fontSize: 12, fontWeight: '500', color: C.sub },
  perMonth: { fontSize: 11.5, color: C.teal, fontWeight: '700', marginTop: 1 },
  trialNote: { fontSize: 11.5, color: C.sub, marginTop: 6, lineHeight: 16 },
  featRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  featT: { fontSize: 13.5, color: C.ink, flex: 1 },
  cta: { marginTop: 10, borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: C.bg },
  ctaHi: { backgroundColor: C.teal },
  ctaOff: { opacity: 0.5 },
  ctaT: { fontSize: 15, fontWeight: '700', color: C.teal },
  ctaTHi: { color: '#fff' },
  link: { fontSize: 13, color: C.teal, fontWeight: '600' },
  legal: { fontSize: 11.5, color: C.sub, lineHeight: 17, marginTop: 20 },
});
