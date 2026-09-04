// 「何を食べる？」シート（食事タブ内のAI相談・2026-09-02）
//
// 熊田さん:「何を食べようか悩んだときにAI相談ページに行かないといけないのは楽じゃない。
// 同じ画面（食事記録の画面）でやりたい。献立考えたいな、コンビニで何買おうかな、とか」。
//
// 入口は食事タブの2箇所（ヒーロー残量の下の1行ボタン／＋シート1段目のタイル）。
// 上部の文脈チップ（コンビニ／外食／自炊／間食／時間がない）を1つ選び、任意の一言を添えて
// 「提案してもらう」→ /api/what-to-eat → 3案のカード。先頭を「いちばんのおすすめ」で強調
// （MenuAdvisor と同じ流儀）。「これにする → 記録」はテキスト入力シートに品名を充填するだけで、
// 勝手に確定しない（既存のステージング哲学＝本人の✓で確定）。
//
// プラン: サーバーはAI相談（coach_count）の枠に相乗り。無料（coach 0回）でも入口は出し、
// シートを開くと「スタンダードで使えます」＋見本1件を静的に見せる（機能の存在を隠さない）。
//
// 【Modalの入れ子について】このシートは pageSheet。iOSは表示中のModalの兄弟に別のModalを
// 出せないため、「これにする」は**このシートが閉じ切ってから** onPick を呼ぶ（PlusSheet と同じ:
// iOS=onDismiss／Android=閉じアニメ後のタイマー・二重発火はrefで防ぐ）。呼び出し側はそこで入力シートを開く
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Modal, ScrollView, Pressable, TextInput, ActivityIndicator, Platform } from 'react-native';
import { Sparkles, X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Chip, OptionButton } from '@/components/ui/Selectable';
import { DietEstimateNote, DietSilenceNote } from '@/components/DietNotes';
import { apiPost } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { t, apiLang } from '@/lib/i18n';
import { getPurpose } from '@/lib/purpose';
import { todayJST } from '@/lib/calc';
import { slotOf } from '@/lib/timeSlots';
import { coachInsightsBlock } from '@/lib/laws';
import { readFoodFreq, foodScores } from '@/lib/foods';
import { useDiet, isDietOff } from '@/lib/diet';
import { mergeAlerts, rulesFor, type DietLevel } from '@/lib/dietCheck';
import { useGate } from '@/lib/gate';
import { swapsFor, swapLine, emojiText, type SwapMode } from '@/lib/smartSwap';
import { tierPromptSummary } from '@/content/proteinTiers';
import { C, ICON, RADIUS, rgba, sheetTopPad, themed } from '@/lib/ui';
import {
  EAT_CONTEXTS, EAT_NOTE_MAX, contextLabel, contextHint, promptKindOf, remainingLine,
  validateProposal, recentTagSummary, topMyFoodNames, sampleProposal,
  type EatContext, type EatPick, type EatProposal, type Remaining,
} from '@/lib/whatToEat';

type ApiRes = { ok: boolean; error?: string; code?: string; limit?: number; result?: unknown };

