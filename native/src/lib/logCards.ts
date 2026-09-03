// 食事タブ「ヒーロー直下」に出る注意喚起カード・帯の調停（純関数）。
//
// 背景（2026-09-02 自己監査 docs/SELF-AUDIT-1.1.md）: 機能追加のたびにヒーロー直下へ
// 「週と月の収支」「バッジ獲得の帯」「Day12の帯」「スタートチェックリスト」「昨日の穴埋め」
// 「過食リスク／気づきアラート」「ポジティブな気づき×2」「朝の気分」「今日のひとこと帯」が
// それぞれ独立に自分を出していた。全部そろうと「今日の記録」（本体）まで最大11ブロックを
// スクロールすることになり、しかも過去日を表示中でも「今日は〜」のカードが出ていた。
//
// ここで決めること（1か所に集約し、画面側は結果に従うだけにする）:
//  1. 同時に出す上限: カードは最大 MAX_CARDS 枚、帯（1行の細い帯）は最大 MAX_BANDS 本
//  2. 優先順位（上ほど先に枠を取る）:
//     カード … caution（過食リスク／気づきの注意。今日の準備に直結）
//            > dayPlan（N1 朝の1問「今日は外食の予定ありますか？」。答えると今日の配分そのものが変わる
//                      ＝この後に見る全部の数字の前提。だから backfill より上。ただし caution は
//                      「今日が崩れやすい」という今日の準備の話で、予定の再配分より先に読まれるべきなので下に置く）
//            > backfill（昨日の未記録。放置すると収支の数字がズレる）
//            > checklist（新規ユーザー14日間の道しるべ。日々の入力より先に「次に何をするか」）
//            > mood（1タップの気分入力）
//            > positive（良い条件がそろった日の背中押し。無くても困らない）
//     帯   … badge（獲得バッジ）> firstLaw（最初の法則）> brief（今日のひとこと）
//  3. 「今日」にしか意味のないものは、過去日を表示中は出さない（TODAY_ONLY）。
//     バッジ・最初の法則・チェックリストは日付に依存しないので過去日でも出る
//
// ヒーロー・収支・今日の記録・前の食事・体重入力・広告枠は「構造カード」（ユーザーが⊖/⊕で自分で
// 管理する、または位置が固定）なのでこの調停の対象外。スポットライト（マイ食品の案内・食事の制約の案内）は
// Modal であり、保存直後に1枚だけ・互いに排他で出るのでここには載せない。
export type AttentionCard = 'caution' | 'dayPlan' | 'backfill' | 'checklist' | 'mood' | 'positive';
export type AttentionBand = 'badge' | 'firstLaw' | 'brief';
export type AttentionKey = AttentionCard | AttentionBand;

export const MAX_CARDS = 2;
export const MAX_BANDS = 2;

/** 枠を取る順（先頭ほど優先） */
export const CARD_PRIORITY: readonly AttentionCard[] = ['caution', 'dayPlan', 'backfill', 'checklist', 'mood', 'positive'];
export const BAND_PRIORITY: readonly AttentionBand[] = ['badge', 'firstLaw', 'brief'];

/** 今日を表示しているときだけ意味を持つもの（過去日では候補から外す） */
export const TODAY_ONLY: ReadonlySet<AttentionKey> = new Set<AttentionKey>(['caution', 'dayPlan', 'backfill', 'mood', 'positive', 'brief']);

export type AttentionInput = {
  /** 表示中の日付が今日か */
  isToday: boolean;
  /** 出したい候補と枚数（positive だけ複数になりうる。無いものは 0 か省略） */
  candidates: Partial<Record<AttentionKey, number>>;
};

/** 各キーに許可する枚数（0 = 出さない） */
export type AttentionResult = Record<AttentionKey, number>;

const ALL_KEYS: readonly AttentionKey[] = [...CARD_PRIORITY, ...BAND_PRIORITY];

function take(order: readonly AttentionKey[], input: AttentionInput, budget: number, out: AttentionResult): void {
  let left = budget;
  for (const k of order) {
    const want = Math.max(0, Math.floor(input.candidates[k] ?? 0));
    if (want === 0) continue;
    if (!input.isToday && TODAY_ONLY.has(k)) continue;   // 過去日に「今日は〜」を出さない
    const n = Math.min(want, left);
    out[k] = n;
    left -= n;
    if (left <= 0) break;
  }
}

/**
 * 候補から「実際に出すもの」を決める。
 * 戻り値は各キーの許可枚数。画面側は `res.mood > 0` のように読むだけでよい。
 */
export function arbitrateAttention(input: AttentionInput, maxCards = MAX_CARDS, maxBands = MAX_BANDS): AttentionResult {
  const out = Object.fromEntries(ALL_KEYS.map((k) => [k, 0])) as AttentionResult;
  take(CARD_PRIORITY, input, maxCards, out);
  take(BAND_PRIORITY, input, maxBands, out);
  return out;
}

/** 表示ブロックの総数（テスト・監査用）。ヒーロー直下に何枚積むかの上限確認に使う */
export function attentionCount(res: AttentionResult): number {
  return ALL_KEYS.reduce((a, k) => a + res[k], 0);
}
