// プラン選択（ペイウォール）。価格はApp Store Connect側の設定がRevenueCat経由で
// 自動反映されるため、このファイルに金額は書かない（金額変更＝再ビルド不要）。
//
// レイアウト（2026-09改定）: 月/年の期間セグメントをやめ、各プランカードの中に
// 「月額」と「年額（月あたり換算・N%お得）」を両方見せてタップで選ぶ方式にする。
// 期間を切り替えないと年額の存在に気づけない問題（価格比較の分断）への対応。
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Check, Sparkles } from 'lucide-react-native';
import { C, rgba } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import CouponSheet from '@/components/CouponSheet';
import { purchasesAvailable, fetchOffers, purchase, restore, currentPlan, type Offer, type Plan } from '@/lib/purchases';

// 金額の簡易フォーマット（月換算表示用）。主要通貨だけ整形し、他はそのまま
function fmtMoney(v: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: currency === 'JPY' ? 0 : 2 }).format(v); }
  catch { return `${Math.round(v)} ${currency}`; }
}

type Period = Offer['period'];
// カード内の価格オプションの表示順（月額→6ヶ月→年額）と、CTA・注記で使う期間サフィックス
const PERIOD_ORDER: Period[] = ['monthly', 'sixmonth', 'annual'];
const periodLabel = (p: Period) => (p === 'monthly' ? t('月額') : p === 'sixmonth' ? t('6ヶ月') : t('年額'));
const periodSuffix = (p: Period) => (p === 'monthly' ? t('/月') : p === 'sixmonth' ? t('/6ヶ月') : t('/年'));
const monthsOf = (p: Period) => (p === 'monthly' ? 1 : p === 'sixmonth' ? 6 : 12);

// src（どの機能から来たか）→ 文脈見出し。MFP式: 使おうとした瞬間（moment of intent）に
// その機能の言葉で誘うほうが汎用の売り文句より効くため、王冠からの遷移はsrcを付けて来る。
// limit_*（上限到達）は非審判トーン: 「明日また回復する」を先に言い、責めない。
// 未知のsrcでも壊れないよう、マップに無ければ既定（汎用）文言に落ちる
const SRC_COPY = (): Record<string, { h: string; lead: string }> => ({
  onboarding: {
    h: t('準備ができました！'),
    lead: t('AIが毎日の食事を数えて、あなたの代わりに考えます。まずは無料で全機能をどうぞ。'),
  },
  laws: {
    h: t('あなたの法則を、ぜんぶ手に入れる'),
    lead: t('無料・ライトは最新3枚まで。スタンダード以上で図鑑のすべてが開きます。'),
  },
  digest: {
    h: t('食べ方のクセまで見える、週のふりかえり'),
    lead: t('1週間の食べ方をまとめて言語化。スタンダード以上で毎週のふりかえりが開きます。'),
  },
  eating: {
    h: t('食べ方のクセ、ぜんぶ見える'),
    lead: t('食べる時間帯・曜日のリズム・食材の傾向・過食の引き金。スタンダード以上で食べ方の分析が開きます。'),
  },
  coach: {
    h: t('あなたの記録を読んで答える、AI相談'),
    lead: t('直近の食事・体重・栄養ログを根拠にアドバイス。スタンダード以上で使えて、1つの相談の中は往復無制限です。'),
  },
  ads: {
    h: t('広告のない、静かな画面に'),
    lead: t('ライトプラン以上で広告が消えて、記録に集中できます。'),
  },
  // ===== 上限到達（429 plan_limit）からの遷移。kind別に「何を使い切ったか」を言う =====
  limit_text: {
    h: t('今日の無料ぶんのAI解析を使い切りました'),
    lead: t('明日また回復します。いま解放するなら、上のプランで1日の回数がぐっと増えます。'),
  },
  limit_photo: {
    h: t('今日の写真解析を使い切りました'),
    lead: t('明日また回復します。いま解放するなら、写真の枚数に余裕のあるプランをどうぞ。'),
  },
  limit_coach: {
    h: t('今日のAI相談を使い切りました'),
    lead: t('明日また回復します。いま解放するなら、1日の相談セッション数が増えます。'),
  },
});

