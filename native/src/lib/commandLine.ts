// N3「ホーム＝今日の司令塔」（docs/STRATEGY.md §4③・§7 N3）
//
// 戦略のどのゲートに効くか:
//   ②成長実感 …「1,940kcal」で止めず「この残りが何を意味するか」まで返す。
//   ③次の行動 … Log → Understand → Act を1画面で閉じる。数字→解釈1行→CTA。
//   ⑤明日開く理由 … 開いた瞬間に「今日どうすればいいか」が書いてある。
//
// 【設計方針: カードを足すのではなく、既にある数字に意味を足す】
// 2026-09-02 の自己監査（docs/SELF-AUDIT-1.1.md）で「ヒーロー直下に最大11ブロック」問題を潰したばかり。
// だから司令塔は**新しいカードを作らない**。ヒーローの残量の下、既存の「この残りで、何を食べる？」
// ボタンと統合して**1ブロック**（解釈1行＋CTA1つ）にする。数字の羅列は1つも増やさない。
//
// 解釈の文は残量の**内訳**から選ぶ（kcalだけでなくP/Fの残り・時間帯・N1の予定）。
// パターンは10種（下表）。全部を1つの純関数に集め、UIは返ってきた文とCTAを描くだけにする。
import { t } from './i18n';
import { TIME_SLOTS_8, slotIndexOf, parseHm, type TimeSlot8 } from './timeSlots';
import { estKcalOf, needsTimeQuestion, redistribute, type DayPlan } from './dayPlan';
import type { EatContext } from './whatToEat';

/** 残りPFC（未計算はnull） */
export type PfcRemaining = { p: number | null; f: number | null; c: number | null };

/**
 * 解釈1行のパターン。
 *
 * | key            | 出す条件（上から順に判定）                                  |
 * |----------------|-------------------------------------------------------------|
 * | over           | すでに超過している                                          |
 * | planEvent      | 外食／飲み会の予定があり、いまはその前                        |
 * | planWorkout    | トレーニングの予定がある（消費の見込みで食べられる量が増える）  |
 * | done           | 残量ほぼ0でP/Fも埋まった（今日は完成）                        |
 * | almostDone     | たんぱく質の残りが少しだけ（「あと38gで今日はほぼ完成」）      |
 * | proteinShort   | たんぱく質の残りが大きい（夜に主菜を足す話）                  |
 * | fatTight       | kcalは残っているが脂質の枠が細い（脂質を抑える話）            |
 * | morningPlenty  | 朝〜午前で残量たっぷり                                       |
 * | noonDecide     | 昼どき。ここで決めると夜が楽になる                            |
 * | eveningUse     | 夕方。夕食で使い切ってよい                                   |
 * | nightWrap      | 夜〜深夜。今日は締めて、明日の話にする                        |
 */
export type CommandTone =
  | 'over' | 'planEvent' | 'planWorkout' | 'done' | 'almostDone'
  | 'proteinShort' | 'fatTight' | 'morningPlenty' | 'noonDecide' | 'eveningUse' | 'nightWrap';

/** CTAが開く先。すべて既存の「何を食べる？」（WhatToEatSheet）の文脈つき起動 */
export type CommandCta = { label: string; eatContext: EatContext };

export type CommandLine = { tone: CommandTone; text: string; cta: CommandCta };

// ===== しきい値 =====
/** 「使い切った」とみなす残量の幅（±kcal）。ピッタリ0を要求しない */
export const DONE_BAND = 80;
/** 「ほぼ完成」と言えるたんぱく質の残り(g)の上限 */
export const ALMOST_P_G = 40;
/** 「ほぼ完成」と言えるkcalの残りの上限（600kcal残っていて「ほぼ完成」は嘘になる） */
export const ALMOST_KCAL = 400;
/** 「たんぱく質があと大きく足りない」と言う下限(g) */
export const PROTEIN_SHORT_G = 40;
/** 脂質の枠が細いと言う上限(g) */
export const FAT_TIGHT_G = 12;
/** 脂質の話をする意味があるkcal残量の下限（残り100kcalで脂質の配分を語らない） */
export const FAT_TIGHT_KCAL = 300;
/** 朝に「たっぷり残っている」と言う下限kcal */
export const MORNING_PLENTY_KCAL = 1200;

/** 時間帯 → CTA。朝は今日の組み立て、昼は昼、夕は夕食、夜は軽いものへ寄せる */
export function ctaFor(slot: TimeSlot8): CommandCta {
  switch (slot) {
    case 'earlyMorning':
    case 'morning':
    case 'forenoon':
      // 「今日のプランを見る」→ 献立の文脈（主菜＋副菜＋主食）で開く＝1日の組み立てに一番近い
      return { label: t('今日のプランを見る'), eatContext: 'cook' };
    case 'noon':
    case 'afternoon':
      return { label: t('昼を考える'), eatContext: 'convenience' };
    case 'evening':
      return { label: t('夕食を考える'), eatContext: 'cook' };
    default:
      // 夜・深夜は「もう一品」より軽いものの相談になりやすい
      return { label: t('軽く食べるものを考える'), eatContext: 'snack' };
  }
}

