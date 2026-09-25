// 栄養ランキング（2026-09-25 改修・熊田さん「一般のランキングではなく、実際に記録した自分の摂取で見たい」）
//
// 3つのタブ:
//  ・「自分の摂取」（既定）: 栄養素を1つ選ぶと、直近30日に **自分が記録した食事** から、その栄養素を運んだ食材を
//    「1日あたりの平均量」で並べる（たまご 18g/日・鶏むね肉 25g/日 …）。分母は記録のある日数（lib/nutrientIntake.ts）。
//  ・「不足栄養素」: 30日の1日平均を **日本人の食事摂取基準（2025年版）** の値（性別×年齢、たんぱく質は体重×g/kg、
//    脂質・炭水化物は維持カロリーの %E）と比べ、少なめの栄養素から順に並べる。行を開くと「おすすめ食材」
//    （食材図鑑 content/nutrientDb.ts から。食べたことのある食材が先頭）。基準は content/dri2025.ts。
//  ・「食材図鑑」: 旧「ランキング」タブ（一般食材の TOP10 と「かしこい置き換え」）。?food= で来たときの既定タブ。
//  旧「たんぱく源」ティア表のタブは廃止（content/proteinTiers.ts は法則・相談で使うので残す。?tab=tiers は既定タブに落ちる）。
//
// 遷移パラメータ: ?food=品目名（記録行の長押し／トレイの「かしこい置き換え」→ 図鑑タブ＋先頭に置き換え候補カード）
//                ?tab=mine|gap|db  ?nutrient=図鑑の軸
// 入口: 読み物一覧（ColumnReader）・概要タブ「食事の傾向」の行（changes.tsx）・食事タブの記録行（log.tsx）
//
// 言い方の規約（docs/NUTRIENTS.md §1.2）: 不足に赤を使わない・病名を出さない・サプリや用量を言わない・食材の善悪を言わない。
// 判定語は「足りている／やや少なめ／少なめ／超えている」の4つだけ。すべて「目安」であることをフッターに常設する。
import { useEffect, useMemo, useState } from 'react';
import { useThemeRefresh } from '@/lib/theme';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, RADIUS, SPACE, HEAD, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { todayJST, mifflinBMR, LIFE_FACTOR_DEFAULT } from '@/lib/calc';
import { addDays } from '@/lib/goal';
import { usePurpose, purposeOf } from '@/lib/purpose';
import { pickL10n, useRemoteContent } from '@/lib/remoteContent';
import { Chip, SegmentedControl } from '@/components/ui/Selectable';
import {
  NAV_NUTRIENTS, NUTRIENT_META as NAV_META, getNutrientDb, findFood, foodName, rankByNutrient, fmtAmount as fmtNav,
  type NavNutrient,
} from '@/content/nutrientDb';
import { swapsFor, swapsForFood, swapLine, emojiText, countText, swapKcalDelta, nutrientLabel, type Swap, type SwapMode } from '@/lib/smartSwap';
import { useStackHeader } from '@/lib/navHeader';
import {
  DRI_EDITION, AGE_BAND_LABEL, REF_KIND_LABEL, REF_KEYS, resolveAllReferences,
  type NutrientRef, type RefKey, type RefProfile,
} from '@/content/dri2025';
import {
  WINDOW_DAYS, INTAKE_GROUPS, aggregateIntake, perDayAverage, coverageOf, rankFoods, buildGapRows, suggestFoods, eatenFoodIds,
  intakeMeta, fmtAmount, fmtRef, fmtPercent, VERDICT_LABEL,
  type IntakeAgg, type IntakeGroup, type IntakeKey, type GapRow, type Verdict,
} from '@/lib/nutrientIntake';

type Tab = 'mine' | 'gap' | 'db';
type Basis = 'serving' | '100g';

/** 鉄の基準（女性・50歳未満）の「月経あり／なし」。本人の身体情報なのでサインアウトで消える（lib/signOutCleanup.ts） */
const MENSES_KEY = 'bl-nutri-menses';

type ProfileRow = { sex?: string | null; height_cm?: number | null; age?: number | null; init_weight?: number | null; life_factor?: number | null };

type Loaded = {
  agg: IntakeAgg;
  profile: RefProfile;
  /** プロフィールに性別・年齢があるか（無ければ参考値の注記） */
  hasProfile: boolean;
};

