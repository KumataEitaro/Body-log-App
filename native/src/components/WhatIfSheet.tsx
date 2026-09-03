// N2「未来シミュレーション」のシート（docs/STRATEGY.md §6夜・§7 N2）
//
// 戦略のどのゲートに効くか: ②身体への理解／③次の行動／⑤明日開く理由。
// 「ラーメン食べたい」に対して**禁止せず、選択の結果を見せる**（今日／今週／予測体重の3段）。
//
// 入口は3つ（すべて log.tsx から開く）:
//   ① 「何を食べる？」の各案 → 「食べたらどうなる？」（品名・kcal・PFCはAIの案の値をそのまま使う）
//   ② 入力シートに食べ物を書いた状態 → 「これを食べたら？」（品名だけなので概算する）
//   ③ ヒーローの司令塔行 → 品名を自分で書く
//
// 数字の出どころは3段（lib/whatIf.ts WhatIfTarget.source）:
//   'ai'     … AI解析／提案の値（いちばん正確）
//   'db'     … content/nutrientDb.ts findFood の1食目安からの概算（「概算」と明記する）
//   'manual' … 見つからなかったときの手入力（kcalだけ聞く。PFCは空のまま＝嘘の数字を作らない）
//
// 判定・文言はすべて lib/whatIf.ts の純関数。このコンポーネントは結果を並べるだけ
// （「やめましょう」「太ります」「我慢」は純関数側で禁止＝jestで固定）
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Modal, ScrollView, Pressable, TextInput } from 'react-native';
import { TrendingDown, X } from 'lucide-react-native';
import { OptionButton } from '@/components/ui/Selectable';
import { t } from '@/lib/i18n';
import { C, ICON, RADIUS, sheetTopPad, themed } from '@/lib/ui';
import { findFood, kcalOf, nutrientOf } from '@/content/nutrientDb';
import type { BalanceDay } from '@/lib/deficit';
import { simulateWhatIf, type PfcRemaining, type WhatIfTarget } from '@/lib/whatIf';

/** 呼び出し側から渡す種（kcalがあればAI由来。無ければ品名から概算する） */
export type WhatIfSeed = {
  name: string;
  kcal?: number | null;
  p?: number | null;
  f?: number | null;
  c?: number | null;
};

/**
 * 品名 → 概算の栄養値。content/nutrientDb.ts の1食目安量（serving g）で見積もる。
 * 見つからなければ null（呼び出し側で手入力に落とす）
 */
export function estimateFromDb(name: string): WhatIfTarget | null {
  const f = findFood(name);
  if (!f) return null;
  const g = f.serving;
  return {
    name,
    kcal: Math.round(kcalOf(f, g)),
    p: Math.round(nutrientOf(f, 'p', g)),
    f: Math.round((f.per100.f * g) / 100),
    c: Math.round((f.per100.c * g) / 100),
    source: 'db',
  };
}