/** 予定のイベントが「まだこれから」か。時刻未回答は19時とみなす（2問目を強制しないための既定） */
function beforeEvent(plan: DayPlan | null, slot: TimeSlot8): boolean {
  if (!plan || !needsTimeQuestion(plan.kind)) return false;
  const hm = plan.at ? parseHm(plan.at) : null;
  const eventIdx = slotIndexOf(hm ? hm.h : 19);
  return TIME_SLOTS_8.indexOf(slot) < eventIdx;
}

/**
 * 司令塔の解釈1行＋CTA。
 * @param remaining 残りkcal（ヒーローの `left`。マイナス=超過）
 * @param pfc       残りPFC(g)。未計算は null（その項目の文は選ばれない）
 * @param slot      いまの時間帯（lib/timeSlots.ts slotOf(new Date().getHours())）
 * @param plan      N1の今日の予定。**planEffect が active でないときは null を渡す**
 *                  （チートデイ登録済み・運動を実記録済みの日に予定の話をしない＝二重計上と嘘の緩和を防ぐ）
 */
export function commandLine(
  remaining: number,
  pfc: PfcRemaining,
  slot: TimeSlot8,
  plan: DayPlan | null,
): CommandLine {
  const left = Math.round(Number.isFinite(remaining) ? remaining : 0);
  const p = pfc.p == null ? null : Math.round(pfc.p);
  const f = pfc.f == null ? null : Math.round(pfc.f);
  const cta = ctaFor(slot);
  const line = (tone: CommandTone, text: string): CommandLine => ({ tone, text, cta });

  // 超過 … 数字は言うが責めない（体重は週と月の合計で決まる）
  if (left < -DONE_BAND) {
    return line('over', t('今日は約{n}kcal多めです。夜を軽めにすれば十分収まります。', { n: (-left).toLocaleString() }));
  }

  // 予定（N1）… イベントに枠を確保し、いま食べてよい上限を言い切る
  if (plan && beforeEvent(plan, slot)) {
    const r = redistribute(left, plan, 'before');
    return line('planEvent', t('夜に約{e}kcal残す → いまは約{n}kcalまでです。', {
      e: r.forEvent.toLocaleString(), n: r.beforeEvent.toLocaleString(),
    }));
  }
  if (plan && plan.kind === 'workout') {
    const r = redistribute(left, plan, 'before');
    return line('planWorkout', t('トレーニングの見込み+{e}kcalを入れて、今日は約{n}kcalまでです。', {
      e: estKcalOf(plan).toLocaleString(), n: Math.max(r.nowLimit, 0).toLocaleString(),
    }));
  }

  // 完成 … 「ちょうど終わった」は最も気持ちのいい状態。数字を足さずに言う
  if (left <= DONE_BAND && (p == null || p <= 0)) {
    return line('done', t('今日のぶんはほぼ使い切りました。ここで終えても大丈夫です。'));
  }

  // たんぱく質があと少し … 「あと38gで今日はほぼ完成」（§7 N3の例文）
  if (p != null && p > 0 && p <= ALMOST_P_G && left <= ALMOST_KCAL) {
    return line('almostDone', t('あと{p}gで今日はほぼ完成です。', { p }));
  }

  // たんぱく質が大きく足りない … 次の一皿の話にする
  if (p != null && p > PROTEIN_SHORT_G) {
    return line('proteinShort', t('たんぱく質があと{p}g。主菜をもう一品入れると届きます。', { p }));
  }

  // 脂質の枠が細い … kcalは残っているのに脂質だけ詰まっている日（揚げ物を選ぶと一気に超える）
  if (f != null && f <= FAT_TIGHT_G && left >= FAT_TIGHT_KCAL) {
    return line('fatTight', t('あと{n}kcal。夜は脂質を抑えめにすると収まります。', { n: left.toLocaleString() }));
  }

  // 時間帯で締める（内訳から言うことが無い日は、時間帯に合わせた一言）
  switch (slot) {
    case 'earlyMorning':
    case 'morning':
    case 'forenoon':
      return left >= MORNING_PLENTY_KCAL
        ? line('morningPlenty', t('今日は約{n}kcalまで。朝にたんぱく質を入れておくと、夜が楽になります。', { n: left.toLocaleString() }))
        : line('noonDecide', t('あと{n}kcal。次の1食をここで決めておくと、あとが楽です。', { n: left.toLocaleString() }));
    case 'noon':
    case 'afternoon':
      return line('noonDecide', t('あと{n}kcal。次の1食をここで決めておくと、あとが楽です。', { n: left.toLocaleString() }));
    case 'evening':
      return line('eveningUse', t('あと{n}kcal。夕食で使い切って大丈夫です。', { n: left.toLocaleString() }));
    default:
      return line('nightWrap', t('あと{n}kcal残っています。無理に埋めなくて大丈夫です。', { n: left.toLocaleString() }));
  }
}
