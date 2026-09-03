// プラン選択（ペイウォール）。価格はApp Store Connect側の設定がRevenueCat経由で
// 自動反映されるため、このファイルに金額は書かない（金額変更＝再ビルド不要）。
//
// レイアウト（2026-09改定・2プラン構成）:
//  ・選択は「画面全体でただ1つ」（plan×periodの組が1つだけ）。以前はカードごとに独立した
//    periodを持っていたため、3枚のカードが同時に選択済みに見えてどれを買うのか分からない
//    状態だった（βフィードバック 2026-09-01）。選択状態は sel（Selection）1つに統一。
//  ・ライトを廃止（PAYWALL_PLANS）。主役はプレミアム＝おすすめバッジ・グラデ縁・年額既定。
//    スタンダードは「まずは試したい人へ」の控えめな枠線カード。
//  ・各カードの中に「月額」と「年額（月あたり換算・N%お得）」を両方見せる方式は維持
//    （期間を切り替えないと年額の存在に気づけない＝価格比較の分断を避ける）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert, Linking, Platform, Animated } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Sparkles } from 'lucide-react-native';
import { C, rgba, RADIUS, SPACE, ICON, HEAD, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { useReduceMotion } from '@/lib/motion';
import { supabase } from '@/lib/supabase';
import CouponSheet from '@/components/CouponSheet';
import { applyEntitlement } from '@/lib/gate';
import { shouldShowImpressionCount } from '@/lib/ads';
import { readWeeklyImpressions } from '@/lib/adImpressions';
import {
  purchasesAvailable, fetchOffers, purchase, restore, currentPlan,
  PAYWALL_PLANS, defaultSelection, preferredPeriod,
  type Offer, type Plan, type Selection,
} from '@/lib/purchases';

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
    lead: t('無料プランは最新3枚まで。スタンダード以上で図鑑のすべてが開きます。'),
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
  // 食事タブ内「何を食べる？」（AI相談の枠に相乗り）。無料の見本から来る
  eat: {
    h: t('「何を食べる？」を、食事タブでそのまま相談'),
    lead: t('残りカロリーと、あなたの法則・定番・直近の食材から、いまの一品を3つ提案。スタンダード以上で使えて、AI相談と同じ枠です。'),
  },
  // 食事の制約（B-18）。断定を売り文句にしない: 「安全」「アレルギー対応」とは書かず、
  // 見張る＝警告の精度が上がる、という言い方に留める（docs/DIET-MODES.md §6-1）
  diet: {
    h: t('食べないものを、AIが見張る'),
    lead: t('かんたん判定（辞書のみ）は無料で動きます。スタンダード以上でAIが写真と原材料まで読み、メニューの候補にも印をつけます。これは推定で、安全確認には使えません。'),
  },
  // ===== 広告からの遷移（2026-09-04）=====
  // 広告除去だけを売らない: 「広告が消える」単体は訴求として弱く、単価も上がらない。
  // 必ず「＋AIの回数が増える」と束ねて並べる（プラン表の1行目も「広告なし」）
  ads: {
    h: t('広告なしで、静かに記録する'),
    lead: t('スタンダード以上で広告が消えて、AIの解析回数もぐっと増えます。'),
  },
  // 全画面広告を閉じた直後（AdPitchSnackbar から）。「もう出さない」と言い切れるのは
  // 課金が広告を本当に消すからで、これは仕組みで保証している（lib/ads.ts shouldShowAd）
  ads_after: {
    h: t('全画面の広告を、もう出さない'),
    lead: t('スタンダード以上で広告が消えて、AIの解析回数もぐっと増えます。'),
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

// 各プランの訴求。機能差の正本はサーバーのplan_limits（lib/plan.tsのFALLBACKと同値）で、
// ここは表示のみ。数字を変えるときは必ずFALLBACKと突き合わせる。
// leadは「誰のためのプランか」の1行（「いちばん選ばれています」式の社会的証明ではなく
// 価値の言語化）。lead/featuresは関数にして呼び出し時にt()する
// （リテラルt('...')でi18n収集スクリプトに拾わせるため）
const PLAN_INFO: { plan: Plan; name: string; lead: () => string; features: () => string[] }[] = [
  {
    plan: 'standard', name: 'スタンダード', lead: () => t('まずは試したい人へ'),
    features: () => [
      t('広告なし'),
      t('AIテキスト解析 50回/日'),
      t('AI写真解析 5枚/日'),
      t('AI相談 10セッション/日（往復無制限）'),
      t('食べ方の分析・週のふりかえり・法則図鑑のすべて'),
      t('食べないものの検知（AI）'),
    ],
  },
  {
    plan: 'premium', name: 'プレミアム', lead: () => t('制限を気にせず使いたい人へ'),
    features: () => [
      // 1行目は両プランとも「広告なし」（2026-09-04）。広告から来た人は主役カード
      // （プレミアム＝おすすめ）を先に見るので、「スタンダードの全機能」に含めるだけでは
      // 広告が消えることが読み取れない
      t('広告なし'),
      t('スタンダードの全機能'),
      t('AIテキスト解析 100回/日'),
      t('AI写真解析 30枚/日'),
      t('AI相談 50セッション/日（往復無制限）'),
      t('食べないものの検知（AI）'),
    ],
  },
];
// ペイウォールに出すカード（PLAN_INFOの並び＝安い順に上から）
const CARDS = PLAN_INFO.filter((i) => PAYWALL_PLANS.includes(i.plan));
// 主役のプラン（おすすめバッジ・グラデ縁・既定選択の第一候補）
const HERO: Plan = 'premium';

export default function PaywallScreen() {
  const router = useRouter();
  const { src } = useLocalSearchParams<{ src?: string }>();
  const fromOnboarding = src === 'onboarding';
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [plan, setPlan] = useState<Plan>('free');
  // 選択中の plan×period（画面全体でただ1つ）。既定=プレミアムの年額
  const [sel, setSel] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [goalLine, setGoalLine] = useState('');
  const [couponOpen, setCouponOpen] = useState(false);
  // 広告からの遷移（src=ads / ads_after）で見せる「直近1週間に広告を見た回数」。
  // 事実だけを1行。3回未満は出さない（小さい数字で大げさに言わない）。
  // 広告が実際に出ない状態（RCキー未設定・課金者）では常に出ない＝嘘をつかない
  const [adViews, setAdViews] = useState(0);
  const fromAds = src === 'ads' || src === 'ads_after';

  // プレミアムカードの縁を「1本だけ」ゆっくり明滅させる（主役への視線誘導）。
  // 相談タブの入力ドックと同じ流儀＝全開の縁を重ねてopacityだけネイティブ側で往復。
  // 視差効果を減らす設定がONなら固定値で止める（酔い・集中の妨げにしない）
  const glow = useRef(new Animated.Value(0.3)).current;
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (reduceMotion) { glow.setValue(0.3); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 0.5, duration: 1600, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0.12, duration: 1600, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [glow, reduceMotion]);

  useEffect(() => {
    (async () => {
      const [o, p] = await Promise.all([fetchOffers(), currentPlan()]);
      setOffers(o); setPlan(p);
      // 既定選択はプレミアムの年額（買える期間から自動で決まる）
      setSel(defaultSelection(o));
    })();
  }, []);

  // 広告由来のときだけ、端末に残した「見た回数」を読む（サーバーへは送っていない）
  useEffect(() => {
    if (!fromAds) return;
    readWeeklyImpressions().then(setAdViews).catch(() => {});
  }, [fromAds]);

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

  // 選択をこのカードへ移す（他カードの選択は必ず外れる＝ラジオの意味を守る）。
  // 期間の指定が無いときはそのプランの既定期間（年額優先）
  function selectPlan(p: Plan, period?: Period) {
    const next = period ?? preferredPeriod(offers ?? [], p);
    if (next) setSel({ plan: p, period: next });
  }

  async function buy(offer: Offer) {
    if (busy) return;
    setBusy(true);
    try {
      const newPlan = await purchase(offer);
      if (newPlan && newPlan !== 'free') {
        setPlan(newPlan);
        // gate のキャッシュへ即時反映 → 全タブの王冠と広告枠（AdSlot）がその場で消える。
        // webhook→profiles.plan の到着を待たない（サーバー値の引き直しは applyEntitlement が裏で行う）
        applyEntitlement(newPlan);
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
      // 復元も購入と同じ経路で gate へ即時反映（機種変更直後に広告が残らない）
      if (p !== 'free') applyEntitlement(p);
      Alert.alert(p === 'free' ? t('復元できる購入が見つかりませんでした') : t('購入を復元しました'));
    } finally { setBusy(false); }
  }

  // 1枚のプランカード。isHero=プレミアム（グラデ縁＋バッジ＋大きめCTA）、
  // それ以外は枠線だけの控えめなカード
  function renderCard(info: (typeof CARDS)[number]) {
    const opts = offersByPlan.get(info.plan) ?? [];
    const monthly = opts.find((o) => o.period === 'monthly') ?? null;
    const isHero = info.plan === HERO;
    const isCurrent = plan === info.plan;
    // このカードが選択中か。選択中でなければ価格ラジオは全部「未選択」で描く（バグ修正の要）
    const picked = sel?.plan === info.plan;
    const selected = picked ? opts.find((o) => o.period === sel?.period) ?? null : null;
    // 未選択カードのCTAは「選ぶ」（購入はしない）。押した瞬間に選択がこちらへ移る
    const ctaBuy = picked && selected != null && !isCurrent;

    const body = (
      <>
        <Text style={s.planName}>{t(info.name)}</Text>
        <Text style={[s.planLead, isHero && s.planLeadHero]}>{info.lead()}</Text>
        {info.features().map((f) => (
          <View key={f} style={s.featRow}>
            <Check size={ICON.sm} color={C.teal} />
            <Text style={s.featT}>{f}</Text>
          </View>
        ))}

        {/* ===== 価格オプション（月額と年額を同時に見せる。タップで選択→CTAに反映） ===== */}
        {opts.map((o) => {
          const on = picked && sel?.period === o.period;
          const months = monthsOf(o.period);
          // 月あたり換算と「月額に対して何%お得か」（月額が無い・0円のプランでは出さない）
          const perMonth = months > 1 && o.price > 0 ? o.price / months : null;
          const savePct = perMonth != null && monthly && monthly.price > 0
            ? Math.round((1 - perMonth / monthly.price) * 100) : 0;
          return (
            <Pressable key={o.period} onPress={() => selectPlan(info.plan, o.period)}
                       accessibilityRole="radio" accessibilityState={{ selected: !!on }}
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
          disabled={busy || isCurrent || opts.length === 0}
          onPress={() => (ctaBuy && selected ? buy(selected) : selectPlan(info.plan))}
          style={({ pressed }) => [
            s.cta,
            ctaBuy && s.ctaOn,
            ctaBuy && isHero && s.ctaHero,
            (isCurrent || opts.length === 0) && s.ctaOff,
            pressed && { opacity: 0.85 },
          ]}>
          <Text style={[s.ctaT, ctaBuy && s.ctaTOn, ctaBuy && isHero && s.ctaTHero]}>
            {isCurrent ? t('現在のプラン')
              : opts.length === 0 ? t('このプランの設定なし')
              : !ctaBuy ? t('このプランを選ぶ')
              : selected && selected.trialDays > 0 ? t('{n}日間無料で始める', { n: selected.trialDays })
              : t('このプランにする')}
          </Text>
        </Pressable>
        {ctaBuy && selected && selected.trialDays > 0 && (
          <Text style={s.trialNote}>
            {t('無料期間の終了後は{p}。期間中の解約なら料金はかかりません。', {
              p: selected.priceString + periodSuffix(selected.period),
            })}
          </Text>
        )}
      </>
    );

    if (!isHero) return <View key={info.plan} style={s.card}>{body}</View>;

    // 主役カード: アクセント色から作ったグラデ縁（2pxのリング）＋その上でopacityだけ明滅。
    // バッジは外側のViewに置く（リングの外へはみ出す位置なのでクリップを避ける）
    return (
      <View key={info.plan} style={s.heroWrap}>
        <LinearGradient
          colors={[rgba(C.teal, 0.95), rgba(C.teal, 0.35), rgba(C.teal, 0.8)]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={s.heroRing}>
          <Animated.View pointerEvents="none" style={[s.heroGlow, { opacity: glow }]} />
          <View style={s.cardHero}>{body}</View>
        </LinearGradient>
        <View style={s.badge}>
          {/* アクセント塗りの上の文字・線画は白固定（全画面共通の約束）。ダークパレットの
              tealは明るく持ち上げてあるので、暗所でも白のほうがコントラストが立つ */}
          <Sparkles size={ICON.xs} color="#fff" />
          <Text style={s.badgeT}>{t('おすすめ')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ headerShown: true, title: '', headerBackTitle: t('戻る'), headerTintColor: C.teal, headerShadowVisible: false, ...(Platform.OS === 'ios' ? { headerTransparent: true } : { headerStyle: { backgroundColor: C.bg } }) }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.scroll}>
        {(() => {
          // 文脈見出し（srcが未知・未指定なら従来の汎用文言）
          const copy = SRC_COPY()[String(src ?? '')] ?? {
            h: t('プラン'),
            lead: t('記録・グラフはずっと無料。AIをもっと使いたくなったら。'),
          };
          // 回数行（広告由来・3回以上・広告が実際に出る状態のときだけ）。
          // **先頭の訴求**として見出しの上に置く＝自分の数字を先に見せ、そのあとで
          // 「広告なし＋AIの回数」の価値を読ませる。煽り・エスカレーション・
          // 罪悪感の表現は使わない（回数が増えても文言は変わらない）
          const showCount = fromAds && shouldShowImpressionCount({ active: purchasesAvailable(), plan, impressions7d: adViews });
          return (
            <>
              {showCount && (
                <Text style={s.adCount}>
                  {t('この1週間で広告を{n}回見ています。スタンダードなら0回です。', { n: adViews })}
                </Text>
              )}
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
            {CARDS.map(renderCard)}
            {/* ライトは新規販売終了。すでに買っている人には「取り上げられていない」ことを明示する */}
            {plan === 'lite' && (
              <Text style={s.liteNote}>{t('ご利用中のライトプランはそのまま使えます。新しくお申し込みできるのは上の2プランです。')}</Text>
            )}
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

const s = themed(() => ({
  scroll: { padding: SPACE.screen, paddingTop: 8, paddingBottom: 48 },
  h: { ...HEAD.page, color: C.ink },
  lead: { fontSize: 14, color: C.sub, marginTop: 4, marginBottom: 14 },
  // 広告を見た回数の1行（見出しの上）。事実の提示なので警告色（coral等）は使わず、
  // アクセント色で静かに置く＝責める見た目にしない
  adCount: { fontSize: 13, fontWeight: '700', color: C.accentInk, marginBottom: 6 },
  pending: { backgroundColor: C.panel, borderRadius: RADIUS.tile, padding: 24, alignItems: 'center', marginTop: 12 },
  pendingT: { color: C.sub, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  // 控えめなカード（スタンダード）: 面は素・枠線のみ
  card: { backgroundColor: C.panel, borderRadius: RADIUS.card, padding: SPACE.card, marginBottom: 12, borderWidth: 1, borderColor: C.line },
  // 主役カード（プレミアム）: グラデ縁のリング（2px）の中に、アクセントをごく薄く敷いた面
  heroWrap: { marginTop: 10, marginBottom: 12 },
  heroRing: { borderRadius: RADIUS.card + 2, padding: 2 },
  heroGlow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: RADIUS.card + 2, backgroundColor: C.teal },
  cardHero: { backgroundColor: C.accentSoft, borderRadius: RADIUS.card, padding: SPACE.card },
  badge: { position: 'absolute', top: -10, left: 14, backgroundColor: C.teal, borderRadius: RADIUS.chip, paddingHorizontal: 10, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeT: { color: '#fff', fontSize: 11, fontWeight: '800' },
  planName: { ...HEAD.sub, color: C.ink },
  // 「誰のためのプランか」の1行（社会的証明ではなく価値の言語化）
  planLead: { fontSize: 12.5, color: C.sub, marginTop: 2, marginBottom: 8 },
  planLeadHero: { color: C.accentInk, fontWeight: '700' },
  // 価格オプション行（月額/年額の同時提示。選択中はアクセント縁）
  priceOpt: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.input,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 8,
    backgroundColor: C.panel,
  },
  priceOptOn: { borderColor: C.teal, backgroundColor: rgba(C.teal, 0.06) },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: C.teal },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.teal },
  priceOptLabel: { fontSize: 14, fontWeight: '700', color: C.sub },
  priceOptPrice: { fontSize: 16, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  priceOptSub: { fontSize: 11.5, color: C.accentInk, fontWeight: '700', marginTop: 1 },
  trialNote: { fontSize: 11.5, color: C.sub, marginTop: 6, lineHeight: 16 },
  featRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  featT: { fontSize: 13.5, color: C.ink, flex: 1 },
  // CTA: 未選択カードは輪郭だけ（控えめ）、選択中だけアクセント塗り。主役はさらに一段大きく
  cta: { marginTop: 12, borderRadius: RADIUS.input, paddingVertical: 12, alignItems: 'center', backgroundColor: C.chipBg, borderWidth: 1, borderColor: C.line },
  ctaOn: { backgroundColor: C.teal, borderColor: C.teal },
  ctaHero: { paddingVertical: 14, borderRadius: RADIUS.tile },
  ctaOff: { opacity: 0.5 },
  ctaT: { fontSize: 15, fontWeight: '700', color: C.accentInk },
  ctaTOn: { color: '#fff' },
  ctaTHero: { fontSize: 16, fontWeight: '800' },
  liteNote: { fontSize: 12, color: C.sub, lineHeight: 18, marginTop: 2, marginBottom: 4 },
  link: { fontSize: 13, color: C.accentInk, fontWeight: '600' },
  legal: { fontSize: 11.5, color: C.sub, lineHeight: 17, marginTop: 20 },
}));
