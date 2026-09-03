// 栄養ランキング図鑑（食材ナビ・2026-09-03）
//
// 参考動画「◯◯が多いのは？ランキング」「たんぱく質ティアリスト」を1画面に:
//  ・タブ「ランキング」: 栄養素チップ（たんぱく質／鉄／ビタミンA・C・E／亜鉛／カルシウム／食物繊維／オメガ3／カリウム）→
//    上位10食材を横バーで並べる。「1食の目安量あたり／100gあたり」を切替。行タップでその食材の「かしこい置き換え」候補
//  ・タブ「たんぱく源」: S〜Eのティア表（減量／増量で基準を切替・content/proteinTiers.ts）。横スクロールの食材チップ。
//    直近30日に食べた食材はハイライト（logs.items の品目名を辞書に当てる）。チップタップで格付けの理由1文
//  ・遷移パラメータ ?food=品目名 があれば、先頭に「「◯◯」の置き換え候補」カードを出す
//    （トレイの量調整ポップ／記録行の長押しメニュー「置き換え候補を見る」から）
// 入口: 読み物一覧の「栄養ランキング」節（ColumnReader）・概要タブ「食事」セクションの行（changes.tsx）
// 値は日本食品標準成分表（八訂）ベースの **目安**。画面の下に必ず注記を出す。食材の善悪は言わない（smartSwap の規約）
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { C, RADIUS, SPACE, HEAD, themed, rgba } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { todayJST } from '@/lib/calc';
import { usePurpose } from '@/lib/purpose';
import { pickL10n, useRemoteContent } from '@/lib/remoteContent';
import { Chip, SegmentedControl } from '@/components/ui/Selectable';
import {
  NAV_NUTRIENTS, NUTRIENT_META, getNutrientDb, findFood, foodName, rankByNutrient, fmtAmount,
  type NavNutrient, type NutrientFood,
} from '@/content/nutrientDb';
import { swapsFor, swapsForFood, swapLine, emojiText, countText, swapKcalDelta, nutrientLabel, type Swap, type SwapMode } from '@/lib/smartSwap';
import { TIERS, tierTable, tierReason, tierOf, type Tier } from '@/content/proteinTiers';

type Tab = 'rank' | 'tiers';
type Basis = 'serving' | '100g';

function shiftDate(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** 直近30日の品目名 → 食材id の集合（ティア表の「自分が食べているもの」ハイライト）。失敗は空 */
async function fetchEatenIds(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const today = todayJST();
    const { data } = await supabase.from('logs').select('items').gte('date', shiftDate(today, -30)).lte('date', today).limit(600);
    const db = getNutrientDb();
    for (const r of (data ?? []) as { items?: unknown }[]) {
      if (!Array.isArray(r.items)) continue;
      for (const it of r.items) {
        const name = (it as { name?: unknown })?.name;
        if (typeof name !== 'string') continue;
        const f = findFood(name, db);
        if (f) out.add(f.id);
      }
    }
  } catch { /* ハイライトはおまけ。取れなければ無印 */ }
  return out;
}

/** ティアの色（S=アクセント、A=達成、B=文字、C=注意、D/E=補助）。文字は白地でAAを満たすトークンだけ */
function tierColor(tier: Tier): string {
  switch (tier) {
    case 'S': return C.accentInk;
    case 'A': return C.successInk;
    case 'B': return C.ink;
    case 'C': return C.amber;
    default: return C.sub;
  }
}