export default function WhatIfSheet({ visible, onClose, seed, remainingKcal, pfc, days, perDayDeficit, onLog }: {
  visible: boolean;
  onClose: () => void;
  /** 対象の種。null なら品名の手入力から始める（ヒーローの司令塔行から開いた場合） */
  seed: WhatIfSeed | null;
  /** 今日の残りkcal（ヒーローの left と同じ値） */
  remainingKcal: number;
  /** 今日の残りPFC */
  pfc: PfcRemaining;
  /** 直近7日（末尾が今日）。「週と月の収支」カードに渡している balanceDays をそのまま */
  days: BalanceDay[];
  /** 目標の1日赤字（computePlan.requiredDaily） */
  perDayDeficit: number;
  /** 「これを記録する」。入力欄への充填は呼び出し側の責務（自動確定しない＝既存のステージング哲学） */
  onLog?: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [kcalText, setKcalText] = useState('');

  // 開くたびに種から作り直す（残量が変わっているかもしれない）
  useEffect(() => {
    if (!visible) return;
    setName(seed?.name ?? '');
    setKcalText(seed?.kcal != null && seed.kcal > 0 ? String(Math.round(seed.kcal)) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 対象の解決: ①種にkcalがある＝AI由来 → ②食材データから概算 → ③手入力（kcalだけ）
  const target: WhatIfTarget | null = useMemo(() => {
    const nm = name.trim();
    if (!nm) return null;
    const manual = Number(kcalText);
    if (seed?.kcal != null && seed.kcal > 0 && nm === (seed.name ?? '').trim() && String(Math.round(seed.kcal)) === kcalText) {
      return { name: nm, kcal: Math.round(seed.kcal), p: seed.p ?? null, f: seed.f ?? null, c: seed.c ?? null, source: 'ai' };
    }
    if (Number.isFinite(manual) && manual > 0) {
      return { name: nm, kcal: Math.round(manual), p: null, f: null, c: null, source: 'manual' };
    }
    return estimateFromDb(nm);
  }, [name, kcalText, seed]);

  const res = useMemo(
    () => (target ? simulateWhatIf({ target, remainingKcal, pfc, days, perDayDeficit }) : null),
    [target, remainingKcal, pfc, days, perDayDeficit],
  );

  // 超過の色は既存ヒーローと同じ3段階（lib/deficit.ts overLevel）＝画面ごとに色の意味が変わらない
  const overColor = res == null ? C.ink
    : res.today.level === 'none' ? C.ink
    : res.today.level === 'high' ? C.coral : C.amber;

  const sourceNote = target?.source === 'ai' ? t('AIの解析値を使っています。')
    : target?.source === 'db' ? t('食材データからの概算です（1食の目安量）。')
    : target != null ? t('手入力のカロリーで計算しています。')
    : '';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.wrap}>
        <View style={s.head}>
          <TrendingDown size={ICON.lg} color={C.teal} strokeWidth={ICON.stroke} />
          <Text style={s.title}>{t('食べたらどうなる？')}</Text>
          <View style={{ flex: 1 }} />
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('閉じる')}>
            <X size={ICON.lg} color={C.sub} strokeWidth={ICON.stroke} />
          </Pressable>
        </View>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 28 }}>
          {/* 対象（品名・kcal）。AI由来でもここで直せる＝本人の実感を上書きしない */}
          <Text style={s.label}>{t('食べるもの')}</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} maxFontSizeMultiplier={1.3}
                     placeholder={t('例: ラーメン')} placeholderTextColor={C.faint} />
          <Text style={[s.label, { marginTop: 12 }]}>{t('だいたいのカロリー')}</Text>
          <TextInput style={s.input} value={kcalText} onChangeText={setKcalText} keyboardType="number-pad"
                     maxFontSizeMultiplier={1.3}
                     placeholder={target?.source === 'db' ? String(target.kcal) : t('例: 800')}
                     placeholderTextColor={C.faint} />
          {!!sourceNote && <Text style={s.foot}>{sourceNote}</Text>}

          {res == null ? (
            <Text style={s.empty}>{t('食べるものを書くと、今日・今週・体重のペースへの影響を出します。')}</Text>
          ) : (
            <>
              {/* ===== 伴走者の1行（禁止しない・結果を見せる） ===== */}
              <View style={s.msgBox}>
                <Text style={s.msgT}>{res.message.text}</Text>
              </View>

              {/* ===== ① 今日 ===== */}
              <View style={s.block}>
                <Text style={s.blockH}>{t('今日')}</Text>
                <View style={s.row}>
                  <Text style={s.rowL}>{t('食べた後の残り')}</Text>
                  <Text style={[s.rowN, { color: overColor }]}>
                    {res.today.after >= 0
                      ? t('{n}kcal', { n: res.today.after.toLocaleString() })
                      : t('{n}kcal超過', { n: res.today.over.toLocaleString() })}
                  </Text>
                </View>
                {(['p', 'f', 'c'] as const).map((k) => {
                  const v = res.today.pfc[k];
                  if (v == null) return null;
                  const label = k === 'p' ? t('たんぱく質') : k === 'f' ? t('脂質') : t('炭水化物');
                  return (
                    <View key={k} style={s.row}>
                      <Text style={s.rowL}>{label}</Text>
                      <Text style={[s.rowN, v < 0 && { color: C.amber }]}>
                        {v >= 0 ? t('あと{n}g', { n: v }) : t('+{n}g超過', { n: -v })}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* ===== ② 今週 ===== */}
              <View style={s.block}>
                <Text style={s.blockH}>{t('今週')}</Text>
                <View style={s.row}>
                  <Text style={s.rowL}>{t('食べた後の週の収支')}</Text>
                  <Text style={s.rowN}>
                    {res.week.after <= 0
                      ? t('{n}kcalの赤字', { n: Math.abs(res.week.after).toLocaleString() })
                      : t('{n}kcalの黒字', { n: res.week.after.toLocaleString() })}
                  </Text>
                </View>
                <View style={s.row}>
                  <Text style={s.rowL}>{t('週の目標')}</Text>
                  <Text style={s.rowSub}>
                    {res.week.goal <= 0
                      ? t('{n}kcalの赤字', { n: Math.abs(res.week.goal).toLocaleString() })
                      : t('{n}kcalの黒字', { n: res.week.goal.toLocaleString() })}
                  </Text>
                </View>
                <Text style={s.blockNote}>
                  {res.week.withinGoal
                    ? t('週の合計では、まだ目標の範囲です。')
                    : t('週の目標まであと{s}kcalです。数日かけて寄せていけます。', { s: res.week.shortfall.toLocaleString() })}
                </Text>
              </View>

              {/* ===== ③ 予測体重（断定しない） ===== */}
              <View style={s.block}>
                <Text style={s.blockH}>{t('体重のペース')}</Text>
                <Text style={s.weightN}>{res.weight.text}</Text>
                <Text style={s.blockNote}>{t('週の収支を体脂肪1kg=7,200kcalで割ったおおよその見積りです。実際の体重は水分でも動きます。')}</Text>
              </View>

              {onLog && (
                <OptionButton style={{ marginTop: 4 }} variant="teal" label={t('これを記録する')}
                              onPress={() => { const nm = name.trim(); onClose(); if (nm) onLog(nm); }} />
              )}
              <Text style={s.foot}>{t('食べても食べなくても、あなたの選択です。結果だけ先に見せています。')}</Text>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: sheetTopPad(18) },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  label: { fontSize: 12, fontWeight: '800', color: C.accentInk, letterSpacing: 0.4, marginBottom: 5 },
  input: {
    backgroundColor: C.panel, borderWidth: 1.5, borderColor: C.line, borderRadius: RADIUS.input,
    paddingVertical: 12, paddingHorizontal: 14, fontSize: 15, color: C.ink,
  },
  empty: { fontSize: 13, color: C.sub, lineHeight: 20, marginTop: 16 },
  msgBox: {
    marginTop: 16, backgroundColor: C.accentSoft, borderWidth: 1.5, borderColor: C.accentBorder,
    borderRadius: RADIUS.tile, padding: 14,
  },
  msgT: { fontSize: 14.5, fontWeight: '700', color: C.ink, lineHeight: 22 },
  block: {
    marginTop: 12, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    borderRadius: RADIUS.panel, padding: 14,
  },
  blockH: { fontSize: 12, fontWeight: '800', color: C.accentInk, letterSpacing: 0.5, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginTop: 3 },
  rowL: { flex: 1, fontSize: 13, color: C.sub, fontWeight: '600' },
  rowN: { fontSize: 15, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  rowSub: { fontSize: 13, fontWeight: '700', color: C.sub, fontVariant: ['tabular-nums'] },
  blockNote: { fontSize: 12.5, color: C.sub, lineHeight: 19, marginTop: 9 },
  weightN: { fontSize: 16, fontWeight: '800', color: C.ink, lineHeight: 24 },
  foot: { fontSize: 12, color: C.faint, lineHeight: 18, marginTop: 10 },
}));