function shiftDate(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** 直近3日の品目から食材タグの要約を作る（偏り回避のヒント）。取れなければ空文字＝提案は止めない */
async function fetchRecentTags(): Promise<string> {
  try {
    const today = todayJST();
    const { data } = await supabase.from('logs').select('items')
      .gte('date', shiftDate(today, -3)).lte('date', today)
      .order('at', { ascending: false }).limit(60);
    const items: { name?: string | null; qty?: string | null }[] = [];
    for (const r of (data ?? []) as { items?: unknown }[]) {
      if (Array.isArray(r.items)) for (const it of r.items) if (it && typeof it === 'object') items.push(it as { name?: string; qty?: string });
    }
    return recentTagSummary(items);
  } catch { return ''; }
}

/** 「食べたらどうなる？」（N2）へ渡す種。案のkcal・PFCはAIの値なので概算せずそのまま使える */
export type WhatIfSeedFromPick = { name: string; kcal: number; p: number; f: number; c: number };

export default function WhatToEatSheet({ visible, onClose, remaining, myFoods, onPick, onWhatIf, initialContext }: {
  visible: boolean;
  onClose: () => void;
  /** 今日の残り（食事タブのヒーローと同じ計算値） */
  remaining: Remaining;
  /** マイ食品（名前上位を「いつものあれ」として提案に混ぜる） */
  myFoods: { id: string; name: string }[];
  /** 「これにする」で品名を受け取る。シートが閉じ切ってから呼ばれる（入力欄への充填は呼び出し側の責務） */
  onPick: (name: string) => void;
  /**
   * N2「食べたらどうなる？」（docs/STRATEGY.md §7 N2）。各案から未来シミュレーションへ。
   * onPick と同じく**このシートが閉じ切ってから**呼ばれる（iOSは表示中のModalの兄弟に別のModalを出せない）
   */
  onWhatIf?: (seed: WhatIfSeedFromPick) => void;
  /**
   * N3の司令塔CTA（朝=今日のプラン／昼=昼／夕=夕食）から開くときの文脈。
   * 「夕食を考える」で開いて『コンビニ』が選ばれているのは会話として噛み合わないので、
   * 開くたびにこの文脈へ合わせる（未指定なら前回の選択を引き継ぐ従来どおり）
   */
  initialContext?: EatContext;
}) {
  const router = useRouter();
  const [ctx, setCtx] = useState<EatContext>('convenience');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EatProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 429 plan_limit のときだけ導線を出す。上限0（無料）は機能紹介のペイウォール、日次上限は limit_coach
  const [upgradeSrc, setUpgradeSrc] = useState<'eat' | 'limit_coach' | null>(null);
  // 閉じ切ってから実行する持ち越し。'pick'=入力欄へ品名を充填 / 'whatif'=未来シミュレーションを開く
  const pending = useRef<{ kind: 'pick'; name: string } | { kind: 'whatif'; seed: WhatIfSeedFromPick } | null>(null);

  // 開くたびに結果を捨てる（残量が変わっているかもしれない）。文脈チップは前回の選択を引き継ぐ
  useEffect(() => {
    if (visible) {
      setResult(null); setError(null); setUpgradeSrc(null); setLoading(false);
      if (initialContext) setCtx(initialContext);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialContext]);

  // 閉じ切ってから品名を渡す（iOS: onDismiss／Android: 閉じアニメ後）
  function flush() {
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    if (p.kind === 'pick') onPick(p.name);
    else onWhatIf?.(p.seed);
  }
  useEffect(() => {
    if (visible || !pending.current) return;
    const h = setTimeout(flush, Platform.OS === 'ios' ? 700 : 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ===== プラン（無料は見本を見せる） =====
  const gate = useGate();
  const locked = gate.gated('coach');

  // ===== 食事の制約（B-18）: MenuAdvisor と同じく候補は消さず、印をつけて後ろへ =====
  const diet = useDiet();
  const dietOn = !isDietOff(diet);
  const dietPremium = !gate.gated('diet');
  const picks = useMemo(() => {
    const list = result?.picks ?? [];
    if (list.length === 0 || !dietOn) return list;
    const rules = rulesFor(diet.modes);
    const aiFlags: Record<string, DietLevel> = {};
    for (const p of list) if (p.dietFlag) aiFlags[p.name] = p.dietFlag;
    const alerts = mergeAlerts({ items: list.map((p) => ({ name: p.name })), rules, aiFlags, premium: dietPremium });
    const level = new Map<string, DietLevel>();
    for (const a of alerts) if (level.get(a.name) !== 'high') level.set(a.name, a.level);
    const rank = (p: EatPick) => { const lv = level.get(p.name); return lv === 'high' ? 2 : lv === 'maybe' ? 1 : 0; };
    return list
      .map((p, i) => ({ p: { ...p, dietFlag: level.get(p.name) }, i }))
      .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
      .map((x) => x.p);
  }, [result, diet, dietOn, dietPremium]);

  async function ask() {
    if (loading) return;
    setLoading(true); setError(null); setUpgradeSrc(null);
    try {
      // 端末内で組める文脈: 本人の法則（上位3件＋直近7日）・直近3日の食材タグ・マイ食品の上位名・
      // たんぱく源ティアの要約（食材ナビ。目的が増量なら増量の基準）
      const [insights, recentTags] = await Promise.all([
        coachInsightsBlock().catch(() => ''),
        fetchRecentTags(),
      ]);
      const swapMode: SwapMode = getPurpose() === 'bulk' ? 'bulk' : 'cut';
      const { ok, json } = await apiPost<ApiRes>('/api/what-to-eat', {
        context: ctx,
        remainingKcal: Math.round(remaining.kcal),
        pRemain: remaining.p != null ? Math.round(remaining.p) : null,
        fRemain: remaining.f != null ? Math.round(remaining.f) : null,
        cRemain: remaining.c != null ? Math.round(remaining.c) : null,
        slot: slotOf(new Date().getHours()),
        purposeKey: getPurpose(),
        note: note.trim().slice(0, EAT_NOTE_MAX),
        insights,
        recentTags,
        proteinTiers: tierPromptSummary(swapMode),
        myFoods: topMyFoodNames(myFoods, foodScores(readFoodFreq())),
        lang: apiLang(),
      });
      const proposal = ok && json?.ok ? validateProposal(json.result) : null;
      if (!proposal) {
        setError(json?.error || t('うまく考えられませんでした。もう一度お試しください。'));
        if (json?.code === 'plan_limit') setUpgradeSrc(json.limit === 0 ? 'eat' : 'limit_coach');
        return;
      }
      setResult(proposal);
    } catch {
      setError(t('通信に失敗しました。電波状況を確認してください。'));
    } finally {
      setLoading(false);
    }
  }

  function choose(name: string) {
    pending.current = { kind: 'pick', name };
    onClose();
  }
  /** N2への持ち越し。案の数字（AI由来）をそのまま渡すので概算に落とさない */
  function askWhatIf(p: EatPick) {
    pending.current = { kind: 'whatif', seed: { name: p.name, kcal: Math.round(p.estKcal), p: Math.round(p.p), f: Math.round(p.f), c: Math.round(p.c) } };
    onClose();
  }
  function openPaywall(src: 'eat' | 'limit_coach') {
    onClose();
    router.push(`/paywall?src=${src}` as never);
  }

  const sample = sampleProposal(ctx);
  const kind = promptKindOf(ctx);
  // 型ごとの「どう考えるか」の1行（何が返ってくるかを先に伝える）
  const kindNote = kind === 'menu' ? t('主菜＋副菜＋主食の献立で考えます。')
    : kind === 'snack' ? t('200kcal以内の候補で考えます。')
    : t('すぐ買える・頼める一品で考えます。');

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={flush}>
      <View style={s.wrap}>
        <View style={s.head}>
          <Sparkles size={ICON.lg} color={C.teal} strokeWidth={ICON.stroke} />
          <Text style={s.title}>{t('あとのカロリーで何を食べる？')}</Text>
          <View style={{ flex: 1 }} />
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('閉じる')}>
            <X size={ICON.lg} color={C.sub} strokeWidth={ICON.stroke} />
          </Pressable>
        </View>
        <Text style={s.remain}>{remainingLine(remaining)}</Text>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          {/* 文脈チップ（1つだけ選ぶ） */}
          <View style={s.chips}>
            {EAT_CONTEXTS.map((c) => (
              <Chip key={c} label={contextLabel(c)} selected={ctx === c} onPress={() => { setCtx(c); setResult(null); setError(null); }} />
            ))}
          </View>
          <Text style={s.kindNote}>{kindNote}</Text>

          {locked ? (
            // ===== 無料: 機能の存在は見せる（見本1件＋プランへの導線） =====
            <View style={s.lockBox}>
              <Text style={s.lockT}>{t('「あとのカロリーで何を食べる？」はスタンダードプランで使えます。')}</Text>
              <Text style={s.lockSub}>{t('残りカロリーと、あなたの記録（法則・定番・直近の食材）から、いまの一品を3つ提案します。AI相談と同じ枠を使います。')}</Text>
              <View style={[s.pickCard, s.pickCardBest, { marginTop: 12 }]}>
                <Text style={s.bestBadge}>{t('見本')}</Text>
                <PickBody p={sample} />
              </View>
              <OptionButton variant="teal" label={t('プランを見る →')} onPress={() => openPaywall('eat')} />
            </View>
          ) : (
            <>
              {/* 任意の一言（例:「魚がいい」「安く」） */}
              <TextInput
                style={s.noteInput} value={note} onChangeText={setNote} maxLength={EAT_NOTE_MAX}
                placeholder={contextHint(ctx)} placeholderTextColor={C.faint}
                returnKeyType="done" onSubmitEditing={ask} maxFontSizeMultiplier={1.3}
              />
              {result == null && !loading && (
                <OptionButton style={{ marginTop: 10 }} variant="teal" label={t('提案してもらう')} onPress={ask} />
              )}

              {loading && (
                <View style={s.loadingBox}>
                  <ActivityIndicator size="large" color={C.teal} />
                  <Text style={s.loadingT}>{t('残りと記録から考えています…')}</Text>
                </View>
              )}

              {error != null && !loading && (
                <View style={s.loadingBox}>
                  <Text style={s.errT}>{error}</Text>
                  {upgradeSrc ? (
                    <Pressable hitSlop={8} style={({ pressed }) => [{ marginTop: 10 }, pressed && { opacity: 0.7 }]}
                               onPress={() => openPaywall(upgradeSrc)}>
                      <Text style={s.link}>{t('プランを見る →')}</Text>
                    </Pressable>
                  ) : (
                    <OptionButton style={{ marginTop: 10 }} variant="tonal" label={t('もう一度')} onPress={ask} />
                  )}
                </View>
              )}

              {result != null && !loading && (
                <View style={{ marginTop: 12 }}>
                  {picks.map((p, i) => {
                    // 該当の可能性がある候補は「いちばんのおすすめ」にしない（推す形にしない）。カードは消さない
                    const flagged = p.dietFlag != null;
                    const best = i === 0 && !flagged;
                    return (
                      <View key={`${p.name}-${i}`} style={[s.pickCard, best && s.pickCardBest,
                                                           p.dietFlag === 'high' && s.pickCardHigh,
                                                           p.dietFlag === 'maybe' && s.pickCardMaybe]}>
                        {best && <Text style={s.bestBadge}>{t('いちばんのおすすめ')}</Text>}
                        {flagged && (
                          <Text style={[s.dietBadge, p.dietFlag === 'high' ? s.dietBadgeHigh : s.dietBadgeMaybe]}>{t('⚠️ 対象の可能性')}</Text>
                        )}
                        <PickBody p={p} />
                        {/* 食材ナビ「置き換えるなら」: 提案の主役食材に、同じ栄養素をより少ない（増量なら多い）kcalで
                            取れる候補があるときだけ1行。栄養素を限定した効率だけを言う（lib/smartSwap の規約） */}
                        <SwapHint name={p.name} />
                        <OptionButton style={{ marginTop: 10 }} variant={best ? 'teal' : 'tonal'}
                                      label={t('これにする → 記録')} onPress={() => choose(p.name)} />
                        {/* N2 未来シミュレーション（docs/STRATEGY.md §7 N2）: 決める前に「今日／今週／体重のペース」を見る。
                            禁止のためではなく、選択の結果を先に見せるための1行 */}
                        {onWhatIf && (
                          <Pressable onPress={() => askWhatIf(p)} hitSlop={8} style={{ alignSelf: 'center', marginTop: 8 }}
                                     accessibilityRole="button">
                            <Text style={s.whatIfLink}>{t('食べたらどうなる？')}</Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                  {/* 同条件で3案を作り直す（AI相談の枠を1つ消費する） */}
                  <OptionButton variant="tonal" label={t('別の案を見る')} onPress={ask} />
                  {dietOn && (
                    <View style={{ marginTop: 8 }}>
                      <DietEstimateNote onDetail={() => { onClose(); router.push('/settings?open=diet' as never); }} />
                      <DietSilenceNote />
                    </View>
                  )}
                  {!!result.note && <Text style={s.footNote}>{result.note}</Text>}
                  <Text style={s.footNote}>{t('これは提案です。実際の栄養値は記録時の解析で確定します。')}</Text>
                  <Text style={s.footNote}>{t('「これにする」を押すと入力欄に品名が入ります。食べたら↑送信で記録できます。')}</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** カード本文（品名・約kcal・P/F/C・理由）。見本と本番で同じ見た目 */
function PickBody({ p }: { p: EatPick }) {
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Text style={s.pickName}>{p.name}</Text>
        {p.estKcal > 0 && <Text style={s.pickKcal}>{t('約{n}kcal', { n: p.estKcal.toLocaleString() })}</Text>}
      </View>
      <Text style={s.pickPfc}>{`P ${p.p}g・F ${p.f}g・C ${p.c}g`}</Text>
      {!!p.reason && <Text style={s.pickReason}>{p.reason}</Text>}
    </>
  );
}

/** 「置き換えるなら」1行（該当があるときだけ）。「🍊×4 ≒ 🫑×1」の対比＋文 */
function SwapHint({ name }: { name: string }) {
  const sw = useMemo(() => swapsFor(name, { mode: getPurpose() === 'bulk' ? 'bulk' : 'cut' })[0], [name]);
  if (!sw) return null;
  return (
    <View style={s.swapRow}>
      <Text style={s.swapLabel}>{t('置き換えるなら')}</Text>
      <Text style={s.swapT} numberOfLines={2}>
        <Text style={s.swapEmoji}>{emojiText(sw.from)} ≒ {emojiText(sw.to)}</Text>{'  '}{swapLine(sw)}
      </Text>
    </View>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: sheetTopPad(18) },
  // 食材ナビ「置き換えるなら」（カード内の1行・薄い面）
  swapRow: { marginTop: 8, backgroundColor: C.chipBg, borderRadius: RADIUS.input, paddingHorizontal: 10, paddingVertical: 7 },
  swapLabel: { fontSize: 11, fontWeight: '800', color: C.accentInk, letterSpacing: 0.4 },
  swapT: { fontSize: 12.5, color: C.sub, lineHeight: 18, marginTop: 2 },
  swapEmoji: { fontSize: 13, fontWeight: '800', color: C.ink },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  remain: { fontSize: 13, fontWeight: '700', color: C.sub, marginTop: 6, marginBottom: 12, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindNote: { fontSize: 12, color: C.faint, marginTop: 8, marginBottom: 10 },
  noteInput: {
    backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.input,
    paddingVertical: 12, paddingHorizontal: 14, fontSize: 15, color: C.ink,
  },
  loadingBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 12 },
  loadingT: { fontSize: 15, fontWeight: '700', color: C.sub },
  errT: { fontSize: 15, color: C.sub, lineHeight: 22, textAlign: 'center', paddingHorizontal: 8 },
  link: { color: C.accentInk, fontWeight: '700', fontSize: 14 },
  // N2への導線（案カードの下・控えめ）。主導線は「これにする → 記録」のまま
  whatIfLink: { color: C.accentInk, fontWeight: '700', fontSize: 13, textDecorationLine: 'underline' },
  lockBox: { marginTop: 4, gap: 8 },
  lockT: { fontSize: 15, fontWeight: '800', color: C.ink, lineHeight: 21 },
  lockSub: { fontSize: 13, color: C.sub, lineHeight: 19 },
  pickCard: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 14, marginBottom: 10 },
  // 先頭＝一番のおすすめだけアクセント枠で一段強調する（MenuAdvisor と同じ）
  pickCardBest: { borderColor: C.accentBorder, borderWidth: 1.5, backgroundColor: C.accentSoft },
  // 食事の制約（B-18・§5）: 縁だけ変えてカードは残す
  pickCardHigh: { borderColor: C.coral },
  pickCardMaybe: { borderColor: C.amber },
  dietBadge: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '800', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6 },
  dietBadgeHigh: { color: C.coral, backgroundColor: C.coralWeak },
  dietBadgeMaybe: { color: C.amber, backgroundColor: rgba(C.amber, 0.14) },
  bestBadge: {
    alignSelf: 'flex-start', fontSize: 11, fontWeight: '800', color: C.accentInk,
    backgroundColor: C.accentBadge, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6,
  },
  pickName: { flexShrink: 1, fontSize: 17, fontWeight: '800', color: C.ink },
  pickKcal: { fontSize: 13, fontWeight: '700', color: C.sub, fontVariant: ['tabular-nums'] },
  pickPfc: { fontSize: 12, fontWeight: '700', color: C.sub, marginTop: 4, fontVariant: ['tabular-nums'] },
  pickReason: { fontSize: 13, color: C.sub, lineHeight: 19, marginTop: 6 },
  footNote: { fontSize: 12, color: C.faint, lineHeight: 17, marginTop: 6 },
}));