/** 直近30日の記録・プロフィール・目標・最新体重を1回で読む。失敗しても空の集計で画面は成立する */
async function loadAll(menses: boolean | null, purposeP: number | null): Promise<Loaded> {
  const today = todayJST();
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const [logRes, profRes, goalRes, wRes] = await Promise.all([
    supabase.from('logs').select('date,items').gte('date', from).lte('date', today).not('items', 'is', null).limit(2000),
    supabase.from('profiles').select('sex,height_cm,age,init_weight,life_factor').maybeSingle(),
    supabase.from('goals').select('protein_per_kg').maybeSingle(),
    supabase.from('entries').select('weight').not('weight', 'is', null).order('date', { ascending: false }).limit(1),
  ]);
  const rows = Array.isArray(logRes.data) ? (logRes.data as { date: string; items: unknown }[]) : [];
  const agg = aggregateIntake(rows);
  const prof = (profRes.data ?? null) as ProfileRow | null;
  const sex = prof?.sex === 'male' || prof?.sex === 'female' ? prof.sex : null;
  const ageN = Number(prof?.age);
  const age = Number.isFinite(ageN) && ageN > 0 ? ageN : null;
  const latest = Array.isArray(wRes.data) && wRes.data.length > 0 ? Number((wRes.data[0] as { weight?: number }).weight) : NaN;
  const initW = Number(prof?.init_weight);
  const weightKg = Number.isFinite(latest) && latest > 0 ? latest : Number.isFinite(initW) && initW > 0 ? initW : null;
  const height = Number(prof?.height_cm);
  // 維持カロリー（BMR×生活係数）。%E の目標量を g に換算する分母。運動ぶんは日によって違うので入れない
  const targetKcal = sex && age != null && weightKg != null && Number.isFinite(height) && height > 0
    ? Math.round(mifflinBMR(sex, weightKg, height, age) * (Number(prof?.life_factor) || LIFE_FACTOR_DEFAULT))
    : null;
  const goalP = Number((goalRes.data as { protein_per_kg?: number | null } | null)?.protein_per_kg);
  const proteinPerKg = Number.isFinite(goalP) && goalP > 0 ? goalP : purposeP;
  return { agg, profile: { sex, age, weightKg, targetKcal, proteinPerKg, menstruating: menses }, hasProfile: sex != null && age != null };
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

/** 判定語の色。不足に赤は使わない（少なめ＝補助色、超えている＝注意色、足りている＝達成色） */
function verdictColor(v: Verdict): string {
  switch (v) {
    case 'ok': return C.successInk;
    case 'over': return C.amber;
    case 'low': case 'slightlyLow': return C.sub;
    default: return C.faint;
  }
}

/** 基準の1行（「基準 10.5mg（推奨量）」「基準 20〜30g（目標量（範囲））」「基準 7.5g未満（目標量（上限））」） */
function refText(ref: NutrientRef): string {
  const kind = t(REF_KIND_LABEL[ref.kind]);
  if (ref.kind === 'dg_range' && ref.upper != null) return t('基準 {a}〜{b}{u}（{kind}）', { a: fmtRef(ref.target), b: fmtRef(ref.upper), u: ref.unit, kind });
  if (ref.kind === 'dg_upper') return t('基準 {v}{u}未満（{kind}）', { v: fmtRef(ref.target), u: ref.unit, kind });
  if (ref.kind === 'app' && ref.perKg != null) return t('基準 {v}{u}（体重×{x}g/kg）', { v: fmtRef(ref.target), u: ref.unit, x: ref.perKg });
  return t('基準 {v}{u}（{kind}）', { v: fmtRef(ref.target), u: ref.unit, kind });
}

export default function NutrientRankScreen() {
  const stackHeader = useStackHeader();   // 戻るラベルは ?from= で決まる（lib/navHeader.ts）
  useThemeRefresh(); // テーマ変更で再描画（再マウントはしない・lib/theme.ts）
  const params = useLocalSearchParams<{ tab?: string; nutrient?: string; food?: string }>();
  useRemoteContent();   // リモートの栄養データが届いたら組み直す
  const purpose = usePurpose();
  const mode: SwapMode = purpose === 'bulk' ? 'bulk' : 'cut';
  const purposeP = purposeOf(purpose)?.p ?? null;

  // ?food= があれば図鑑（置き換え候補を見に来ている）。?tab=db|rank も図鑑。gap は不足栄養素。それ以外（tiers を含む）は既定
  const initialTab: Tab = params.food || params.tab === 'db' || params.tab === 'rank' ? 'db' : params.tab === 'gap' ? 'gap' : 'mine';
  const [tab, setTab] = useState<Tab>(initialTab);

  // ---- 自分の記録（30日）とプロフィール ----
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [menses, setMenses] = useState<boolean | null>(null);
  const [mensesReady, setMensesReady] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(MENSES_KEY)
      .then((v) => setMenses(v === '1' ? true : v === '0' ? false : null))
      .catch(() => {})
      .finally(() => setMensesReady(true));
  }, []);
  useEffect(() => {
    if (!mensesReady) return;
    let alive = true;
    loadAll(menses, purposeP).then((r) => { if (alive) setLoaded(r); }).catch(() => { if (alive) setLoaded({ agg: aggregateIntake([]), profile: { sex: null, age: null, weightKg: null, targetKcal: null }, hasProfile: false }); });
    return () => { alive = false; };
  }, [mensesReady, menses, purposeP]);

  function pickMenses(v: boolean) {
    Haptics.selectionAsync().catch(() => {});
    setMenses(v);
    AsyncStorage.setItem(MENSES_KEY, v ? '1' : '0').catch(() => {});
  }

  const agg = loaded?.agg ?? null;
  const refs = useMemo(() => (loaded ? resolveAllReferences(loaded.profile) : null), [loaded]);
  const eaten = useMemo(() => (agg ? eatenFoodIds(agg.eatenNames) : new Set<string>()), [agg]);

  // ---- 自分の摂取タブ ----
  const [group, setGroup] = useState<IntakeGroup>('main');
  const [mineKey, setMineKey] = useState<IntakeKey>('p');
  const [showAll, setShowAll] = useState(false);

  // ---- 不足栄養素タブ ----
  const [openGap, setOpenGap] = useState<RefKey | null>(null);
  const gapRows = useMemo(() => (agg && refs ? buildGapRows(agg, refs, REF_KEYS) : []), [agg, refs]);

  // ---- 食材図鑑タブ（旧ランキング） ----
  const [navKey, setNavKey] = useState<NavNutrient>(
    (NAV_NUTRIENTS as string[]).includes(String(params.nutrient)) ? (params.nutrient as NavNutrient) : 'p',
  );
  const [basis, setBasis] = useState<Basis>('serving');
  const [openId, setOpenId] = useState<string | null>(null);
  const focusFood = useMemo(() => (params.food ? findFood(String(params.food)) : null), [params.food]);
  const focusSwaps = useMemo(() => (params.food ? swapsFor(String(params.food), { mode }) : []), [params.food, mode]);
  const navRows = useMemo(() => rankByNutrient(navKey, basis, 10), [navKey, basis]);
  const navMax = navRows[0]?.amount ?? 1;
  const navMeta = NAV_META[navKey];

  function toggleRow(id: string) {
    Haptics.selectionAsync().catch(() => {});
    setOpenId((cur) => (cur === id ? null : id));
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={stackHeader} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.scroll}>
        <Text style={s.h}>{t('栄養ランキング')}</Text>
        <Text style={s.lead}>{t('直近{d}日の自分の記録から、栄養素ごとの摂取ランキングと、食事摂取基準に対して少なめの栄養素とおすすめ食材。一般食材の図鑑も見られます。', { d: WINDOW_DAYS })}</Text>

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
          options={[{ key: 'mine', label: t('自分の摂取') }, { key: 'gap', label: t('不足栄養素') }, { key: 'db', label: t('食材図鑑') }]}
          value={tab} onChange={setTab}
        />

        {tab === 'mine' && (
          <MineTab agg={agg} refs={refs} group={group} setGroup={setGroup} mineKey={mineKey} setMineKey={(k) => { setMineKey(k); setShowAll(false); }}
                   showAll={showAll} setShowAll={setShowAll} loading={!loaded} />
        )}

        {tab === 'gap' && (
          <GapTab loaded={loaded} rows={gapRows} refs={refs} eaten={eaten} open={openGap}
                  onToggle={(k) => { Haptics.selectionAsync().catch(() => {}); setOpenGap((cur) => (cur === k ? null : k)); }}
                  menses={menses} onMenses={pickMenses} />
        )}

        {tab === 'db' && (
          <>
            {/* 栄養素チップ（折り返し・1つ選ぶ。横スクロールは使わない） */}
            <View style={s.wrap}>
              {NAV_NUTRIENTS.map((k) => (
                <Chip key={k} label={pickL10n(NAV_META[k].label)} selected={navKey === k} onPress={() => { setNavKey(k); setOpenId(null); }} />
              ))}
            </View>
            <View style={{ marginTop: 10 }}>
              <SegmentedControl<Basis>
                options={[{ key: 'serving', label: t('1食の目安量あたり') }, { key: '100g', label: t('100gあたり') }]}
                value={basis} onChange={setBasis}
              />
            </View>

            <View style={s.card}>
              <Text style={s.cardH}>{t('{x}が多い食材 TOP10', { x: pickL10n(navMeta.label) })}</Text>
              <Text style={s.note}>{t('日本の一般食材 約{n}品の目安値（日本食品標準成分表 八訂ベース）。', { n: getNutrientDb().length })}</Text>
              {navRows.map((r, i) => {
                const open = openId === r.food.id;
                const pct = Math.max(0.04, r.amount / navMax);
                return (
                  <View key={r.food.id}>
                    <Pressable style={({ pressed }) => [s.row, pressed && { backgroundColor: C.pressed }]} onPress={() => toggleRow(r.food.id)}
                               accessibilityRole="button" accessibilityLabel={foodName(r.food)} accessibilityHint={t('置き換え候補を見る')}>
                      <Text style={s.rank}>{i + 1}</Text>
                      <Text style={s.emoji}>{r.food.emoji ?? '●'}</Text>
                      <View style={{ flex: 1 }}>
                        <View style={s.rowHead}>
                          <Text style={s.name} numberOfLines={1}>{foodName(r.food)}{eaten.has(r.food.id) ? ` ${t('（食べたことあり）')}` : ''}</Text>
                          <Text style={s.amount}>{fmtNav(navKey, r.amount)}<Text style={s.unit}>{navMeta.unit}</Text></Text>
                        </View>
                        {/* 積み上げバー: 1位を満幅にした相対長。色は栄養素に関わらずアクセント（意味の色を増やさない） */}
                        <View style={s.track}><View style={[s.fill, { width: `${Math.round(pct * 100)}%` }]} /></View>
                        <Text style={s.grams}>{basis === 'serving' ? t('{g}g（{u}）', { g: r.grams, u: countText({ food: r.food, units: Math.round((r.grams / r.food.unit.g) * 2) / 2, grams: r.grams, kcal: 0 }) }) : '100g'}{`・${Math.round((r.food.per100.kcal * r.grams) / 100)}kcal`}</Text>
                      </View>
                    </Pressable>
                    {open && (
                      <View style={s.expand}>
                        <Text style={s.expandH}>{t('{x}なら、この食材の代わりに', { x: nutrientLabel(navKey) })}</Text>
                        <SwapList swaps={swapsForFood(r.food, { nutrient: navKey, mode })} />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
            <Text style={s.foot}>{t('数値は目安です。品種・部位・調理で20〜30%は変わります。置き換えは「同じ栄養素量あたりのカロリー」で並べたもので、食材の善悪ではありません。')}</Text>
          </>
        )}

        <Text style={s.foot}>{t('摂取量は記録した食事の AI 推定値と食品成分表に基づく目安で、正確性を保証するものではありません。一般的な健康維持を目的とし、疾病の診断・治療・予防を目的としていません。妊娠・授乳中や治療中の方は医療者にご相談ください。')}</Text>
      </ScrollView>
    </View>
  );
}

// ===== 自分の摂取タブ =====
function MineTab({ agg, refs, group, setGroup, mineKey, setMineKey, showAll, setShowAll, loading }: {
  agg: IntakeAgg | null; refs: Record<RefKey, NutrientRef | null> | null;
  group: IntakeGroup; setGroup: (g: IntakeGroup) => void;
  mineKey: IntakeKey; setMineKey: (k: IntakeKey) => void;
  showAll: boolean; setShowAll: (v: boolean) => void; loading: boolean;
}) {
  const meta = intakeMeta(mineKey);
  const avg = agg ? perDayAverage(agg, mineKey) : null;
  const cov = agg ? coverageOf(agg, mineKey) : { known: 0, items: 0 };
  const ref = refs && mineKey !== 'kcal' ? refs[mineKey] : null;
  const ranked = useMemo(() => (agg ? rankFoods(agg, mineKey, showAll ? 30 : 10) : []), [agg, mineKey, showAll]);
  const totalRanked = agg ? rankFoods(agg, mineKey, 1000).length : 0;
  const top = ranked[0]?.perDay ?? 1;
  const groups: { key: IntakeGroup; label: string }[] = [
    { key: 'main', label: t('主要') }, { key: 'vitamin', label: t('ビタミン') }, { key: 'mineral', label: t('ミネラル') },
  ];
  return (
    <>
      <View style={[s.wrap, { marginTop: 12 }]}>
        {groups.map((g) => <Chip key={g.key} label={g.label} tone="ink" selected={group === g.key} onPress={() => setGroup(g.key)} />)}
      </View>
      <View style={[s.wrap, { marginTop: 8 }]}>
        {INTAKE_GROUPS[group].map((k) => (
          <Chip key={k} label={t(intakeMeta(k).label)} selected={mineKey === k} onPress={() => setMineKey(k)} />
        ))}
      </View>

      <View style={s.card}>
        <Text style={s.cardH}>{t('{x}の摂取（直近{d}日）', { x: t(meta.label), d: WINDOW_DAYS })}</Text>
        {loading ? (
          <ActivityIndicator color={C.teal} style={{ marginVertical: 16 }} />
        ) : !agg || agg.days === 0 ? (
          <Text style={s.empty}>{t('直近{d}日に品目のある食事の記録がありません。食事タブで記録すると、ここに自分の摂取ランキングが出ます。', { d: WINDOW_DAYS })}</Text>
        ) : (
          <>
            <View style={s.bigRow}>
              <Text style={s.big}>{avg == null ? '—' : fmtAmount(mineKey, avg)}<Text style={s.bigUnit}>{avg == null ? '' : `${meta.unit}/${t('日')}`}</Text></Text>
              <Text style={s.bigSub}>{t('記録のある{n}日の平均', { n: agg.days })}</Text>
            </View>
            {ref && avg != null && (
              <Text style={s.refLine}>{refText(ref)}{`・${fmtPercent(avg / ref.target)}`}</Text>
            )}
            <Text style={s.note}>
              {t('値のある品目 {k}/{n}', { k: cov.known, n: cov.items })}
              {cov.known < cov.items ? `・${t('値の無い品目は不明として平均に入れていません（2026-09-24 より前に登録したマイ食品は PFC だけのことがあります）。')}` : ''}
            </Text>
            {avg == null ? (
              <Text style={s.empty}>{t('この栄養素の値がある品目がまだありません。AI 解析で記録した食事から貯まっていきます。')}</Text>
            ) : (
              <>
                <Text style={s.subHead}>{t('{x}を運んだ食材（1日あたりの平均）', { x: t(meta.label) })}</Text>
                {ranked.map((r, i) => {
                  const pct = Math.max(0.04, r.perDay / (top || 1));
                  return (
                    <View key={r.food.key} style={s.row}>
                      <Text style={s.rank}>{i + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <View style={s.rowHead}>
                          <Text style={s.name} numberOfLines={1}>{r.food.name}</Text>
                          <Text style={s.amount}>{fmtAmount(mineKey, r.perDay)}<Text style={s.unit}>{`${meta.unit}/${t('日')}`}</Text></Text>
                        </View>
                        <View style={s.track}><View style={[s.fill, { width: `${Math.round(pct * 100)}%` }]} /></View>
                        <Text style={s.grams}>{t('{t}回・{d}日・合計 {v}{u}', { t: r.food.times, d: r.food.days, v: fmtAmount(mineKey, r.total), u: meta.unit })}</Text>
                      </View>
                    </View>
                  );
                })}
                {totalRanked > 10 && (
                  <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setShowAll(!showAll); }} style={s.moreBtn}
                             accessibilityRole="button" accessibilityLabel={showAll ? t('上位10件だけ表示') : t('もっと見る')}>
                    <Text style={s.moreT}>{showAll ? t('上位10件だけ表示') : t('もっと見る（あと{n}件）', { n: Math.min(20, totalRanked - 10) })}</Text>
                  </Pressable>
                )}
              </>
            )}
          </>
        )}
      </View>
    </>
  );
}

// ===== 不足栄養素タブ =====
function GapTab({ loaded, rows, refs, eaten, open, onToggle, menses, onMenses }: {
  loaded: Loaded | null; rows: GapRow[]; refs: Record<RefKey, NutrientRef | null> | null; eaten: Set<string>;
  open: RefKey | null; onToggle: (k: RefKey) => void;
  menses: boolean | null; onMenses: (v: boolean) => void;
}) {
  if (!loaded || !refs) return <View style={s.card}><ActivityIndicator color={C.teal} style={{ marginVertical: 16 }} /></View>;
  const { agg, profile, hasProfile } = loaded;
  const sample = refs.ca ?? refs.vc;   // 解決に使った性別・年齢区分（どのキーでも同じ）
  const sexLabel = sample?.sexUsed === 'male' ? t('男性') : t('女性');
  const bandLabel = sample ? t(AGE_BAND_LABEL[sample.bandUsed]) : '';
  const feRef = refs.fe;
  const counts = { low: 0, slightlyLow: 0, over: 0, ok: 0 };
  for (const r of rows) if (r.verdict in counts) counts[r.verdict as keyof typeof counts]++;

  return (
    <>
      <View style={s.card}>
        <Text style={s.cardH}>{t('基準の決め方')}</Text>
        <Text style={s.body}>
          {hasProfile
            ? t('{sex}・{band}の基準（{edition}）。', { sex: sexLabel, band: bandLabel, edition: t(DRI_EDITION) })
            : t('プロフィールに性別・年齢が無いため、{sex}・{band}の値を参考値として使っています。設定すると正確になります。', { sex: sexLabel, band: bandLabel })}
          {profile.weightKg != null
            ? ` ${t('たんぱく質は体重{w}kg×{x}g/kg。', { w: fmtRef(profile.weightKg), x: refs.p?.perKg ?? '' })}`
            : ` ${t('体重の記録が無いため、たんぱく質は推奨量で比べています。')}`}
          {profile.targetKcal != null
            ? ` ${t('脂質・炭水化物・飽和脂肪酸は維持カロリー約{k}kcalに対する%エネルギーの目標量を g に換算。', { k: fmtAmount('kcal', profile.targetKcal) })}`
            : ` ${t('身長・年齢・体重が揃わないため、脂質・炭水化物・飽和脂肪酸の基準は出せません。')}`}
        </Text>
        {feRef?.menses != null && (
          <View style={{ marginTop: 10 }}>
            <Text style={s.note}>{t('鉄の基準（女性・50歳未満は「月経あり」の推奨量が既定）')}</Text>
            <View style={[s.wrap, { marginTop: 6 }]}>
              <Chip label={t('月経あり')} selected={feRef.menses} onPress={() => onMenses(true)} />
              <Chip label={t('月経なし')} selected={!feRef.menses} onPress={() => onMenses(false)} />
            </View>
            {menses == null && <Text style={s.note}>{t('未設定のため「あり」で計算しています。')}</Text>}
          </View>
        )}
      </View>

      {agg.days === 0 ? (
        <View style={s.card}>
          <Text style={s.empty}>{t('直近{d}日に品目のある食事の記録がありません。食事タブで記録すると、ここに比較が出ます。', { d: WINDOW_DAYS })}</Text>
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.cardH}>{t('直近{d}日の平均と基準', { d: WINDOW_DAYS })}</Text>
          <Text style={s.note}>
            {t('記録のある{n}日の平均。', { n: agg.days })}
            {` ${t('少なめ {a}・やや少なめ {b}・超えている {c}・足りている {d}', { a: counts.low, b: counts.slightlyLow, c: counts.over, d: counts.ok })}`}
          </Text>
          {rows.map((r) => <GapRowView key={r.key} row={r} open={open === r.key} onToggle={() => onToggle(r.key)} eaten={eaten} />)}
        </View>
      )}
    </>
  );
}

function GapRowView({ row, open, onToggle, eaten }: { row: GapRow; open: boolean; onToggle: () => void; eaten: Set<string> }) {
  const meta = intakeMeta(row.key);
  const color = verdictColor(row.verdict);
  const deficient = row.verdict === 'low' || row.verdict === 'slightlyLow';
  const suggestions = useMemo(() => (open && deficient ? suggestFoods(row.key, eaten) : []), [open, deficient, row.key, eaten]);
  const fill = row.ratio == null ? 0 : Math.min(1, row.ratio);
  const fillColor = row.verdict === 'ok' ? C.successInk : row.verdict === 'over' ? C.amber : C.teal;
  const expandable = deficient || row.verdict === 'over';
  return (
    <View>
      <Pressable style={({ pressed }) => [s.gapRow, pressed && expandable && { backgroundColor: C.pressed }]} onPress={expandable ? onToggle : undefined}
                 accessibilityRole={expandable ? 'button' : undefined} accessibilityLabel={`${t(meta.label)} ${t(VERDICT_LABEL[row.verdict])}`}>
        <View style={s.rowHead}>
          <Text style={s.name} numberOfLines={1}>{t(meta.label)}</Text>
          <Text style={[s.verdict, { color }]}>{t(VERDICT_LABEL[row.verdict])}{row.verdict === 'over' ? ' ▲' : ''}</Text>
        </View>
        <View style={s.rowHead}>
          <Text style={s.gapNums} numberOfLines={2}>
            {row.avg == null ? t('自分 —') : t('自分 {v}{u}/日', { v: fmtAmount(row.key, row.avg), u: meta.unit })}
            {row.ref ? `・${refText(row.ref)}` : row.key === 'sug' ? `・${t('2025年版に基準なし（記録のみ）')}` : ''}
          </Text>
          <Text style={[s.pct, { color }]}>{fmtPercent(row.ratio)}</Text>
        </View>
        {row.ref && row.avg != null && (
          <View style={s.track}><View style={[s.fill, { width: `${Math.round(fill * 100)}%`, backgroundColor: fillColor }]} /></View>
        )}
        {row.ref?.approximate && <Text style={s.grams}>{t('参考値（性別・年齢が未設定、または18歳未満）')}</Text>}
        {row.ref?.key === 'fe' && row.ref.menses != null && <Text style={s.grams}>{row.ref.menses ? t('月経ありの推奨量') : t('月経なしの推奨量')}</Text>}
      </Pressable>
      {open && expandable && (
        <View style={s.expand}>
          <Text style={s.grams}>
            {t('値のある品目 {k}/{n}', { k: row.known, n: row.items })}
            {row.ref?.ear != null ? `・${t('推定平均必要量 {v}{u}', { v: fmtRef(row.ref.ear), u: meta.unit })}` : ''}
          </Text>
          {deficient ? (
            <>
              <Text style={s.expandH}>{t('おすすめ食材（食べたことのあるものを先に）')}</Text>
              {suggestions.length === 0
                ? <Text style={s.swapNone}>{t('この栄養素の候補はまだ用意していません。')}</Text>
                : suggestions.map((sg) => (
                  <View key={sg.food.id} style={s.sugRow}>
                    <Text style={s.emoji}>{sg.food.emoji ?? '●'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.sugName}>{foodName(sg.food)}{sg.eaten ? ` ${t('（食べたことあり）')}` : ''}</Text>
                      <Text style={s.grams}>
                        {sg.perServing != null
                          ? t('1食の目安 {g}gで {v}{u}', { g: sg.food.serving, v: fmtAmount(row.key, sg.perServing), u: meta.unit })
                          : t('1食の目安 {g}g', { g: sg.food.serving })}
                        {sg.liver ? `・${t('ビタミンAが多いので週1回程度が目安')}` : ''}
                      </Text>
                    </View>
                  </View>
                ))}
              {row.key === 'k' && <Text style={s.grams}>{t('腎臓の治療中の方は医師の指示を優先してください。')}</Text>}
            </>
          ) : (
            <>
              <Text style={s.expandH}>{t('抑えるなら')}</Text>
              <Text style={s.body}>
                {row.key === 'salt'
                  ? t('汁物を半分にする・加工肉や練り製品、即席麺の回数を減らす・野菜と果物を合わせる、のどれか1つから。')
                  : row.key === 'satfat'
                    ? t('脂身の多い肉やバター、菓子類の回数を見直す。魚・大豆製品・植物油に置き換えると飽和脂肪酸は下がります。')
                    : t('範囲の上を超えています。全体のカロリーと合わせて見直すと整いやすいです。')}
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const s = themed(() => ({
  scroll: { padding: SPACE.screen, paddingTop: 8, paddingBottom: 48 },
  h: { ...HEAD.page, color: C.ink, marginBottom: 4 },
  lead: { fontSize: 12.5, color: C.sub, lineHeight: 18, marginBottom: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  card: {
    backgroundColor: C.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
    borderRadius: RADIUS.card, padding: SPACE.card, marginTop: 12,
    shadowColor: C.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2,
  },
  cardFocus: { borderColor: C.accentBorder, borderWidth: 1.5, backgroundColor: C.accentSoft, marginTop: 0, marginBottom: 12 },
  cardH: { ...HEAD.card, color: C.ink, marginBottom: 8 },
  subHead: { fontSize: 12.5, fontWeight: '800', color: C.sub, marginTop: 12, marginBottom: 2, lineHeight: 17 },
  body: { fontSize: 13, color: C.ink, lineHeight: 19 },
  note: { fontSize: 11.5, color: C.faint, lineHeight: 16, marginTop: 4 },
  empty: { fontSize: 13, color: C.sub, lineHeight: 19, marginTop: 6 },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 2 },
  big: { fontSize: 28, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], lineHeight: 36 },
  bigUnit: { fontSize: 13, fontWeight: '700', color: C.sub },
  bigSub: { fontSize: 12, color: C.sub, lineHeight: 17, flexShrink: 1, textAlign: 'right' },
  refLine: { fontSize: 12.5, color: C.ink, lineHeight: 18, marginTop: 4, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderRadius: RADIUS.input },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  rank: { width: 20, fontSize: 13, fontWeight: '800', color: C.faint, fontVariant: ['tabular-nums'], textAlign: 'center' },
  emoji: { fontSize: 20, width: 26, textAlign: 'center' },
  name: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: C.ink },
  amount: { fontSize: 14, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 11, fontWeight: '700', color: C.sub },
  track: { height: 8, borderRadius: 4, backgroundColor: C.track, marginTop: 5, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: C.teal },
  grams: { fontSize: 11, color: C.faint, marginTop: 3, lineHeight: 15, fontVariant: ['tabular-nums'] },
  moreBtn: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  moreT: { fontSize: 13, fontWeight: '700', color: C.accentInk },
  gapRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, borderRadius: RADIUS.input },
  gapNums: { flexShrink: 1, fontSize: 12, color: C.sub, lineHeight: 17, marginTop: 2, fontVariant: ['tabular-nums'] },
  verdict: { fontSize: 12.5, fontWeight: '800' },
  pct: { fontSize: 12.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  expand: { backgroundColor: C.chipBg, borderRadius: RADIUS.panel, padding: 12, marginTop: 4, marginBottom: 6 },
  expandH: { fontSize: 12.5, fontWeight: '800', color: C.sub, marginTop: 6, marginBottom: 6, lineHeight: 17 },
  sugRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  sugName: { fontSize: 13, fontWeight: '700', color: C.ink, lineHeight: 18 },
  swapItem: { backgroundColor: C.panel, borderRadius: RADIUS.input, paddingHorizontal: 10, paddingVertical: 8 },
  swapEmoji: { fontSize: 15, fontWeight: '800', color: C.ink },
  swapLine: { fontSize: 13, color: C.ink, lineHeight: 19, marginTop: 2 },
  swapSub: { fontSize: 11.5, color: C.sub, marginTop: 3, fontVariant: ['tabular-nums'] },
  swapNone: { fontSize: 12.5, color: C.sub, lineHeight: 18 },
  foot: { fontSize: 11.5, color: C.faint, lineHeight: 17, marginTop: 14 },
}));