// 各プランの訴求（機能差はサーバーのplan_limitsが正本。ここは表示のみ。新ティア2026-09）。
// featuresは関数にして呼び出し時にt()する（リテラルt('...')でi18n収集スクリプトに拾わせるため）
const PLAN_INFO: { plan: Plan; name: string; features: () => string[] }[] = [
  { plan: 'lite', name: 'ライト', features: () => [t('広告なし'), t('AIテキスト解析 5回/日'), t('AI写真解析 2枚/日')] },
  { plan: 'standard', name: 'スタンダード', features: () => [t('広告なし'), t('AIテキスト解析 50回/日'), t('AI写真解析 5枚/日'), t('AI相談 10セッション/日（往復無制限）'), t('食べ方の分析・週のふりかえり・法則図鑑のすべて')] },
  { plan: 'premium', name: 'プレミアム', features: () => [t('スタンダードの全機能'), t('AI解析・写真・相談が実質無制限')] },
];

export default function PaywallScreen() {
  const router = useRouter();
  const { src } = useLocalSearchParams<{ src?: string }>();
  const fromOnboarding = src === 'onboarding';
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [plan, setPlan] = useState<Plan>('free');
  // プランごとに選択中の期間（既定=年額があれば年額。年額プラン比率が最も高いカテゴリのため）
  const [sel, setSel] = useState<Partial<Record<Plan, Period>>>({});
  const [busy, setBusy] = useState(false);
  const [goalLine, setGoalLine] = useState('');
  const [couponOpen, setCouponOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [o, p] = await Promise.all([fetchOffers(), currentPlan()]);
      setOffers(o); setPlan(p);
      // 既定選択: 年額 > 月額 > その他（プラン単位で決める）
      const next: Partial<Record<Plan, Period>> = {};
      for (const info of PLAN_INFO) {
        const mine = o.filter((x) => x.plan === info.plan);
        if (!mine.length) continue;
        next[info.plan] = mine.some((x) => x.period === 'annual') ? 'annual'
          : mine.some((x) => x.period === 'monthly') ? 'monthly'
          : mine[0].period;
      }
      setSel(next);
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

  // プラン→そのプランで買える期間一覧（表示順に整列）
  const offersByPlan = useMemo(() => {
    const map = new Map<Plan, Offer[]>();
    for (const o of offers ?? []) {
      const arr = map.get(o.plan) ?? [];
      arr.push(o);
      map.set(o.plan, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => PERIOD_ORDER.indexOf(a.period) - PERIOD_ORDER.indexOf(b.period));
    }
    return map;
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
            {PLAN_INFO.map((info) => {
              const opts = offersByPlan.get(info.plan) ?? [];
              const monthly = opts.find((o) => o.period === 'monthly') ?? null;
              const selected = opts.find((o) => o.period === sel[info.plan]) ?? opts[0] ?? null;
              const isCurrent = plan === info.plan;
              const highlight = info.plan === 'standard';
              return (
                <View key={info.plan} style={[s.card, highlight && s.cardHi]}>
                  {highlight && (
                    <View style={s.badge}><Sparkles size={12} color="#fff" /><Text style={s.badgeT}>{t('おすすめ')}</Text></View>
                  )}
                  <Text style={s.planName}>{t(info.name)}</Text>
                  {info.features().map((f) => (
                    <View key={f} style={s.featRow}>
                      <Check size={15} color={C.teal} />
                      <Text style={s.featT}>{f}</Text>
                    </View>
                  ))}

                  {/* ===== 価格オプション（月額と年額を同時に見せる。タップで選択→CTAに反映） ===== */}
                  {opts.map((o) => {
                    const on = selected != null && o.period === selected.period;
                    const months = monthsOf(o.period);
                    // 月あたり換算と「月額に対して何%お得か」（月額が無い・0円のプランでは出さない）
                    const perMonth = months > 1 && o.price > 0 ? o.price / months : null;
                    const savePct = perMonth != null && monthly && monthly.price > 0
                      ? Math.round((1 - perMonth / monthly.price) * 100) : 0;
                    return (
                      <Pressable key={o.period} onPress={() => setSel((prev) => ({ ...prev, [info.plan]: o.period }))}
                                 style={({ pressed }) => [s.priceOpt, on && s.priceOptOn, pressed && { opacity: 0.85 }]}>
                        {/* ラジオ風の選択マーク（どれが買われるかを曖昧にしない） */}
                        <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.radioDot} />}</View>
                        <Text style={[s.priceOptLabel, on && { color: C.ink }]}>{periodLabel(o.period)}</Text>
                        <View style={{ flex: 1, alignItems: 'flex-end' }}>
                          <Text style={s.priceOptPrice}>{o.priceString}</Text>
                          {perMonth != null && (
                            <Text style={s.priceOptSub}>
                              {t('月あたり{p}相当', { p: fmtMoney(perMonth, o.currency) })}
                              {savePct > 0 ? t('・{n}%お得', { n: savePct }) : ''}
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}

                  <Pressable
                    disabled={busy || isCurrent || !selected}
                    onPress={() => selected && buy(selected)}
                    style={({ pressed }) => [s.cta, highlight && s.ctaHi, (isCurrent || !selected) && s.ctaOff, pressed && { opacity: 0.85 }]}>
                    <Text style={[s.ctaT, highlight && s.ctaTHi]}>
                      {isCurrent ? t('現在のプラン')
                        : !selected ? t('このプランの設定なし')
                        : selected.trialDays > 0 ? t('{n}日間無料で始める', { n: selected.trialDays })
                        : t('このプランにする')}
                    </Text>
                  </Pressable>
                  {selected && selected.trialDays > 0 && !isCurrent && (
                    <Text style={s.trialNote}>
                      {t('無料期間の終了後は{p}。期間中の解約なら料金はかかりません。', {
                        p: selected.priceString + periodSuffix(selected.period),
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

        {/* クーポン: 買う気の無い人の目に入っても邪魔にならない小ささで（準備中表示のビルドでも使える） */}
        <Pressable onPress={() => setCouponOpen(true)} hitSlop={8} style={{ alignSelf: 'center', marginTop: 12 }}>
          <Text style={[s.link, { color: C.sub, fontSize: 12.5 }]}>{t('コードをお持ちの方はこちら')}</Text>
        </Pressable>

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
      {/* クーポン適用に成功したら現在プラン表示も更新（RCではなくサーバー直付与だが見た目は揃える） */}
      <CouponSheet visible={couponOpen} onClose={() => setCouponOpen(false)}
                   onRedeemed={(p) => setPlan(p as Plan)} />
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 8, paddingBottom: 48 },
  h: { fontSize: 26, fontWeight: '800', color: C.ink },
  lead: { fontSize: 14, color: C.sub, marginTop: 4, marginBottom: 14 },
  pending: { backgroundColor: C.panel, borderRadius: 14, padding: 24, alignItems: 'center', marginTop: 12 },
  pendingT: { color: C.sub, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  card: { backgroundColor: C.panel, borderRadius: 16, padding: 16, marginBottom: 12 },
  cardHi: { borderWidth: 2, borderColor: C.teal },
  badge: { position: 'absolute', top: -10, left: 14, backgroundColor: C.teal, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeT: { color: '#fff', fontSize: 11, fontWeight: '800' },
  planName: { fontSize: 18, fontWeight: '800', color: C.ink, marginBottom: 8 },
  // 価格オプション行（月額/年額の同時提示。選択中はアクセント縁）
  priceOpt: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    borderWidth: 1.5, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 8,
  },
  priceOptOn: { borderColor: C.teal, backgroundColor: rgba(C.teal, 0.06) },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: C.teal },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.teal },
  priceOptLabel: { fontSize: 14, fontWeight: '700', color: C.sub },
  priceOptPrice: { fontSize: 16, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  priceOptSub: { fontSize: 11.5, color: C.teal, fontWeight: '700', marginTop: 1 },
  trialNote: { fontSize: 11.5, color: C.sub, marginTop: 6, lineHeight: 16 },
  featRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  featT: { fontSize: 13.5, color: C.ink, flex: 1 },
  cta: { marginTop: 12, borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: C.bg },
  ctaHi: { backgroundColor: C.teal },
  ctaOff: { opacity: 0.5 },
  ctaT: { fontSize: 15, fontWeight: '700', color: C.teal },
  ctaTHi: { color: '#fff' },
  link: { fontSize: 13, color: C.teal, fontWeight: '600' },
  legal: { fontSize: 11.5, color: C.sub, lineHeight: 17, marginTop: 20 },
});