/** 置き換え候補の一覧（「🍊×4 ≒ 🫑×1」＋文＋kcal差）。無ければ「候補なし」の1行 */
function SwapList({ swaps }: { swaps: Swap[] }) {
  if (swaps.length === 0) return <Text style={s.swapNone}>{t('この栄養素で、より少ないカロリーの候補は見つかりませんでした。')}</Text>;
  return (
    <View style={{ gap: 6 }}>
      {swaps.map((sw) => {
        const delta = swapKcalDelta(sw);
        return (
          <View key={sw.to.food.id} style={s.swapItem}>
            <Text style={s.swapEmoji}>{emojiText(sw.from)} ≒ {emojiText(sw.to)}</Text>
            <Text style={s.swapLine}>{swapLine(sw)}{delta ? `（${delta}）` : ''}</Text>
            <Text style={s.swapSub}>{`${countText(sw.from)} ${sw.from.kcal}kcal → ${countText(sw.to)} ${sw.to.kcal}kcal`}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function NutrientRankScreen() {
  const params = useLocalSearchParams<{ tab?: string; nutrient?: string; food?: string }>();
  useRemoteContent();   // リモートの栄養データが届いたら組み直す
  const purpose = usePurpose();
  const mode: SwapMode = purpose === 'bulk' ? 'bulk' : 'cut';
  const [tab, setTab] = useState<Tab>(params.tab === 'tiers' ? 'tiers' : 'rank');
  const [nutrient, setNutrient] = useState<NavNutrient>(
    (NAV_NUTRIENTS as string[]).includes(String(params.nutrient)) ? (params.nutrient as NavNutrient) : 'p',
  );
  const [basis, setBasis] = useState<Basis>('serving');
  const [openId, setOpenId] = useState<string | null>(null);     // ランキングで展開中の行
  const [tierMode, setTierMode] = useState<SwapMode>(mode);
  const [pickedId, setPickedId] = useState<string | null>(null); // ティア表で選んだチップ
  const [eaten, setEaten] = useState<Set<string>>(new Set());

  useEffect(() => { fetchEatenIds().then(setEaten); }, []);
  useEffect(() => { setTierMode(mode); }, [mode]);

  // ?food= から来たときの先頭カード（その品目の置き換え候補）
  const focusFood = useMemo(() => (params.food ? findFood(String(params.food)) : null), [params.food]);
  const focusSwaps = useMemo(() => (params.food ? swapsFor(String(params.food), { mode }) : []), [params.food, mode]);

  const rows = useMemo(() => rankByNutrient(nutrient, basis, 10), [nutrient, basis]);
  const max = rows[0]?.amount ?? 1;
  const meta = NUTRIENT_META[nutrient];
  const table = useMemo(() => tierTable(tierMode), [tierMode]);
  const picked: NutrientFood | null = useMemo(() => (pickedId ? getNutrientDb().find((f) => f.id === pickedId) ?? null : null), [pickedId]);

  function toggleRow(id: string) {
    Haptics.selectionAsync().catch(() => {});
    setOpenId((cur) => (cur === id ? null : id));
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ headerShown: true, title: '', headerBackTitle: t('戻る'), headerTintColor: C.teal, headerShadowVisible: false, ...(Platform.OS === 'ios' ? { headerTransparent: true } : { headerStyle: { backgroundColor: C.bg } }) }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.scroll}>
        <Text style={s.h}>{t('栄養ランキング')}</Text>
        <Text style={s.lead}>{t('日本の一般食材 約{n}品の目安値（日本食品標準成分表 八訂ベース）。同じ栄養をより少ないカロリーで取る「かしこい置き換え」も見られます。', { n: getNutrientDb().length })}</Text>

        {/* ?food= から来たとき: その品目の置き換え候補を先頭に */}
        {params.food && (
          <View style={[s.card, s.cardFocus]}>
            <Text style={s.cardH}>{t('「{name}」の置き換え候補', { name: String(params.food) })}</Text>
            {focusFood
              ? <SwapList swaps={focusSwaps} />
              : <Text style={s.swapNone}>{t('この品目は食材の辞書に無いため、置き換え候補を出せません。')}</Text>}
          </View>
        )}

        <SegmentedControl<Tab>
          options={[{ key: 'rank', label: t('ランキング') }, { key: 'tiers', label: t('たんぱく源') }]}
          value={tab} onChange={setTab}
        />

        {tab === 'rank' ? (
          <>
            {/* 栄養素チップ（横スクロール・1つ選ぶ） */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} style={{ marginTop: 12 }}>
              {NAV_NUTRIENTS.map((k) => (
                <Chip key={k} label={pickL10n(NUTRIENT_META[k].label)} selected={nutrient === k} onPress={() => { setNutrient(k); setOpenId(null); }} />
              ))}
            </ScrollView>
            <View style={{ marginTop: 10 }}>
              <SegmentedControl<Basis>
                options={[{ key: 'serving', label: t('1食の目安量あたり') }, { key: '100g', label: t('100gあたり') }]}
                value={basis} onChange={setBasis}
              />
            </View>

            <View style={s.card}>
              <Text style={s.cardH}>{t('{x}が多い食材 TOP10', { x: pickL10n(meta.label) })}</Text>
              {rows.map((r, i) => {
                const open = openId === r.food.id;
                const pct = Math.max(0.04, r.amount / max);
                return (
                  <View key={r.food.id}>
                    <Pressable style={({ pressed }) => [s.row, pressed && { backgroundColor: C.pressed }]} onPress={() => toggleRow(r.food.id)}
                               accessibilityRole="button" accessibilityLabel={foodName(r.food)} accessibilityHint={t('置き換え候補を見る')}>
                      <Text style={s.rank}>{i + 1}</Text>
                      <Text style={s.emoji}>{r.food.emoji ?? '●'}</Text>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                          <Text style={s.name} numberOfLines={1}>{foodName(r.food)}</Text>
                          <Text style={s.amount}>{fmtAmount(nutrient, r.amount)}<Text style={s.unit}>{meta.unit}</Text></Text>
                        </View>
                        {/* 積み上げバー: 1位を満幅にした相対長。色は栄養素に関わらずアクセント（意味の色を増やさない） */}
                        <View style={s.track}><View style={[s.fill, { width: `${Math.round(pct * 100)}%` }]} /></View>
                        <Text style={s.grams}>{basis === 'serving' ? t('{g}g（{u}）', { g: r.grams, u: countText({ food: r.food, units: Math.round((r.grams / r.food.unit.g) * 2) / 2, grams: r.grams, kcal: 0 }) }) : '100g'}{`・${Math.round((r.food.per100.kcal * r.grams) / 100)}kcal`}</Text>
                      </View>
                    </Pressable>
                    {open && (
                      <View style={s.expand}>
                        <Text style={s.expandH}>{t('{x}なら、この食材の代わりに', { x: nutrientLabel(nutrient) })}</Text>
                        <SwapList swaps={swapsForFood(r.food, { nutrient, mode })} />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <>
            {/* たんぱく源ティア表（減量／増量で基準を切替。既定は本人の目的） */}
            <View style={{ marginTop: 12 }}>
              <SegmentedControl<SwapMode>
                options={[{ key: 'cut', label: t('減量の基準') }, { key: 'bulk', label: t('増量の基準') }]}
                value={tierMode} onChange={(v) => { setTierMode(v); setPickedId(null); }}
              />
            </View>
            <Text style={s.tierNote}>
              {tierMode === 'cut'
                ? t('たんぱく質1gあたりのkcal・脂質の割合・つい量が増えやすいか・手間・価格帯で格付け。')
                : t('100gあたりのたんぱく質とkcal密度・食べやすさ・手間・価格帯で格付け。')}
              {eaten.size > 0 ? ` ${t('色つきのチップは直近30日に食べたもの。')}` : ''}
            </Text>
            <View style={s.card}>
              {TIERS.map((tier) => (
                <View key={tier} style={s.tierRow}>
                  <View style={[s.tierBadge, { borderColor: tierColor(tier) }]}><Text style={[s.tierBadgeT, { color: tierColor(tier) }]}>{tier}</Text></View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tierChips} style={{ flex: 1 }}>
                    {table[tier].length === 0 && <Text style={s.tierEmpty}>—</Text>}
                    {table[tier].map((f) => {
                      const ate = eaten.has(f.id);
                      const on = pickedId === f.id;
                      return (
                        <Pressable key={f.id} style={[s.foodChip, ate && s.foodChipAte, on && s.foodChipOn]}
                                   onPress={() => { Haptics.selectionAsync().catch(() => {}); setPickedId((cur) => (cur === f.id ? null : f.id)); }}
                                   accessibilityRole="button" accessibilityLabel={foodName(f)}>
                          <Text style={[s.foodChipT, (ate || on) && { color: C.accentInk }]} numberOfLines={1}>{f.emoji ?? '●'} {foodName(f)}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ))}
              {picked && (
                <View style={s.expand}>
                  <Text style={s.expandH}>{`${picked.emoji ?? '●'} ${foodName(picked)}（${tierOf(picked, tierMode)}）`}</Text>
                  <Text style={s.reason}>{tierReason(picked, tierMode)}</Text>
                  <Text style={s.swapSub}>{t('100gあたり {k}kcal・P{p}g・F{f}g・1食の目安 {s}g', { k: Math.round(picked.per100.kcal), p: picked.per100.p, f: picked.per100.f, s: picked.serving })}</Text>
                </View>
              )}
            </View>
          </>
        )}

        <Text style={s.foot}>{t('数値は目安です。品種・部位・調理で20〜30%は変わります。格付けは「同じたんぱく質量あたりのカロリー」を軸にした並びで、食材の善悪ではありません。')}</Text>
      </ScrollView>
    </View>
  );
}

const s = themed(() => ({
  scroll: { padding: SPACE.screen, paddingTop: 8, paddingBottom: 48 },
  h: { ...HEAD.page, color: C.ink, marginBottom: 4 },
  lead: { fontSize: 12.5, color: C.sub, lineHeight: 18, marginBottom: 14 },
  chips: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  card: {
    backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
    borderRadius: RADIUS.card, padding: SPACE.card, marginTop: 12,
    shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  cardFocus: { borderColor: C.accentBorder, borderWidth: 1.5, backgroundColor: C.accentSoft, marginTop: 0, marginBottom: 12 },
  cardH: { ...HEAD.card, color: C.ink, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderRadius: RADIUS.input },
  rank: { width: 20, fontSize: 13, fontWeight: '800', color: C.faint, fontVariant: ['tabular-nums'], textAlign: 'center' },
  emoji: { fontSize: 20, width: 26, textAlign: 'center' },
  name: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: C.ink },
  amount: { fontSize: 14, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 11, fontWeight: '700', color: C.sub },
  track: { height: 8, borderRadius: 4, backgroundColor: C.track, marginTop: 5, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: C.teal },
  grams: { fontSize: 11, color: C.faint, marginTop: 3, fontVariant: ['tabular-nums'] },
  expand: { backgroundColor: C.chipBg, borderRadius: RADIUS.panel, padding: 12, marginTop: 4, marginBottom: 6 },
  expandH: { fontSize: 12.5, fontWeight: '800', color: C.sub, marginBottom: 6 },
  swapItem: { backgroundColor: C.panel, borderRadius: RADIUS.input, paddingHorizontal: 10, paddingVertical: 8 },
  swapEmoji: { fontSize: 15, fontWeight: '800', color: C.ink },
  swapLine: { fontSize: 13, color: C.ink, lineHeight: 19, marginTop: 2 },
  swapSub: { fontSize: 11.5, color: C.sub, marginTop: 3, fontVariant: ['tabular-nums'] },
  swapNone: { fontSize: 12.5, color: C.sub, lineHeight: 18 },
  tierNote: { fontSize: 12, color: C.sub, lineHeight: 17, marginTop: 8 },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: C.line },
  tierBadge: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel },
  tierBadgeT: { fontSize: 14, fontWeight: '900' },
  tierChips: { flexDirection: 'row', gap: 6, paddingRight: 8 },
  tierEmpty: { fontSize: 13, color: C.faint, paddingVertical: 8 },
  foodChip: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: RADIUS.chip, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.chipBg, maxWidth: 190 },
  foodChipAte: { borderColor: C.accentBorder, backgroundColor: C.accentBadge },
  foodChipOn: { borderColor: C.teal, backgroundColor: rgba(C.teal, 0.14) },
  foodChipT: { fontSize: 12.5, fontWeight: '700', color: C.sub },
  reason: { fontSize: 13, color: C.ink, lineHeight: 19 },
  foot: { fontSize: 11.5, color: C.faint, lineHeight: 17, marginTop: 14 },
}));
